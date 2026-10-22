import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { and, eq, inArray } from "drizzle-orm";
import {
  billDetails,
  detailSplitFiles,
  detailSplitOrderDedupKeys,
  recognitionRules,
  type InsertBillDetail,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { parseExactCents } from "./amountParsing";
import { refreshDetailSplitFileSummary } from "./detailSplitSummary";
import { parseCsvRowsByHeader } from "./csvUploadStream";
import { formatCents } from "./splitAmounts";

export const DETAIL_SPLIT_INSERT_BATCH_SIZE = 5000;
export const DETAIL_SPLIT_ORDER_STATUS_FIELD = "订单状态";
export const DETAIL_SPLIT_SUCCESS_STATUS = "交易成功";

export async function insertDetailSplitRowsInBatches<T>(
  rows: T[],
  insertBatch: (batch: T[]) => Promise<void>,
) {
  for (let index = 0; index < rows.length; index += DETAIL_SPLIT_INSERT_BATCH_SIZE) {
    await insertBatch(rows.slice(index, index + DETAIL_SPLIT_INSERT_BATCH_SIZE));
  }
}

function cleanCell(value: unknown) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^[`'"]+/, "")
    .replace(/[`'"]+$/, "")
    .trim();
}

export function isSuccessfulDetailSplitStatus(value: unknown) {
  return cleanCell(value) === DETAIL_SPLIT_SUCCESS_STATUS;
}

function cleanRow(row: Record<string, unknown>) {
  const cleaned: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(row)) {
    const key = cleanCell(rawKey);
    if (!key || key === "__parsed_extra") continue;
    cleaned[key] = cleanCell(rawValue);
  }
  return cleaned;
}

export function normalizeDetailSplitOrderNo(value: unknown) {
  return cleanCell(value).replace(/\s+/g, "").toUpperCase();
}

export function buildDetailSplitBillNo(detailSplitFileId: number, lineNumber: number) {
  return `SPLIT-${detailSplitFileId}-${lineNumber}`;
}

export function selectDetailSplitDedupWinners<T extends { normalizedOrderNo: string; lineNumber: number }>(
  candidates: T[],
  ownerRows: Array<{ normalizedOrderNo: string; detailSplitFileId: number; sourceLineNumber: number }>,
  detailSplitFileId: number,
) {
  const ownedLineByOrderNo = new Map(ownerRows
    .filter((row) => Number(row.detailSplitFileId) === detailSplitFileId)
    .map((row) => [row.normalizedOrderNo, Number(row.sourceLineNumber)]));
  return candidates.filter((candidate) => (
    ownedLineByOrderNo.get(candidate.normalizedOrderNo) === candidate.lineNumber
  ));
}

function isXlsxFile(fileName: string) {
  return /\.xlsx$/i.test(fileName.trim());
}

async function* parseGenericCsvRows(stream: ReadableStream<Uint8Array>) {
  yield* parseCsvRowsByHeader({
    stream,
    isHeaderRow: (cells) => cells.map(cleanCell).some(Boolean),
    cleanCell,
    missingHeaderMessage: "明细分账识别失败，请检查文件",
  });
}

function getXlsxCellText(cell: ExcelJS.Cell) {
  if (cell.value instanceof Date) {
    return `${cell.value.getFullYear()}-${String(cell.value.getMonth() + 1).padStart(2, "0")}-${String(cell.value.getDate()).padStart(2, "0")}`;
  }
  return String(cell.text || cell.value || "");
}

async function* parseGenericXlsxRows(stream: ReadableStream<Uint8Array>) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.read(Readable.fromWeb(stream as any));
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return;
  let headerRowNumber = 0;
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const maxColumn = Math.max(row.cellCount, row.actualCellCount);
    const cells = Array.from({ length: maxColumn }, (_, index) => cleanCell(getXlsxCellText(row.getCell(index + 1))));
    if (cells.filter(Boolean).length > 0) {
      headerRowNumber = rowNumber;
      break;
    }
  }
  if (!headerRowNumber) throw new Error("明细分账识别失败，请检查文件");
  const headerRow = worksheet.getRow(headerRowNumber);
  const maxColumn = Math.max(headerRow.cellCount, headerRow.actualCellCount);
  const headers = Array.from({ length: maxColumn }, (_, index) => cleanCell(getXlsxCellText(headerRow.getCell(index + 1))));
  for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const parsedRow: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) parsedRow[header] = cleanCell(getXlsxCellText(row.getCell(index + 1)));
    });
    yield { row: parsedRow, lineNumber: rowNumber };
  }
}

function getRowValue(row: Record<string, string>, field: string) {
  const target = cleanCell(field);
  const exact = row[target];
  if (exact !== undefined && exact !== null && String(exact).trim() !== "") return String(exact);
  const normalizedTarget = target.replace(/\s+/g, "");
  const key = Object.keys(row).find((item) => cleanCell(item).replace(/\s+/g, "") === normalizedTarget);
  return key ? String(row[key] || "") : "";
}

function hasRowField(row: Record<string, string>, field: string) {
  const target = cleanCell(field);
  if (!target) return false;
  const normalizedTarget = target.replace(/\s+/g, "");
  return Object.keys(row).some((key) => cleanCell(key).replace(/\s+/g, "") === normalizedTarget);
}

function createExactKeywordMatcher(items: Array<{ id: number; detailKeyword?: string | null; keywordMatchType?: string | null }>) {
  const exactItems = new Map<string, number>();
  for (const item of items) {
    if (item.keywordMatchType && item.keywordMatchType !== "等于") continue;
    const keyword = cleanCell(item.detailKeyword);
    if (!keyword || exactItems.has(keyword)) continue;
    exactItems.set(keyword, Number(item.id));
  }
  return (value: string) => {
    const itemId = exactItems.get(cleanCell(value));
    return itemId || null;
  };
}

export async function uploadDetailSplitFromStream(options: {
  stream: ReadableStream<Uint8Array>;
  fileName: string;
  ruleId: number;
  matchField: string;
  incomeField: string;
  recognitionKeywordField: string;
  orderNoField: string;
  userId: number;
}) {
  const db = getDb();
  const matchField = cleanCell(options.matchField);
  const incomeField = cleanCell(options.incomeField);
  const recognitionKeywordField = cleanCell(options.recognitionKeywordField);
  const orderNoField = cleanCell(options.orderNoField);
  if (!options.ruleId) throw new Error("请选择明细认账规则");
  if (!matchField) throw new Error("请填写明细匹配字段");
  if (!incomeField) throw new Error("请填写收入字段");
  if (!recognitionKeywordField) throw new Error("请填写认账条件字段");
  if (!orderNoField) throw new Error("请填写子订单号字段");

  const rule = await db.query.recognitionRules.findFirst({
    where: eq(recognitionRules.id, Number(options.ruleId)),
    with: { items: true },
  });
  if (!rule || !rule.items?.length) throw new Error("所选明细认账规则不存在或无规则条件");

  const fileResult = await db.insert(detailSplitFiles).values({
    orderFileId: null,
    taskId: null,
    ruleId: Number(rule.id),
    fileName: options.fileName,
    matchField,
    incomeField,
    recognitionKeywordField,
    orderNoField,
    uploadStatus: "processing",
    uploaderId: options.userId,
  }).$returningId();
  const detailSplitFileId = Number(fileResult[0]?.id);
  if (!detailSplitFileId) throw new Error("创建明细分账包失败");

  try {
    const ruleItemMatcher = createExactKeywordMatcher(rule.items);
    const parser = isXlsxFile(options.fileName) ? parseGenericXlsxRows(options.stream) : parseGenericCsvRows(options.stream);

    const summary = await db.transaction(async (tx) => {
      const headers = new Set<string>();
      let requiredColumnsChecked = false;
      let skippedCount = 0;
      let duplicateCount = 0;
      let successfulStatusCount = 0;
      let entryCount = 0;
      let matchedCount = 0;
      let unmatchedCount = 0;
      let candidates: Array<{
        lineNumber: number;
        normalizedOrderNo: string;
        originalOrderNo: string;
        matchKey: string;
        amountCents: number;
        amountText: string;
        recognitionKeyword: string;
        statusText: string;
      }> = [];

      const flushCandidates = async () => {
        if (candidates.length === 0) return;
        const current = candidates;
        candidates = [];
        const seenOrderNos = new Set<string>();
        const uniqueCurrent = current.filter((candidate) => {
          if (seenOrderNos.has(candidate.normalizedOrderNo)) return false;
          seenOrderNos.add(candidate.normalizedOrderNo);
          return true;
        });
        duplicateCount += current.length - uniqueCurrent.length;
        await tx.insert(detailSplitOrderDedupKeys).ignore().values(uniqueCurrent.map((candidate) => ({
          ruleId: Number(rule.id),
          normalizedOrderNo: candidate.normalizedOrderNo,
          detailSplitFileId,
          sourceLineNumber: candidate.lineNumber,
        })));

        const normalizedOrderNos = uniqueCurrent.map((candidate) => candidate.normalizedOrderNo);
        const ownerRows = await tx.select({
          normalizedOrderNo: detailSplitOrderDedupKeys.normalizedOrderNo,
          detailSplitFileId: detailSplitOrderDedupKeys.detailSplitFileId,
          sourceLineNumber: detailSplitOrderDedupKeys.sourceLineNumber,
        }).from(detailSplitOrderDedupKeys).where(and(
          eq(detailSplitOrderDedupKeys.ruleId, Number(rule.id)),
          inArray(detailSplitOrderDedupKeys.normalizedOrderNo, normalizedOrderNos),
        ));
        const winners = selectDetailSplitDedupWinners(uniqueCurrent, ownerRows, detailSplitFileId);
        duplicateCount += uniqueCurrent.length - winners.length;

        const values: InsertBillDetail[] = winners.map((candidate) => {
          const ruleItemId = ruleItemMatcher(candidate.recognitionKeyword);
          const matchStatus = ruleItemId ? "matched" as const : "unmatched" as const;
          if (ruleItemId) matchedCount += 1;
          else unmatchedCount += 1;
          return {
            taskId: 0,
            ruleId: Number(rule.id),
            orderFileId: null,
            detailSplitFileId,
            splitSourceDetailId: null,
            billDate: "1970-01-01",
            partitionDate: "1970-01-01",
            lifecycleStatus: "unmatched_package" as any,
            billNo: buildDetailSplitBillNo(detailSplitFileId, candidate.lineNumber),
            description: candidate.recognitionKeyword || candidate.matchKey,
            totalAmount: formatCents(candidate.amountCents),
            rawData: {
              [orderNoField]: candidate.originalOrderNo,
              [matchField]: candidate.matchKey,
              [incomeField]: candidate.amountText || formatCents(candidate.amountCents),
              [recognitionKeywordField]: candidate.recognitionKeyword,
              [DETAIL_SPLIT_ORDER_STATUS_FIELD]: candidate.statusText,
              __normalizedOrderNo: candidate.normalizedOrderNo,
              __lineNumber: String(candidate.lineNumber),
              __sourceFileName: options.fileName,
            } as any,
            matchStatus,
            ruleItemId,
          };
        });
        if (values.length > 0) await tx.insert(billDetails).values(values);
        entryCount += values.length;
      };

      for await (const { row: rawRow, lineNumber } of parser) {
        const row = cleanRow(rawRow);
        if (!Object.values(row).some((value) => cleanCell(value) !== "")) continue;
        Object.keys(row).forEach((key) => headers.add(key));
        if (!requiredColumnsChecked) {
          const missing = [
            matchField,
            incomeField,
            recognitionKeywordField,
            orderNoField,
            DETAIL_SPLIT_ORDER_STATUS_FIELD,
          ].filter((field) => !hasRowField(row, field));
          if (missing.length > 0) throw new Error(`明细分账文件缺少列：${missing.join("、")}`);
          requiredColumnsChecked = true;
        }

        if (!isSuccessfulDetailSplitStatus(getRowValue(row, DETAIL_SPLIT_ORDER_STATUS_FIELD))) {
          skippedCount += 1;
          continue;
        }
        successfulStatusCount += 1;

        const originalOrderNo = cleanCell(getRowValue(row, orderNoField));
        const normalizedOrderNo = normalizeDetailSplitOrderNo(originalOrderNo);
        const matchKey = cleanCell(getRowValue(row, matchField));
        const amountText = getRowValue(row, incomeField);
        const amountCents = parseExactCents(amountText);
        if (!normalizedOrderNo) throw new Error(`明细分账第 ${lineNumber} 行未找到子订单号字段，上传失败。`);
        if (normalizedOrderNo.length > 191) throw new Error(`明细分账第 ${lineNumber} 行子订单号超过191个字符，上传失败。`);
        if (!matchKey) throw new Error(`明细分账第 ${lineNumber} 行未找到明细匹配字段，上传失败。`);
        if (!Number.isFinite(amountCents)) throw new Error(`明细分账第 ${lineNumber} 行收入金额必须是最多两位小数，上传失败。`);

        candidates.push({
          lineNumber,
          normalizedOrderNo,
          originalOrderNo,
          matchKey,
          amountCents,
          amountText,
          recognitionKeyword: getRowValue(row, recognitionKeywordField),
          statusText: getRowValue(row, DETAIL_SPLIT_ORDER_STATUS_FIELD),
        });

        if (candidates.length >= DETAIL_SPLIT_INSERT_BATCH_SIZE) await flushCandidates();
      }
      await flushCandidates();

      if (headers.size === 0) throw new Error("明细分账识别失败，请检查文件");
      if (successfulStatusCount === 0) throw new Error("明细分账文件中没有订单状态为“交易成功”的有效明细");

      await tx.update(detailSplitFiles).set({
        rawColumns: Array.from(headers).join(","),
        uploadStatus: "completed",
        entryCount,
        processedCount: entryCount,
        matchedCount,
        unmatchedCount,
        pendingRecognitionCount: matchedCount,
        recognizedCount: 0,
        duplicateCount,
        failedReason: null,
      }).where(eq(detailSplitFiles.id, detailSplitFileId));

      return { entryCount, matchedCount, unmatchedCount, skippedCount, duplicateCount };
    });

    await refreshDetailSplitFileSummary(detailSplitFileId);
    return {
      success: true,
      detailSplitFileId,
      count: summary.entryCount,
      matchedCount: summary.matchedCount,
      unmatchedCount: summary.unmatchedCount,
      skippedCount: summary.skippedCount,
      duplicateCount: summary.duplicateCount,
    };
  } catch (err) {
    const failedReason = (err instanceof Error ? err.message : String(err || "上传处理失败")).slice(0, 500);
    await db.update(detailSplitFiles).set({
      uploadStatus: "failed",
      failedReason,
    }).where(eq(detailSplitFiles.id, detailSplitFileId)).catch((statusErr) => {
      console.error(`[detail-split-files/upload] 更新失败状态失败，分账包 ${detailSplitFileId}:`, statusErr);
    });
    throw err;
  }
}

export async function uploadDetailSplitFromFile(input: {
  filePath: string;
  fileName: string;
  ruleId: number;
  matchField: string;
  incomeField: string;
  recognitionKeywordField: string;
  orderNoField: string;
  userId: number;
}) {
  const { createReadStream } = await import("node:fs");
  return uploadDetailSplitFromStream({
    stream: Readable.toWeb(createReadStream(input.filePath)) as any,
    fileName: input.fileName,
    ruleId: input.ruleId,
    matchField: input.matchField,
    incomeField: input.incomeField,
    recognitionKeywordField: input.recognitionKeywordField,
    orderNoField: input.orderNoField,
    userId: input.userId,
  });
}
