import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { uploadDetailSplitFromStream } from "./detailSplitUploadStream";
import { getDb } from "../queries/connection";
import { recognitionRules } from "@db/schema";
import { eq } from "drizzle-orm";
import { enqueueDbHeavyJob } from "./dbHeavyQueue";
import { startDetailSplitPackageRecognition } from "../detailSplitFileRouter";

const UPLOAD_ROOT = path.resolve(process.cwd(), ".upload-cache/detail-split-files");
const MAX_CHUNK_SIZE = 16 * 1024 * 1024;
const activeProcessingUploads = new Set<string>();

type UploadStatus = "uploading" | "uploaded" | "processing" | "completed" | "failed";

export type DetailSplitUploadSessionMeta = {
  uploadId: string;
  userId: number;
  ruleId: number;
  matchField: string;
  incomeField: string;
  recognitionKeywordField: string;
  orderNoField: string;
  fileName: string;
  fileSize: number;
  lastModified: number;
  chunkSize: number;
  totalChunks: number;
  status: UploadStatus;
  uploadedChunks: number[];
  createdAt: string;
  updatedAt: string;
  startedProcessingAt?: string;
  completedAt?: string;
  processingPhase?: string;
  failedReason?: string;
  result?: {
    detailSplitFileId: number;
    count: number;
    matchedCount: number;
    unmatchedCount: number;
    skippedCount: number;
    duplicateCount: number;
  };
};

function safeUploadId(uploadId: string) {
  if (!/^[a-zA-Z0-9_-]{12,80}$/.test(uploadId)) throw new Error("上传任务不存在");
  return uploadId;
}

function sanitizeFileName(fileName: string) {
  return path.basename(fileName || "明细分账.csv").replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 200) || "明细分账.csv";
}

function sessionDir(uploadId: string) {
  return path.join(UPLOAD_ROOT, safeUploadId(uploadId));
}

function chunksDir(uploadId: string) {
  return path.join(sessionDir(uploadId), "chunks");
}

function metaPath(uploadId: string) {
  return path.join(sessionDir(uploadId), "meta.json");
}

function mergedFilePath(uploadId: string) {
  return path.join(sessionDir(uploadId), "complete");
}

async function ensureRoot() {
  await mkdir(UPLOAD_ROOT, { recursive: true });
}

function waitForMetaRetry(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readMeta(uploadId: string): Promise<DetailSplitUploadSessionMeta> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const content = await readFile(metaPath(uploadId), "utf8");
      if (!content.trim()) throw new SyntaxError("empty upload session metadata");
      return JSON.parse(content) as DetailSplitUploadSessionMeta;
    } catch (err: any) {
      if (err?.code === "ENOENT") throw new Error("上传任务不存在");
      lastError = err;
      const message = String(err?.message || "");
      const canRetry = err instanceof SyntaxError || message.includes("Unexpected end of JSON input");
      if (!canRetry) throw err;
      await waitForMetaRetry(50 * (attempt + 1));
    }
  }
  console.error(`[detail-split-files/chunked] 上传任务 ${uploadId} 状态文件读取失败:`, lastError);
  throw new Error("上传任务状态读取失败，请重新上传");
}

async function writeMeta(meta: DetailSplitUploadSessionMeta) {
  meta.updatedAt = new Date().toISOString();
  const dir = sessionDir(meta.uploadId);
  await mkdir(dir, { recursive: true });
  const target = metaPath(meta.uploadId);
  const tmp = path.join(dir, `.meta.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
  try {
    await writeFile(tmp, JSON.stringify(meta, null, 2), "utf8");
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

async function listUploadedChunks(uploadId: string, totalChunks: number) {
  try {
    const names = await readdir(chunksDir(uploadId));
    return names
      .map((name) => Number(name.replace(/\.part$/, "")))
      .filter((index) => Number.isInteger(index) && index >= 0 && index < totalChunks)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

async function findReusableSession(input: {
  userId: number;
  ruleId: number;
  matchField: string;
  incomeField: string;
  recognitionKeywordField: string;
  orderNoField: string;
  fileName: string;
  fileSize: number;
  lastModified: number;
}) {
  await ensureRoot();
  const uploadIds = await readdir(UPLOAD_ROOT).catch(() => []);
  for (const uploadId of uploadIds) {
    try {
      const meta = await readMeta(uploadId);
      const reusable = meta.userId === input.userId
        && meta.ruleId === input.ruleId
        && meta.matchField === input.matchField
        && meta.incomeField === input.incomeField
        && meta.recognitionKeywordField === input.recognitionKeywordField
        && meta.orderNoField === input.orderNoField
        && meta.fileName === input.fileName
        && meta.fileSize === input.fileSize
        && meta.lastModified === input.lastModified
        && ["uploading", "uploaded", "processing"].includes(meta.status);
      if (reusable) return meta;
    } catch {
      // Ignore corrupt old sessions.
    }
  }
  return null;
}

export async function createDetailSplitUploadSession(input: {
  userId: number;
  ruleId: number;
  matchField?: string;
  incomeField?: string;
  recognitionKeywordField?: string;
  orderNoField?: string;
  fileName: string;
  fileSize: number;
  lastModified: number;
  chunkSize: number;
}) {
  const fileName = sanitizeFileName(input.fileName);
  const chunkSize = Math.min(Math.max(Number(input.chunkSize || 0), 1024 * 1024), MAX_CHUNK_SIZE);
  const fileSize = Number(input.fileSize || 0);
  const totalChunks = Math.ceil(fileSize / chunkSize);
  if (!input.ruleId) throw new Error("请选择明细认账规则");
  const db = getDb();
  const [rule] = await db.select({
    matchField: recognitionRules.detailSplitMatchField,
    incomeField: recognitionRules.detailSplitIncomeField,
    recognitionKeywordField: recognitionRules.detailSplitRecognitionKeywordField,
    orderNoField: recognitionRules.detailSplitOrderNoField,
  }).from(recognitionRules).where(eq(recognitionRules.id, input.ruleId));
  if (!rule) throw new Error("所选明细认账规则不存在");
  const matchField = String(rule.matchField || "").trim();
  const incomeField = String(rule.incomeField || "").trim();
  const recognitionKeywordField = String(rule.recognitionKeywordField || "").trim();
  const orderNoField = String(rule.orderNoField || "").trim();
  if (!matchField) throw new Error("所选明细认账规则未配置明细匹配字段");
  if (!incomeField) throw new Error("所选明细认账规则未配置收入字段");
  if (!recognitionKeywordField) throw new Error("所选明细认账规则未配置认账条件字段");
  if (!orderNoField) throw new Error("所选明细认账规则未配置子订单号字段");
  if (!fileSize || fileSize < 1) throw new Error("请选择明细分账文件");
  if (!Number.isFinite(totalChunks) || totalChunks < 1) throw new Error("文件分片参数异常");

  const existing = await findReusableSession({
    userId: input.userId,
    ruleId: input.ruleId,
    matchField,
    incomeField,
    recognitionKeywordField,
    orderNoField,
    fileName,
    fileSize,
    lastModified: Number(input.lastModified || 0),
  });
  if (existing) {
    existing.uploadedChunks = await listUploadedChunks(existing.uploadId, existing.totalChunks);
    await writeMeta(existing);
    return existing;
  }

  const now = new Date().toISOString();
  const meta: DetailSplitUploadSessionMeta = {
    uploadId: randomUUID(),
    userId: input.userId,
    ruleId: input.ruleId,
    matchField,
    incomeField,
    recognitionKeywordField,
    orderNoField,
    fileName,
    fileSize,
    lastModified: Number(input.lastModified || 0),
    chunkSize,
    totalChunks,
    status: "uploading",
    uploadedChunks: [],
    createdAt: now,
    updatedAt: now,
  };
  await mkdir(chunksDir(meta.uploadId), { recursive: true });
  await writeMeta(meta);
  return meta;
}

export async function getDetailSplitUploadSession(uploadId: string, userId: number) {
  const meta = await readMeta(uploadId);
  if (meta.userId !== userId) throw new Error("上传任务不存在");
  if (["uploading", "uploaded", "failed"].includes(meta.status)) {
    meta.uploadedChunks = await listUploadedChunks(meta.uploadId, meta.totalChunks);
    await writeMeta(meta);
  }
  return meta;
}

export async function writeDetailSplitUploadChunk(input: {
  uploadId: string;
  userId: number;
  index: number;
  body: ReadableStream<Uint8Array>;
}) {
  const meta = await getDetailSplitUploadSession(input.uploadId, input.userId);
  if (meta.status === "processing" || meta.status === "completed") return meta;
  if (!Number.isInteger(input.index) || input.index < 0 || input.index >= meta.totalChunks) {
    throw new Error("分片序号异常");
  }

  await mkdir(chunksDir(meta.uploadId), { recursive: true });
  const targetPath = path.join(chunksDir(meta.uploadId), `${input.index}.part`);
  const tmpPath = `${targetPath}.${Date.now()}.tmp`;
  await pipeline(Readable.fromWeb(input.body as any), createWriteStream(tmpPath));

  const written = await stat(tmpPath);
  const expectedSize = input.index === meta.totalChunks - 1
    ? meta.fileSize - input.index * meta.chunkSize
    : meta.chunkSize;
  if (written.size !== expectedSize) {
    await rm(tmpPath, { force: true });
    throw new Error("分片大小异常，请重试");
  }

  await rename(tmpPath, targetPath);
  meta.status = "uploading";
  meta.uploadedChunks = await listUploadedChunks(meta.uploadId, meta.totalChunks);
  await writeMeta(meta);
  return meta;
}

async function mergeChunks(meta: DetailSplitUploadSessionMeta) {
  const uploaded = await listUploadedChunks(meta.uploadId, meta.totalChunks);
  if (uploaded.length !== meta.totalChunks) throw new Error("文件分片尚未上传完成");

  const completePath = mergedFilePath(meta.uploadId);
  await rm(completePath, { force: true });
  for (let index = 0; index < meta.totalChunks; index += 1) {
    await pipeline(
      createReadStream(path.join(chunksDir(meta.uploadId), `${index}.part`)),
      createWriteStream(completePath, { flags: index === 0 ? "w" : "a" }),
    );
  }

  const merged = await stat(completePath);
  if (merged.size !== meta.fileSize) {
    await rm(completePath, { force: true });
    throw new Error("文件合并校验失败，请重新上传");
  }
  return completePath;
}

async function runDetailSplitUploadImport(uploadId: string) {
  if (activeProcessingUploads.has(uploadId)) return;
  activeProcessingUploads.add(uploadId);
  let meta = await readMeta(uploadId);
  try {
    const completePath = mergedFilePath(uploadId);
    meta.status = "processing";
    meta.startedProcessingAt = new Date().toISOString();
    meta.failedReason = undefined;
    meta.processingPhase = "后台匹配并入库";
    await writeMeta(meta);

    const result = await uploadDetailSplitFromStream({
      stream: Readable.toWeb(createReadStream(completePath)) as any,
      fileName: meta.fileName,
      ruleId: meta.ruleId,
      matchField: meta.matchField,
      incomeField: meta.incomeField,
      recognitionKeywordField: meta.recognitionKeywordField,
      orderNoField: meta.orderNoField,
      userId: meta.userId,
    });

    meta = await readMeta(uploadId);
    meta.status = "completed";
    meta.completedAt = new Date().toISOString();
    meta.processingPhase = "入库完成，已提交拆分认账";
    meta.result = {
      detailSplitFileId: Number(result.detailSplitFileId || 0),
      count: Number(result.count || 0),
      matchedCount: Number(result.matchedCount || 0),
      unmatchedCount: Number(result.unmatchedCount || 0),
      skippedCount: Number(result.skippedCount || 0),
      duplicateCount: Number(result.duplicateCount || 0),
    };
    await rm(chunksDir(uploadId), { recursive: true, force: true });
    await rm(mergedFilePath(uploadId), { force: true });
    if (meta.result.detailSplitFileId) {
      await startDetailSplitPackageRecognition(meta.result.detailSplitFileId).catch((err) => {
        console.error(`[detail-split-files/chunked] 自动提交拆分认账失败，分账包 ${meta.result?.detailSplitFileId}:`, err);
      });
    }
    await writeMeta(meta);
  } catch (err: any) {
    meta = await readMeta(uploadId).catch(() => meta);
    meta.status = "failed";
    meta.failedReason = err?.message || "上传处理失败";
    meta.processingPhase = "处理失败";
    await writeMeta(meta).catch(() => undefined);
    console.error(`[detail-split-files/chunked] 导入任务 ${uploadId} 失败:`, err);
  } finally {
    activeProcessingUploads.delete(uploadId);
  }
}

function enqueueDetailSplitUploadImport(uploadId: string) {
  void enqueueDbHeavyJob({
    key: `detail-split-upload-import:${uploadId}`,
    type: "detail-split-upload-import",
    run: () => runDetailSplitUploadImport(uploadId),
  }).catch((err) => {
    console.error(`[detail-split-files/chunked] 导入任务 ${uploadId} 排队执行失败:`, err);
  });
}

export async function completeDetailSplitUploadSession(uploadId: string, userId: number) {
  const meta = await getDetailSplitUploadSession(uploadId, userId);
  if (meta.status === "completed") return meta;
  if (meta.status === "processing") {
    enqueueDetailSplitUploadImport(meta.uploadId);
    return meta;
  }
  await mergeChunks(meta);
  meta.status = "processing";
  meta.uploadedChunks = await listUploadedChunks(meta.uploadId, meta.totalChunks);
  meta.processingPhase = "等待服务器排队";
  await writeMeta(meta);
  enqueueDetailSplitUploadImport(meta.uploadId);
  return meta;
}
