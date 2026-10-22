import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { uploadOrderDetailsFromStream } from "./orderUploadStream";
import { uploadInvoiceOnlyOrderDetailsFromStream } from "./invoiceOnlyOrderUpload";
import { enqueueDbHeavyJob } from "./dbHeavyQueue";
import { getOrderImportPhaseProgress, getOrderUploadOverallProgress } from "./orderUploadProgress";

const UPLOAD_ROOT = path.resolve(process.cwd(), ".upload-cache/order-files");
const MAX_CHUNK_SIZE = 16 * 1024 * 1024;
const activeProcessingUploads = new Set<string>();

type UploadStatus = "uploading" | "uploaded" | "processing" | "completed" | "failed";
export type OrderUploadRuleType = "recognition" | "invoice_only";

export type OrderUploadSessionMeta = {
  uploadId: string;
  userId: number;
  ruleType: OrderUploadRuleType;
  ruleId: number;
  matchDate?: string;
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
  failedReason?: string;
  processingProgress?: number;
  parseProgress?: number;
  importProgress?: number;
  processingBytes?: number;
  processedRows?: number;
  processingPhase?: string;
  result?: {
    count: number;
    matchedCount: number;
    unmatchedCount: number;
    skippedCount?: number;
    affectedTasks: number;
    orderFiles: number;
  };
};

function safeUploadId(uploadId: string) {
  if (!/^[a-zA-Z0-9_-]{12,80}$/.test(uploadId)) throw new Error("上传任务不存在");
  return uploadId;
}

function sanitizeFileName(fileName: string) {
  return path.basename(fileName || "订单明细.csv").replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 200) || "订单明细.csv";
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

async function ensureRoot() {
  await mkdir(UPLOAD_ROOT, { recursive: true });
}

function waitForMetaRetry(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readMeta(uploadId: string): Promise<OrderUploadSessionMeta> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const content = await readFile(metaPath(uploadId), "utf8");
      if (!content.trim()) throw new SyntaxError("empty upload session metadata");
      return JSON.parse(content) as OrderUploadSessionMeta;
    } catch (err: any) {
      if (err?.code === "ENOENT") throw new Error("上传任务不存在");
      lastError = err;
      const message = String(err?.message || "");
      const canRetry = err instanceof SyntaxError || message.includes("Unexpected end of JSON input");
      if (!canRetry) throw err;
      await waitForMetaRetry(50 * (attempt + 1));
    }
  }
  console.error(`[order-files/chunked] 上传任务 ${uploadId} 状态文件读取失败:`, lastError);
  throw new Error("上传任务状态读取失败，请重新上传");
}

async function writeMeta(meta: OrderUploadSessionMeta) {
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

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
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

async function listContiguousUploadedChunks(uploadId: string, totalChunks: number) {
  const uploaded = new Set(await listUploadedChunks(uploadId, totalChunks));
  const contiguous: number[] = [];
  for (let index = 0; index < totalChunks; index += 1) {
    if (!uploaded.has(index)) break;
    contiguous.push(index);
  }
  return contiguous;
}

async function getChunkBytes(uploadId: string, indexes: number[]) {
  let total = 0;
  for (const index of indexes) {
    const chunk = await stat(path.join(chunksDir(uploadId), `${index}.part`));
    total += chunk.size;
  }
  return total;
}

async function findReusableSession(input: {
  userId: number;
  ruleType: OrderUploadRuleType;
  ruleId: number;
  matchDate?: string;
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
        && (meta.ruleType || "recognition") === input.ruleType
        && meta.ruleId === input.ruleId
        && (meta.matchDate || "") === (input.matchDate || "")
        && meta.fileName === input.fileName
        && meta.fileSize === input.fileSize
        && meta.lastModified === input.lastModified
        && ["uploading", "uploaded", "processing"].includes(meta.status);
      if (reusable) return meta;
    } catch {
      // Ignore corrupt old sessions; they can be cleaned later.
    }
  }
  return null;
}

export async function createOrderUploadSession(input: {
  userId: number;
  ruleType?: OrderUploadRuleType;
  ruleId: number;
  matchDate?: string;
  fileName: string;
  fileSize: number;
  lastModified: number;
  chunkSize: number;
}) {
  const fileName = sanitizeFileName(input.fileName);
  const chunkSize = Math.min(Math.max(Number(input.chunkSize || 0), 1024 * 1024), MAX_CHUNK_SIZE);
  const fileSize = Number(input.fileSize || 0);
  const ruleType = input.ruleType === "invoice_only" ? "invoice_only" : "recognition";
  const totalChunks = Math.ceil(fileSize / chunkSize);
  if (!input.ruleId) throw new Error(ruleType === "invoice_only" ? "请选择不认账明细规则" : "请选择认账规则");
  if (!fileSize || fileSize < 1) throw new Error("请选择订单明细文件");
  if (!Number.isFinite(totalChunks) || totalChunks < 1) throw new Error("文件分片参数异常");

  const existing = await findReusableSession({
    userId: input.userId,
    ruleType,
    ruleId: input.ruleId,
    matchDate: input.matchDate || undefined,
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
  const meta: OrderUploadSessionMeta = {
    uploadId: randomUUID(),
    userId: input.userId,
    ruleType,
    ruleId: input.ruleId,
    matchDate: input.matchDate || undefined,
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

export async function getOrderUploadSession(uploadId: string, userId: number) {
  const meta = await readMeta(uploadId);
  if (meta.userId !== userId) throw new Error("上传任务不存在");
  if (["uploading", "uploaded", "failed"].includes(meta.status)) {
    meta.uploadedChunks = await listUploadedChunks(meta.uploadId, meta.totalChunks);
    await writeMeta(meta);
  }
  return meta;
}

export async function writeOrderUploadChunk(input: {
  uploadId: string;
  userId: number;
  index: number;
  body: ReadableStream<Uint8Array>;
}) {
  const meta = await getOrderUploadSession(input.uploadId, input.userId);
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

function createChunkReadStream(uploadId: string, indexes: number[]) {
  async function* readChunks() {
    for (const index of indexes) {
      const stream = createReadStream(path.join(chunksDir(uploadId), `${index}.part`));
      for await (const chunk of stream) {
        yield chunk;
      }
    }
  }
  return Readable.from(readChunks());
}

async function runOrderUploadImport(uploadId: string) {
  if (activeProcessingUploads.has(uploadId)) return;
  activeProcessingUploads.add(uploadId);
  let meta = await readMeta(uploadId);
  try {
    meta.status = "processing";
    meta.startedProcessingAt = new Date().toISOString();
    meta.failedReason = undefined;
    meta.processingProgress = 0;
    meta.parseProgress = 0;
    meta.importProgress = 0;
    meta.processingBytes = 0;
    meta.processedRows = 0;
    meta.processingPhase = "后台处理中";
    await writeMeta(meta);

    const chunkIndexes = meta.uploadedChunks.length > 0
      ? meta.uploadedChunks
      : await listContiguousUploadedChunks(uploadId, meta.totalChunks);
    if (chunkIndexes.length === 0) throw new Error("没有可处理的已上传分片");
    if (chunkIndexes.length !== meta.totalChunks) throw new Error("文件分片尚未上传完成");
    const processableBytes = await getChunkBytes(uploadId, chunkIndexes);
    if (processableBytes <= 0) throw new Error("没有可处理的已上传分片");

    let lastProgressWriteAt = 0;
    const updateProcessingProgress = async (patch: Partial<OrderUploadSessionMeta>, force = false) => {
      const now = Date.now();
      if (!force && now - lastProgressWriteAt < 800) return;
      lastProgressWriteAt = now;
      const latest = await readMeta(uploadId).catch(() => meta);
      const parseProgress = clampProgress(patch.parseProgress ?? latest.parseProgress ?? 0);
      const importProgress = clampProgress(patch.importProgress ?? latest.importProgress ?? 0);
      meta = {
        ...latest,
        ...patch,
        parseProgress,
        importProgress,
        processingProgress: patch.processingProgress === undefined
          ? getOrderUploadOverallProgress(parseProgress, importProgress)
          : clampProgress(patch.processingProgress),
      };
      await writeMeta(meta);
    };

    let processedBytes = 0;
    const countingStream = createChunkReadStream(uploadId, chunkIndexes).pipe(new Transform({
      transform(chunk, _encoding, callback) {
        processedBytes += Buffer.byteLength(chunk);
        void updateProcessingProgress({
          processingBytes: processedBytes,
          parseProgress: (processedBytes / processableBytes) * 100,
        }).catch(() => undefined);
        callback(null, chunk);
      },
    }));

    const onProgress = (progress: { processedRows: number }) => {
      void updateProcessingProgress({
        processedRows: progress.processedRows,
        importProgress: getOrderImportPhaseProgress(progress.processedRows),
      }).catch(() => undefined);
    };
    const result = (meta.ruleType || "recognition") === "invoice_only"
      ? await uploadInvoiceOnlyOrderDetailsFromStream({
        stream: Readable.toWeb(countingStream) as any,
        fileName: meta.fileName,
        ruleId: meta.ruleId,
        userId: meta.userId,
        onProgress,
      })
      : await uploadOrderDetailsFromStream({
        stream: Readable.toWeb(countingStream) as any,
        fileName: meta.fileName,
        ruleId: meta.ruleId,
        userId: meta.userId,
        matchDate: meta.matchDate,
        onProgress,
      });

    meta = await readMeta(uploadId);
    meta.status = "completed";
    meta.completedAt = new Date().toISOString();
    meta.processingProgress = 100;
    meta.parseProgress = 100;
    meta.importProgress = 100;
    meta.processingPhase = "处理完成";
    meta.result = {
      count: Number(result.count || 0),
      matchedCount: Number(result.matchedCount || 0),
      unmatchedCount: Number(result.unmatchedCount || 0),
      skippedCount: Number(result.skippedCount || 0),
      affectedTasks: Number(result.affectedTasks || 0),
      orderFiles: Number(result.orderFiles || 0),
    };
    await writeMeta(meta);
    await rm(chunksDir(uploadId), { recursive: true, force: true });
  } catch (err: any) {
    meta = await readMeta(uploadId).catch(() => meta);
    meta.status = "failed";
    meta.failedReason = err?.message || "上传处理失败";
    meta.processingPhase = "处理失败";
    await writeMeta(meta).catch(() => undefined);
    console.error(`[order-files/chunked] 导入任务 ${uploadId} 失败:`, err);
  } finally {
    activeProcessingUploads.delete(uploadId);
  }
}

function enqueueOrderUploadImport(uploadId: string) {
  void enqueueDbHeavyJob({
    key: `order-upload-import:${uploadId}`,
    type: "order-upload-import",
    run: () => runOrderUploadImport(uploadId),
  }).catch((err) => {
    console.error(`[order-files/chunked] 导入任务 ${uploadId} 排队执行失败:`, err);
  });
}

export async function completeOrderUploadSession(uploadId: string, userId: number, matchDate?: string) {
  const meta = await getOrderUploadSession(uploadId, userId);
  if (matchDate) {
    meta.matchDate = matchDate;
    await writeMeta(meta);
  }
  if (meta.status === "completed") return meta;
  if (meta.status === "processing") {
    enqueueOrderUploadImport(meta.uploadId);
    return meta;
  }
  const contiguousChunks = await listContiguousUploadedChunks(meta.uploadId, meta.totalChunks);
  if (contiguousChunks.length === 0) throw new Error("没有可处理的已上传分片");
  if (contiguousChunks.length !== meta.totalChunks) throw new Error("文件分片尚未上传完成");
  meta.status = "processing";
  meta.uploadedChunks = contiguousChunks;
  meta.processingProgress = 0;
  meta.parseProgress = 0;
  meta.importProgress = 0;
  meta.processingPhase = "等待服务器排队";
  await writeMeta(meta);
  enqueueOrderUploadImport(meta.uploadId);
  return meta;
}
