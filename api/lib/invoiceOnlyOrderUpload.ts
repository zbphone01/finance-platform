import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { and, eq, inArray } from "drizzle-orm";
import {
  invoiceOnlyOrderDetails,
  invoiceOnlyOrderFiles,
  invoiceOnlyRules,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { parseCsvRowsByHeader } from "./csvUploadStream";
import { parseLooseDecimal } from "./amountParsing";
import { buildInvoiceOrderFieldSnapshot } from "./invoiceOrderFields";

const INSERT_BATCH_SIZE = 5_000;
const DUPLICATE_LOOKUP_BATCH_SIZE = 1_000;

type ParsedRow = {
  billDate: string;
  orderDatetime: string;
  billNo: string;
  invoiceOtherOrderNo1: string | null;
  invoiceOtherOrderNo2: string | null;
  description: string;
  totalAmount: string;
};

function cleanCell(value: unknown) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^[`'"]+/, "")
    .replace(/[`'"]+$/, "")
    .trim();
}

function uniqueFields(fields: Array<string | null | undefined>) {
  return Array.from(new Set(fields.map(cleanCell).filter(Boolean)));
}

function isActualDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function normalizeInvoiceOnlyOrderDate(value: unknown) {
  const cleaned = cleanCell(value)
    .replace(/年/g, "-")
    .replace(/月/g, "-")
    .replace(/日/g, "")
    .replace(/\//g, "-")
    .split(/[ T]/)[0];
  const compact = cleaned.match(/^(\d{4})(\d{2})(\d{2})$/);
  const separated = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const match = compact || separated;
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isActualDate(year, month, day)) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normalizeInvoiceOnlyOrderTime(value: unknown) {
  const cleaned = cleanCell(value)
    .replace(/时/g, ":")
    .replace(/分/g, ":")
    .replace(/秒/g, "")
    .replace(/\s+/g, "");
  const compact = cleaned.match(/^(\d{2})(\d{2})(\d{2})$/);
  const separated = cleaned.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.\d+)?)?$/);
  const match = compact || separated;
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  if (hour > 23 || minute > 59 || second > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

export function combineInvoiceOnlyOrderDateTime(dateValue: unknown, timeValue: unknown) {
  const date = normalizeInvoiceOnlyOrderDate(dateValue);
  const time = normalizeInvoiceOnlyOrderTime(timeValue);
  return date && time ? `${date} ${time}` : "";
}

function formatInvoiceOnlyOrderDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
) {
  if (!isActualDate(year, month, day) || hour > 23 || minute > 59 || second > 59) return "";
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
}

export function normalizeInvoiceOnlyOrderDateTime(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatInvoiceOnlyOrderDateTime(
      value.getFullYear(),
      value.getMonth() + 1,
      value.getDate(),
      value.getHours(),
      value.getMinutes(),
      value.getSeconds(),
    );
  }
  const cleaned = cleanCell(value)
    .replace(/年/g, "-")
    .replace(/月/g, "-")
    .replace(/日/g, " ")
    .replace(/\//g, "-")
    .replace(/[Tt]/g, " ")
    .replace(/时/g, ":")
    .replace(/分/g, ":")
    .replace(/秒/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const compact = cleaned.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?$/);
  const separated = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.\d+)?)?$/);
  const match = compact || separated;
  if (!match) return "";
  return formatInvoiceOnlyOrderDateTime(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] || 0),
  );
}

function getXlsxCellText(cell: ExcelJS.Cell) {
  if (cell.value instanceof Date) {
    const date = cell.value;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    const second = String(date.getSeconds()).padStart(2, "0");
    if (year <= 1900) return `${hour}:${minute}:${second}`;
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  }
  return cleanCell(cell.text || cell.value || "");
}

function headerContainsFields(cells: unknown[], requiredFields: string[]) {
  const cellSet = new Set(cells.map(cleanCell).filter(Boolean));
  return requiredFields.every((field) => cellSet.has(field));
}

async function* parseXlsxRows(
  stream: ReadableStream<Uint8Array>,
  requiredFields: string[],
) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.read(Readable.fromWeb(stream as any));
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("明细识别失败，未找到订单明细表头");

  let headerRowNumber = 0;
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const maxColumn = Math.max(row.cellCount, row.actualCellCount);
    const cells = Array.from({ length: maxColumn }, (_, index) => getXlsxCellText(row.getCell(index + 1)));
    if (headerContainsFields(cells, requiredFields)) {
      headerRowNumber = rowNumber;
      break;
    }
  }
  if (!headerRowNumber) {
    throw new Error(`订单明细文件缺少列：${requiredFields.join("、")}`);
  }

  const headerRow = worksheet.getRow(headerRowNumber);
  const maxColumn = Math.max(headerRow.cellCount, headerRow.actualCellCount);
  const headers = Array.from({ length: maxColumn }, (_, index) => getXlsxCellText(headerRow.getCell(index + 1)));
  for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const parsedRow: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) parsedRow[header] = getXlsxCellText(row.getCell(index + 1));
    });
    yield { row: parsedRow, lineNumber: row.number };
  }
}

function validateLength(value: string, max: number, fieldName: string, lineNumber: number) {
  if (value.length > max) throw new Error(`第${lineNumber}行${fieldName}超过${max}个字符`);
}

export async function uploadInvoiceOnlyOrderDetailsFromStream(options: {
  stream: ReadableStream<Uint8Array>;
  fileName: string;
  ruleId: number;
  userId: number;
  onProgress?: (progress: { processedRows: number; skippedRows: number }) => void;
}) {
  const db = getDb();
  const [rule] = await db
    .select()
    .from(invoiceOnlyRules)
    .where(and(eq(invoiceOnlyRules.id, options.ruleId), eq(invoiceOnlyRules.isActive, true)));
  if (!rule) throw new Error("所选不认账明细规则不存在或已停用");

  const requiredFields = uniqueFields([
    rule.dateField,
    rule.timeField,
    rule.incomeField,
    rule.orderNoField,
    rule.descriptionField,
    rule.invoiceOtherOrderNo1Field,
    rule.invoiceOtherOrderNo2Field,
  ]);
  const rows = /\.xlsx$/i.test(options.fileName)
    ? parseXlsxRows(options.stream, requiredFields)
    : parseCsvRowsByHeader({
      stream: options.stream,
      isHeaderRow: (cells) => headerContainsFields(cells, requiredFields),
      cleanCell,
      missingHeaderMessage: `订单明细文件缺少列：${requiredFields.join("、")}`,
    });

  const parsedRows: ParsedRow[] = [];
  const rawColumns = new Set<string>();
  const fileKeys = new Set<string>();
  let processedRows = 0;
  let skippedRows = 0;
  for await (const { row, lineNumber } of rows) {
    processedRows += 1;
    Object.keys(row).forEach((field) => rawColumns.add(cleanCell(field)));
    const values = Object.values(row).map(cleanCell).filter(Boolean);
    if (values.length === 0) {
      skippedRows += 1;
      continue;
    }
    const orderDatetime = rule.dateField
      ? combineInvoiceOnlyOrderDateTime(row[rule.dateField], row[rule.timeField])
      : normalizeInvoiceOnlyOrderDateTime(row[rule.timeField]);
    if (!orderDatetime) throw new Error(`第${lineNumber}行日期或时间格式异常`);
    const billNo = cleanCell(row[rule.orderNoField]);
    if (!billNo) throw new Error(`第${lineNumber}行订单号为空`);
    const amount = parseLooseDecimal(row[rule.incomeField]);
    if (!Number.isFinite(amount)) throw new Error(`第${lineNumber}行收入金额格式异常`);
    const otherOrderNo1 = rule.invoiceOtherOrderNo1Field
      ? cleanCell(row[rule.invoiceOtherOrderNo1Field]) || null
      : null;
    const otherOrderNo2 = rule.invoiceOtherOrderNo2Field
      ? cleanCell(row[rule.invoiceOtherOrderNo2Field]) || null
      : null;
    const description = cleanCell(row[rule.descriptionField]);
    validateLength(billNo, 100, "订单号", lineNumber);
    if (otherOrderNo1) validateLength(otherOrderNo1, 255, "其他单号1", lineNumber);
    if (otherOrderNo2) validateLength(otherOrderNo2, 255, "其他单号2", lineNumber);
    validateLength(description, 500, "订单描述", lineNumber);
    const billDate = orderDatetime.slice(0, 10);
    const fileKey = `${billDate}\u0000${billNo}`;
    if (fileKeys.has(fileKey)) {
      skippedRows += 1;
      continue;
    }
    fileKeys.add(fileKey);
    parsedRows.push({
      billDate,
      orderDatetime,
      billNo,
      invoiceOtherOrderNo1: otherOrderNo1,
      invoiceOtherOrderNo2: otherOrderNo2,
      description,
      totalAmount: amount.toFixed(2),
    });
    if (processedRows % 500 === 0) options.onProgress?.({ processedRows, skippedRows });
  }
  options.onProgress?.({ processedRows, skippedRows });
  if (processedRows === 0 || rawColumns.size === 0) throw new Error("明细识别失败，请检查文件");
  if (parsedRows.length === 0) throw new Error("订单明细中没有可入库数据");

  const grouped = new Map<string, ParsedRow[]>();
  for (const row of parsedRows) {
    const group = grouped.get(row.billDate) || [];
    group.push(row);
    grouped.set(row.billDate, group);
  }
  const fieldSnapshot = buildInvoiceOrderFieldSnapshot(rule);
  const result = await db.transaction(async (tx) => {
    let insertedCount = 0;
    let insertedFiles = 0;
    let duplicateCount = 0;
    for (const [billDate, groupRows] of grouped) {
      const existingOrderNos = new Set<string>();
      const orderNos = groupRows.map((row) => row.billNo);
      for (let index = 0; index < orderNos.length; index += DUPLICATE_LOOKUP_BATCH_SIZE) {
        const chunk = orderNos.slice(index, index + DUPLICATE_LOOKUP_BATCH_SIZE);
        const existing = await tx
          .select({ billNo: invoiceOnlyOrderDetails.billNo })
          .from(invoiceOnlyOrderDetails)
          .innerJoin(invoiceOnlyOrderFiles, eq(invoiceOnlyOrderFiles.id, invoiceOnlyOrderDetails.orderFileId))
          .where(and(
            eq(invoiceOnlyOrderFiles.ruleId, options.ruleId),
            eq(invoiceOnlyOrderFiles.billDate, billDate),
            inArray(invoiceOnlyOrderDetails.billNo, chunk),
          ));
        existing.forEach((row) => {
          if (row.billNo) existingOrderNos.add(row.billNo);
        });
      }
      const insertRows = groupRows.filter((row) => !existingOrderNos.has(row.billNo));
      duplicateCount += groupRows.length - insertRows.length;
      if (insertRows.length === 0) continue;
      const totalAmount = insertRows.reduce((sum, row) => sum + Number(row.totalAmount), 0).toFixed(2);
      const [fileResult] = await tx.insert(invoiceOnlyOrderFiles).values({
        fileName: options.fileName.slice(0, 200),
        ruleId: options.ruleId,
        billDate,
        rawColumns: Array.from(rawColumns).filter(Boolean).join(","),
        invoiceOrderNoFieldSnapshot: fieldSnapshot,
        uploadStatus: "completed",
        entryCount: insertRows.length,
        processedCount: groupRows.length,
        orderTotalAmount: totalAmount,
        failedReason: null,
        uploaderId: options.userId,
      });
      const orderFileId = Number(fileResult.insertId);
      for (let index = 0; index < insertRows.length; index += INSERT_BATCH_SIZE) {
        const chunk = insertRows.slice(index, index + INSERT_BATCH_SIZE);
        await tx.insert(invoiceOnlyOrderDetails).values(chunk.map((row) => ({
          orderFileId,
          orderDatetime: row.orderDatetime,
          billNo: row.billNo,
          invoiceOtherOrderNo1: row.invoiceOtherOrderNo1,
          invoiceOtherOrderNo2: row.invoiceOtherOrderNo2,
          description: row.description,
          totalAmount: row.totalAmount,
        })));
      }
      insertedCount += insertRows.length;
      insertedFiles += 1;
    }
    return { insertedCount, insertedFiles, duplicateCount };
  });
  const totalSkipped = skippedRows + result.duplicateCount;
  if (result.insertedCount === 0) throw new Error("订单明细均已上传，没有新数据入库");
  return {
    count: result.insertedCount,
    matchedCount: 0,
    unmatchedCount: 0,
    skippedCount: totalSkipped,
    affectedTasks: 0,
    orderFiles: result.insertedFiles,
  };
}
