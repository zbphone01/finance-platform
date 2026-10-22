import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { and, asc, count, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  bankFlows,
  billDetails,
  counterpartyRecords,
  matchResults,
  orderFileRecognitionSummaries,
  orderFiles,
  recognitionRuleExcludeConditions,
  recognitionRules,
  recognitionTasks,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { enqueueRecognition } from "./recognitionQueue";
import { refreshRecognitionDateSummariesByTaskIds } from "./recognitionDateSummary";
import { attachCounterpartyMatchers, getPrimaryCounterpartyMatcher } from "./counterpartyMatchers";
import { createDetailRuleItemMatcher } from "./detailRuleMatcher";
import { cleanDecimalString } from "./amountParsing";
import { hasArchivedOrderPackage } from "./billDetailArchiveRead";
import {
  clearOrderFilePartitionsByOrderFileIds,
  syncOrderFilePartitionsByOrderFileId,
} from "./orderFilePartitions";
import {
  createBillDetailArchiveLockSession,
  isBillDetailArchiveEligibleDate,
} from "./billDetailArchiveLocks";
import { parseCsvRowsByHeader } from "./csvUploadStream";
import {
  cleanupEmptyMultiDayMatchGroup,
  evaluateMultiDayMatchGroup,
  getOrCreatePendingMultiDayMatchGroup,
  isMultiDayDetailCounterparty,
  refreshMultiDayMatchGroupTotal,
} from "./multiDayDetailMatching";
import { ensureSameDayAggregateTask } from "./sameDayDetailTask";
import {
  addOrderRecognitionSummaryDetail,
  serializeOrderRecognitionSummary,
  type OrderRecognitionSummaryAccumulator,
} from "./orderRecognitionSummary";
import {
  buildInvoiceOrderFieldSnapshot,
  readConfiguredInvoiceOrderNoValue,
} from "./invoiceOrderFields";
import {
  createRefundOrderClassifier,
  isExcludedOrder,
  shouldDirectlyMarkOrderUnmatched,
  type ExcludeOrderConditionConfig,
} from "./orderRuleClassification";

const BATCH_SIZE = 5000;
const UNMATCHED_PACKAGE_BILL_DATE = "1970-01-01";
const RAW_VALUE_SUFFIX_FIELDS = new Set([
  "商户数据包",
  "订单金额",
  "费率备注",
  "商户退款单号",
  "微信退款单号",
  "退款金额",
  "充值券退款金额",
  "申请退款金额",
  "退款类型",
  "退款状态",
]);
const NON_ORDER_SUMMARY_LABELS = [
  "总交易单数",
  "总交易额",
  "应结订单总金额",
  "退款总金额",
  "充值券退款总金额",
  "总企业红包退款金额",
  "手续费总金额",
  "订单总金额",
  "申请退款总金额",
];
const FIELD_ALIASES: Record<string, string[]> = {
  时间: ["发生时间", "交易时间", "下单时间", "订单时间", "日期"],
  日期: ["发生时间", "交易时间", "下单时间", "订单时间", "时间"],
  金额: ["收入金额", "订单金额", "实收金额", "支付金额", "交易金额"],
  订单号: ["商户订单号", "订单编号", "业务流水号"],
};

function cleanCSVCell(value: unknown) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^[`'"]+/, "")
    .replace(/[`'"]+$/, "")
    .trim();
}

export function getConfiguredInvoiceOrderNoFields(config: {
  invoiceOtherOrderNo1Field?: string | null;
  invoiceOtherOrderNo2Field?: string | null;
}) {
  return Array.from(new Set([
    config.invoiceOtherOrderNo1Field,
    config.invoiceOtherOrderNo2Field,
  ].map(cleanCSVCell).filter(Boolean)));
}

function normalizeFieldName(value: unknown) {
  return cleanCSVCell(value)
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function getFieldCandidates(preferred: string, aliases: string[] = []) {
  const preferredName = cleanCSVCell(preferred);
  const normalizedPreferred = normalizeFieldName(preferredName);
  return Array.from(new Set([
    preferredName,
    normalizedPreferred,
    ...(FIELD_ALIASES[normalizedPreferred] || []),
    ...aliases,
  ].map(cleanCSVCell).filter(Boolean)));
}

function findCompatibleFieldKey(keys: Iterable<string>, preferred: string, aliases: string[] = []) {
  const candidates = getFieldCandidates(preferred, aliases);
  const normalizedCandidates = candidates.map(normalizeFieldName);
  for (const key of keys) {
    const cleanKey = cleanCSVCell(key);
    const normalizedKey = normalizeFieldName(cleanKey);
    if (candidates.includes(cleanKey) || normalizedCandidates.includes(normalizedKey)) {
      return key;
    }
  }
  return "";
}

function normalizeRawDisplayValue(key: string, value: string) {
  if (!RAW_VALUE_SUFFIX_FIELDS.has(key)) return value;
  if (/^-?\d+(?:\.\d+)?_\d+$/.test(value)) return value.replace(/_\d+$/, "");
  if (/^_\d+$/.test(value)) return "";
  return value;
}

function cleanCSVRow(row: Record<string, unknown>) {
  const cleaned: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(row)) {
    const key = cleanCSVCell(rawKey);
    if (!key || key === "__parsed_extra") continue;
    cleaned[key] = normalizeRawDisplayValue(key, cleanCSVCell(rawValue));
  }
  return cleaned;
}

function isDateLike(value: string) {
  return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(cleanCSVCell(value));
}

function isNumericLike(value: string) {
  return /^-?\d+(?:\.\d+)?%?$/.test(cleanCSVCell(value).replace(/_\d+$/, ""));
}

function isClearlyNonOrderRow(row: Record<string, string>) {
  const values = Object.values(row).map(cleanCSVCell).filter(Boolean);
  if (values.length === 0) return true;
  if (values.some((value) => NON_ORDER_SUMMARY_LABELS.includes(value))) return true;
  const hasDate = values.some(isDateLike);
  const allNumeric = values.every(isNumericLike);
  return !hasDate && values.length <= 8 && allNumeric;
}

function getRowValue(row: Record<string, string>, preferred: string, aliases: string[] = []) {
  const candidates = getFieldCandidates(preferred, aliases);
  for (const candidate of candidates) {
    const key = findCompatibleFieldKey(Object.keys(row), candidate);
    if (!key) continue;
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return String(value);
  }
  return "";
}

function validateRequiredUploadColumns(headers: Iterable<string>, requiredFields: string[]) {
  const fieldSet = new Set(Array.from(headers).map(cleanCSVCell).filter(Boolean));
  const missingFields = requiredFields.map(cleanCSVCell).filter((field) => field && !fieldSet.has(field));
  if (missingFields.length > 0) {
    throw new Error(`订单明细文件缺少列：${missingFields.join("、")}，请检查明细认账规则配置的字段。`);
  }
}

function buildExactFieldMap(headers: Iterable<string>, fields: string[]) {
  const headerByName = new Map<string, string>();
  for (const header of headers) {
    const cleanHeader = cleanCSVCell(header);
    if (cleanHeader && !headerByName.has(cleanHeader)) headerByName.set(cleanHeader, header);
  }
  const fieldMap = new Map<string, string>();
  for (const field of fields) {
    const cleanField = cleanCSVCell(field);
    const header = cleanField ? headerByName.get(cleanField) : "";
    if (cleanField && header) fieldMap.set(cleanField, header);
  }
  return fieldMap;
}

function getMappedRowValue(row: Record<string, string>, fieldMap: Map<string, string>, preferred?: string | null) {
  const key = fieldMap.get(cleanCSVCell(preferred));
  if (!key) return "";
  const value = row[key];
  return value !== undefined && value !== null ? String(value) : "";
}

export function buildOrderRawData(
  row: Record<string, string>,
  fields: string[],
  fieldMap = buildExactFieldMap(Object.keys(row), fields),
) {
  return Object.fromEntries(
    fields
      .map(cleanCSVCell)
      .filter(Boolean)
      .map((field) => [field, getMappedRowValue(row, fieldMap, field)] as const)
      .filter(([, value]) => value !== ""),
  );
}

function isExcludeOrderRow(
  row: Record<string, string>,
  conditions: ExcludeOrderConditionConfig[],
  fieldMap?: Map<string, string>,
) {
  return isExcludedOrder(conditions, (field) => (
    fieldMap ? getMappedRowValue(row, fieldMap, field) : getRowValue(row, field)
  ));
}

function cleanDecimal(value: unknown, fallback = "0.00") {
  return cleanDecimalString(value, fallback);
}

function normalizeRefundAmount(value: unknown) {
  const amount = Math.abs(Number(cleanDecimal(value)));
  return amount > 0 ? `-${amount.toFixed(2)}` : "0.00";
}

function normalizeRefundAmountSnapshot(value: unknown) {
  const amount = Math.abs(Number(cleanDecimal(value)));
  return amount > 0 ? amount.toFixed(2) : "0.00";
}

function normalizeDate(dateStr: string): string {
  let d = dateStr.replace(/\//g, "-").trim();
  d = d.split(" ")[0];
  const parts = d.split("-");
  if (parts.length === 3) {
    const year = parts[0];
    const month = parts[1].padStart(2, "0");
    const day = parts[2].padStart(2, "0");
    d = `${year}-${month}-${day}`;
  }
  return d;
}

function isNormalizedDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addDays(dateStr: string, days: number): string {
  const normalized = normalizeDate(dateStr);
  const [year, month, day] = normalized.split("-").map(Number);
  if (!year || !month || !day) return normalized;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return normalized;
  date.setUTCDate(date.getUTCDate() + days);
  const resultYear = date.getUTCFullYear();
  const resultMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  const resultDay = String(date.getUTCDate()).padStart(2, "0");
  return `${resultYear}-${resultMonth}-${resultDay}`;
}

function isAggregateDetailCounterparty(counterparty: any) {
  return counterparty?.recognitionType === "明细认账" && counterparty?.detailMatchingMode === "同日汇总匹配";
}

function isZeroOrderTotal(value: number) {
  return Math.abs(value) < 0.005;
}

async function getTasksForBillDate(billDate: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: recognitionTasks.id,
      bankFlowCount: recognitionTasks.bankFlowCount,
    })
    .from(recognitionTasks)
    .where(eq(recognitionTasks.billDate, billDate));
  return rows;
}

type TargetContext = {
  taskId: number;
  orderFileId: number;
  billDate: string;
  hasBankFlow: boolean;
  createdTask: boolean;
  createdTaskId: number | null;
  inserted: number;
  matched: number;
  unmatched: number;
  pendingSplit: number;
  totalAmount: number;
  refundAmount: number;
  activityAmount: number;
  isAbnormal: boolean;
  recognitionSummaries: OrderRecognitionSummaryAccumulator;
  needsDetailRebuild: boolean;
};

type TaskStatus = "pending_details" | "processing" | "large_variance" | "partial_matched" | "completed" | "failed";
type DetailPackageType = "T+1" | "打包明细";
type ParsedUploadRow = {
  row: Record<string, string>;
  lineNumber: number;
};

function isXlsxFile(fileName: string) {
  return /\.xlsx$/i.test(fileName.trim());
}

function getTodayInShanghai() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export async function uploadOrderDetailsFromStream(options: {
  stream: ReadableStream<Uint8Array>;
  fileName: string;
  ruleId: number;
  userId: number;
  matchDate?: string;
  onProgress?: (progress: { processedRows: number; skippedRows: number }) => void;
}) {
  const db = getDb();
  const ruleData = await db.query.recognitionRules.findFirst({
    where: eq(recognitionRules.id, options.ruleId),
    with: {
      excludeConditions: {
        orderBy: recognitionRuleExcludeConditions.sortOrder,
      },
      items: { with: { splits: true } },
    },
  });
  if (!ruleData || !ruleData.items || ruleData.items.length === 0) {
    throw new Error("所选认账规则不存在或无规则条件");
  }
  if (!ruleData.matchedCounterpartyAlias) {
    throw new Error("所选明细认账规则未配置匹配到账信息");
  }
  const invoiceOrderNoFieldSnapshot = buildInvoiceOrderFieldSnapshot(ruleData);
  const invoiceOtherOrderNo1Field = ruleData.invoiceOtherOrderNo1Field;
  const invoiceOtherOrderNo2Field = ruleData.invoiceOtherOrderNo2Field;
  const ruleItems = ruleData.items;
  const conditionRecognitionEnabled = ruleData.conditionRecognitionEnabled !== false;
  const excludeOrderConditions: ExcludeOrderConditionConfig[] = !ruleData.excludeOrderEnabled
    ? []
    : ruleData.excludeConditions.length > 0
      ? ruleData.excludeConditions.map((condition) => ({
        field: condition.fieldName,
        matchType: condition.matchType,
        keyword: condition.keyword,
      }))
      : [{
        field: ruleData.excludeOrderField,
        matchType: "等于",
        keyword: ruleData.excludeOrderKeyword,
      }];
  const refundOrderConfig = {
    enabled: ruleData.refundOrderEnabled,
    judgeField: ruleData.refundJudgeField,
    judgeValue: ruleData.refundJudgeValue,
    directionJudgeValue: ruleData.refundDirectionJudgeValue,
    incomeField: ruleData.incomeField,
    amountField: ruleData.refundAmountField,
  };
  const classifyRefundOrder = createRefundOrderClassifier(refundOrderConfig);
  const [counterpartyRow] = await db.select().from(counterpartyRecords)
    .where(eq(counterpartyRecords.alias, ruleData.matchedCounterpartyAlias));
  const counterparty = await attachCounterpartyMatchers(db, counterpartyRow);
  if (!counterparty) {
    throw new Error("所选明细认账规则的匹配到账信息不存在");
  }
  const primaryCounterpartyMatcher = getPrimaryCounterpartyMatcher(counterparty);
  if (!primaryCounterpartyMatcher) {
    throw new Error("匹配到账信息缺少有效匹配条件，请先维护到账信息");
  }
  const isMultiDayMatching = isMultiDayDetailCounterparty(counterparty);
  const isSameDayMatching = isAggregateDetailCounterparty(counterparty);
  const detailPackageType: DetailPackageType = counterparty.detailPackageType === "打包明细" ? "打包明细" : "T+1";
  const specifiedPackageMatchDate = detailPackageType === "打包明细" && !isMultiDayMatching && options.matchDate
    ? normalizeDate(options.matchDate)
    : "";
  if (specifiedPackageMatchDate && !isNormalizedDate(specifiedPackageMatchDate)) {
    throw new Error("请选择有效的到账日期");
  }
  async function findEarliestUnrecognizedBankFlowTask() {
    const pageSize = 1000;
    for (let page = 0; page < 50; page += 1) {
      const flowWhere = specifiedPackageMatchDate
        ? and(
          inArray(bankFlows.recognitionStatus, ["unrecognized", "partial_matched"] as any),
          eq(bankFlows.arrivalMatchStatus, "matched"),
          eq(bankFlows.matchedCounterpartyId, Number(counterparty.id)),
          gt(bankFlows.income, "0"),
          eq(recognitionTasks.billDate, specifiedPackageMatchDate),
        )
        : and(
          inArray(bankFlows.recognitionStatus, ["unrecognized", "partial_matched"] as any),
          eq(bankFlows.arrivalMatchStatus, "matched"),
          eq(bankFlows.matchedCounterpartyId, Number(counterparty.id)),
          gt(bankFlows.income, "0"),
        );
      const rows = await db
        .select({
          flow: bankFlows,
          taskId: recognitionTasks.id,
          billDate: recognitionTasks.billDate,
        })
        .from(bankFlows)
        .leftJoin(recognitionTasks, eq(recognitionTasks.id, bankFlows.taskId))
        .where(flowWhere)
        .orderBy(asc(recognitionTasks.billDate), asc(bankFlows.transactionTime), asc(bankFlows.id))
        .limit(pageSize)
        .offset(page * pageSize);
      if (rows.length === 0) return null;
      const flowIds = rows.map((row) => Number(row.flow.id || 0)).filter(Boolean);
      const recognizedRows = flowIds.length > 0
        ? await db
          .select({
            bankFlowId: matchResults.bankFlowId,
            total: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
          })
          .from(matchResults)
          .where(inArray(matchResults.bankFlowId, flowIds))
          .groupBy(matchResults.bankFlowId)
        : [];
      const recognizedByFlowId = new Map(recognizedRows.map((row) => [Number(row.bankFlowId || 0), Number(row.total || 0)]));
      const matched = rows.find((row) => {
        const flowId = Number(row.flow.id || 0);
        const remainingAmount = Number(row.flow.income || 0) - Number(recognizedByFlowId.get(flowId) || 0);
        return row.taskId && row.billDate && remainingAmount > 0.01;
      });
      if (matched) {
        return {
          taskId: Number(matched.taskId),
          billDate: String(matched.billDate),
        };
      }
    }
    return null;
  }
  const multiDayMatchGroupId = isMultiDayMatching
    ? await getOrCreatePendingMultiDayMatchGroup(options.ruleId)
    : null;
  const packageMatchedTask = detailPackageType === "打包明细" && !isMultiDayMatching
    ? await findEarliestUnrecognizedBankFlowTask()
    : null;
  const uploadDate = detailPackageType === "打包明细" ? packageMatchedTask?.billDate || null : getTodayInShanghai();
  let uploadFieldMap = new Map<string, string>();
  const readUploadField = (row: Record<string, string>, field?: string | null) =>
    getMappedRowValue(row, uploadFieldMap, field);
  const ruleItemMatcher = createDetailRuleItemMatcher(
    ruleItems,
    (row: Record<string, string>, keywordField) => readUploadField(row, keywordField),
    {
      conditionRecognitionEnabled,
      enabled: ruleData.detailSplitEnabled,
      keywordField: ruleData.multiSplitKeywordField,
      keyword: ruleData.multiSplitKeyword,
    },
  );

  const dateField = String(ruleData.dateField ?? "时间").trim();
  const incomeField = ruleData.incomeField || "金额";
  const orderNoField = String(ruleData.orderNoField ?? "订单号").trim();
  const isPackageTraceUpload = detailPackageType === "打包明细" && !dateField && !orderNoField;
  const ruleKeywordFields = conditionRecognitionEnabled
    ? ruleItems.map((item) => item.keywordField).filter((field): field is string => Boolean(cleanCSVCell(field)))
    : [];
  const requiredUploadFields = [
    detailPackageType === "打包明细" ? null : dateField,
    incomeField,
    detailPackageType === "打包明细" ? orderNoField || null : orderNoField,
    ...getConfiguredInvoiceOrderNoFields(ruleData),
    ...excludeOrderConditions.map((condition) => condition.field || null),
    ruleData.refundOrderEnabled ? ruleData.refundJudgeField : null,
    ruleData.refundOrderEnabled ? ruleData.refundAmountField : null,
    ruleData.detailSplitEnabled ? ruleData.multiSplitKeywordField : null,
    ruleData.detailSplitEnabled ? ruleData.multiSplitMatchField : null,
    ...ruleKeywordFields,
  ].filter((field): field is string => Boolean(field));
  const coreRawFields = Array.from(new Set(requiredUploadFields.map(cleanCSVCell).filter(Boolean)));
  const headers = new Set<string>();
  const targets = new Map<string, TargetContext>();
  const targetsByOrderFileId = new Map<number, TargetContext>();
  const createdOrderFileIds: number[] = [];
  const affectedTasks = new Set<number>();
  const queuedTaskIds = new Set<number>();
  const archivedPackageExistsCache = new Map<string, boolean>();
  let archiveLockSession: Awaited<ReturnType<typeof createBillDetailArchiveLockSession>> | null = null;
  let batch: ParsedUploadRow[] = [];
  let processed = 0;
  let skippedRows = 0;
  let requiredColumnsChecked = false;

  async function findExistingOrderKeys(billDate: string, orderNos: string[]) {
    const uniqueOrderNos = Array.from(new Set(orderNos.filter(Boolean)));
    if (uniqueOrderNos.length === 0) return new Set<string>();

    // Keep de-duplication cross-partition: transferred details can retain the same
    // rule/date/order number after partition_date changes. The companion index
    // starts with rule_id + bill_date + bill_no so this lookup stays selective.
    const existing = await db
      .select({ billNo: billDetails.billNo })
      .from(billDetails)
      .where(and(
        eq(billDetails.billDate, billDate),
        eq(billDetails.ruleId, options.ruleId),
        inArray(billDetails.billNo, uniqueOrderNos),
      ));

    return new Set(existing.map((item) => `${billDate}|${item.billNo}`));
  }

  async function refreshTargetDetailCounts(target: TargetContext) {
    const [summary] = await db
      .select({
        entryCount: count(),
        totalAmount: sql<string>`COALESCE(SUM(CASE WHEN CAST(${billDetails.refundAmountSnapshot} AS DECIMAL(18,2)) > 0 THEN 0 ELSE CAST(${billDetails.totalAmount} AS DECIMAL(18,2)) END), 0.00)`,
        refundAmount: sql<string>`COALESCE(SUM(CAST(${billDetails.refundAmountSnapshot} AS DECIMAL(18,2))), 0.00)`,
        activityAmount: sql<string>`COALESCE(SUM(ABS(CAST(${billDetails.totalAmount} AS DECIMAL(18,2)))), 0.00)`,
        matchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'matched' THEN 1 ELSE 0 END)`,
        unmatchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'unmatched' THEN 1 ELSE 0 END)`,
        pendingSplitCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'pending_split' THEN 1 ELSE 0 END)`,
      })
      .from(billDetails)
      .where(eq(billDetails.orderFileId, target.orderFileId));

    target.inserted = Number(summary?.entryCount || 0);
    target.totalAmount = Number(summary?.totalAmount || 0);
    target.refundAmount = Number(summary?.refundAmount || 0);
    target.activityAmount = Number(summary?.activityAmount || 0);
    target.matched = Number(summary?.matchedCount || 0);
    target.unmatched = Number(summary?.unmatchedCount || 0);
    target.pendingSplit = Number(summary?.pendingSplitCount || 0);
    target.isAbnormal = target.inserted > 0 && isZeroOrderTotal(target.activityAmount);
  }

  function recordInsertedDetail(
    target: TargetContext,
    detail: typeof billDetails.$inferInsert,
  ) {
    const totalAmount = Number(detail.totalAmount || 0);
    const refundAmount = Number(detail.refundAmountSnapshot || 0);
    const matchStatus = String(detail.matchStatus || "unmatched");
    target.inserted += 1;
    target.totalAmount += refundAmount > 0 ? 0 : totalAmount;
    target.refundAmount += refundAmount;
    target.activityAmount += Math.abs(totalAmount);
    target.matched += Number(matchStatus === "matched");
    target.unmatched += Number(matchStatus === "unmatched");
    target.pendingSplit += Number(matchStatus === "pending_split");
    addOrderRecognitionSummaryDetail(target.recognitionSummaries, {
      matchStatus,
      ruleItemId: Number(detail.ruleItemId || 0) || null,
      totalAmount,
      refundAmountSnapshot: refundAmount,
    });
  }

  async function persistTargetRecognitionSummary(target: TargetContext) {
    await db.delete(orderFileRecognitionSummaries)
      .where(eq(orderFileRecognitionSummaries.orderFileId, target.orderFileId));
    if (target.needsDetailRebuild) return;
    const summaries = serializeOrderRecognitionSummary(target.orderFileId, target.recognitionSummaries);
    if (summaries.length > 0) {
      await db.insert(orderFileRecognitionSummaries).values(summaries);
    }
  }

  async function locateBankFlowTask(billDate: string, expectedTotal?: number) {
    const dateTasks = await getTasksForBillDate(billDate);
    const dateTaskIds = dateTasks.map((task) => task.id);
    if (dateTaskIds.length === 0) return null;

    const dateFlows = await db.select().from(bankFlows).where(and(
      inArray(bankFlows.taskId, dateTaskIds),
      gt(bankFlows.income, "0"),
      eq(bankFlows.arrivalMatchStatus, "matched"),
      eq(bankFlows.matchedCounterpartyId, Number(counterparty.id)),
    ));
    const candidateFlows = dateFlows;

    if (isAggregateDetailCounterparty(counterparty) && candidateFlows.length > 0) {
      return {
        taskId: Number(candidateFlows[0].taskId),
        taskIds: Array.from(new Set(candidateFlows.map((flow) => Number(flow.taskId)).filter(Boolean))),
      };
    }

    if (expectedTotal !== undefined) {
      const exactCandidates = candidateFlows.filter((flow) => Math.abs(Number(flow.income || 0) - expectedTotal) <= 0.01);
      if (exactCandidates.length === 1) {
        return { taskId: Number(exactCandidates[0].taskId) };
      }
    }

    if (candidateFlows.length !== 1) return null;
    return {
      taskId: Number(candidateFlows[0].taskId),
    };
  }

  async function refreshTaskSummary(taskId: number, status?: TaskStatus) {
    const activeWhere = and(
      eq(billDetails.taskId, taskId),
      isNull(billDetails.detailSplitFileId),
      sql`(
        COALESCE(${billDetails.operationStatus}, 'active') = 'active'
        OR ${billDetails.operationStatus} = 'split_replaced'
        OR ${billDetails.ignoreReason} LIKE '已按明细分账拆分认账%'
      )`,
      sql`NOT EXISTS (SELECT 1 FROM order_files of_abnormal WHERE of_abnormal.id = ${billDetails.orderFileId} AND of_abnormal.upload_status = 'abnormal')`,
    );
    const [summary] = await db.select({
      total: sql<string>`COALESCE(SUM(CAST(${billDetails.totalAmount} AS DECIMAL(18,2))), 0.00)`,
      cnt: count(),
      matchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchResultId} IS NOT NULL THEN 1 ELSE 0 END)`,
      unmatchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'unmatched' THEN 1 ELSE 0 END)`,
      pendingSplitCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'pending_split' AND ${billDetails.matchResultId} IS NULL THEN 1 ELSE 0 END)`,
    }).from(billDetails).where(activeWhere);
    const total = Number(summary?.total || 0);
    const cnt = Number(summary?.cnt || 0);

    await db.update(recognitionTasks).set({
      billDetailTotal: total.toFixed(2),
      billDetailCount: cnt,
      matchedCount: Number(summary?.matchedCount || 0),
      unmatchedCount: Number(summary?.unmatchedCount || 0),
      pendingSplitCount: Number(summary?.pendingSplitCount || 0),
      hasDetailFile: cnt > 0,
      ...(status ? { status } : {}),
      updatedAt: new Date(),
    }).where(eq(recognitionTasks.id, taskId));
    await refreshRecognitionDateSummariesByTaskIds([taskId]);
  }

  async function resolveTarget(billDate: string) {
    const cached = targets.get(billDate);
    if (cached) return cached;

    const isUnmatchedPackageTarget = detailPackageType === "打包明细" && billDate === UNMATCHED_PACKAGE_BILL_DATE && !packageMatchedTask;
    if (isUnmatchedPackageTarget) {
      const fileResult = await db.insert(orderFiles).values({
        taskId: 0,
        fileName: options.fileName,
        ruleId: options.ruleId,
        detailPackageType,
        uploadDate: null,
        multiDayMatchGroupId,
        matchedAccountName: primaryCounterpartyMatcher.accountName || primaryCounterpartyMatcher.accountNo,
        incomePurpose: primaryCounterpartyMatcher.purpose || null,
        incomePostScript: primaryCounterpartyMatcher.postScript || null,
        rawColumns: "",
        invoiceOrderNoFieldSnapshot,
        uploadStatus: "processing",
        uploaderId: options.userId,
      }).$returningId();
      const orderFileId = Number(fileResult[0]?.id);
      if (!orderFileId) throw new Error("创建订单文件记录失败");
      createdOrderFileIds.push(orderFileId);

      const target = {
        taskId: 0,
        orderFileId,
        billDate,
        hasBankFlow: false,
        createdTask: false,
        createdTaskId: null,
        inserted: 0,
        matched: 0,
        unmatched: 0,
        pendingSplit: 0,
        totalAmount: 0,
        refundAmount: 0,
        activityAmount: 0,
        isAbnormal: false,
        recognitionSummaries: new Map(),
        needsDetailRebuild: false,
      };
      targets.set(billDate, target);
      targetsByOrderFileId.set(orderFileId, target);
      return target;
    }

    if (isSameDayMatching) {
      const resolved = await ensureSameDayAggregateTask({
        billDate,
        counterparty,
        creatorId: options.userId,
        ruleId: options.ruleId,
        preferredTaskId: packageMatchedTask?.billDate === billDate ? Number(packageMatchedTask.taskId || 0) : undefined,
      });
      const [flowSummary] = await db.select({ count: count() })
        .from(bankFlows)
        .where(and(
          eq(bankFlows.taskId, resolved.taskId),
          gt(bankFlows.income, "0"),
          eq(bankFlows.arrivalMatchStatus, "matched"),
          eq(bankFlows.matchedCounterpartyId, Number(counterparty.id)),
        ));
      const fileResult = await db.insert(orderFiles).values({
        taskId: resolved.taskId,
        fileName: options.fileName,
        ruleId: options.ruleId,
        detailPackageType,
        uploadDate,
        matchedAccountName: primaryCounterpartyMatcher.accountName || primaryCounterpartyMatcher.accountNo,
        incomePurpose: primaryCounterpartyMatcher.purpose || null,
        incomePostScript: primaryCounterpartyMatcher.postScript || null,
        rawColumns: "",
        invoiceOrderNoFieldSnapshot,
        uploadStatus: "processing",
        uploaderId: options.userId,
      }).$returningId();
      const orderFileId = Number(fileResult[0]?.id);
      if (!orderFileId) throw new Error("创建订单文件记录失败");
      createdOrderFileIds.push(orderFileId);

      const target = {
        taskId: resolved.taskId,
        orderFileId,
        billDate,
        hasBankFlow: Number(flowSummary?.count || 0) > 0,
        createdTask: resolved.created,
        createdTaskId: resolved.created ? resolved.taskId : null,
        inserted: 0,
        matched: 0,
        unmatched: 0,
        pendingSplit: 0,
        totalAmount: 0,
        refundAmount: 0,
        activityAmount: 0,
        isAbnormal: false,
        recognitionSummaries: new Map(),
        needsDetailRebuild: false,
      };
      targets.set(billDate, target);
      targetsByOrderFileId.set(orderFileId, target);
      return target;
    }

    async function createDetailOnlyTask() {
      const taskResult = await db.insert(recognitionTasks).values({
        ruleId: options.ruleId,
        billDate,
        creatorId: options.userId,
        status: "pending_details",
        bankFlowTotal: "0.00",
        bankFlowCount: 0,
      }).$returningId();
      const taskId = Number(taskResult[0]?.id);
      if (!taskId) throw new Error("创建订单明细认账任务失败");
      return taskId;
    }

    const dateTasks = await getTasksForBillDate(billDate);
    const dateTaskIds = dateTasks.map((task) => task.id);
    const dateFlows = dateTaskIds.length > 0
      ? await db.select().from(bankFlows).where(and(
        inArray(bankFlows.taskId, dateTaskIds),
        gt(bankFlows.income, "0"),
        eq(bankFlows.arrivalMatchStatus, "matched"),
        eq(bankFlows.matchedCounterpartyId, Number(counterparty.id)),
      ))
      : [];
    const candidateFlows = dateFlows;

    const packageMatchedTaskId = detailPackageType === "打包明细" && packageMatchedTask?.billDate === billDate
      ? Number(packageMatchedTask.taskId || 0)
      : 0;
    const hasAggregateBankFlow = isAggregateDetailCounterparty(counterparty) && candidateFlows.length > 0;
    const hasBankFlow = packageMatchedTaskId > 0 || hasAggregateBankFlow || candidateFlows.length === 1;
    let createdTask = false;
    let taskId = packageMatchedTaskId || (hasBankFlow ? Number(candidateFlows[0]?.taskId || 0) : 0);
    if (!taskId) {
      const reusableDetailTask = dateTasks.find((task) => Number(task.bankFlowCount || 0) === 0);
      taskId = Number(reusableDetailTask?.id || 0);
    }
    if (!taskId) {
      taskId = await createDetailOnlyTask();
      createdTask = true;
    }
    await db.update(recognitionTasks).set({
      ruleId: options.ruleId,
      updatedAt: new Date(),
    }).where(eq(recognitionTasks.id, taskId));

    const fileResult = await db.insert(orderFiles).values({
      taskId,
      fileName: options.fileName,
      ruleId: options.ruleId,
      detailPackageType,
      uploadDate,
      matchedAccountName: primaryCounterpartyMatcher.accountName || primaryCounterpartyMatcher.accountNo,
      incomePurpose: primaryCounterpartyMatcher.purpose || null,
      incomePostScript: primaryCounterpartyMatcher.postScript || null,
      rawColumns: "",
      invoiceOrderNoFieldSnapshot,
      uploadStatus: "processing",
      uploaderId: options.userId,
    }).$returningId();
    const orderFileId = Number(fileResult[0]?.id);
    if (!orderFileId) throw new Error("创建订单文件记录失败");
    createdOrderFileIds.push(orderFileId);

    const target = {
      taskId,
      orderFileId,
      billDate,
      hasBankFlow,
      createdTask,
      createdTaskId: createdTask ? taskId : null,
      inserted: 0,
      matched: 0,
      unmatched: 0,
      pendingSplit: 0,
      totalAmount: 0,
      refundAmount: 0,
      activityAmount: 0,
      isAbnormal: false,
      recognitionSummaries: new Map(),
      needsDetailRebuild: false,
    };
    targets.set(billDate, target);
    targetsByOrderFileId.set(orderFileId, target);
    return target;
  }

  async function refreshExistingTaskAfterRollback(taskId: number) {
    await refreshTaskSummary(taskId);
  }

  async function deleteEmptyCreatedTask(taskId: number) {
    const fileCount = await db.select({ cnt: count() }).from(orderFiles).where(eq(orderFiles.taskId, taskId));
    const detailCount = await db.select({ cnt: count() }).from(billDetails).where(eq(billDetails.taskId, taskId));
    const flowCount = await db.select({ cnt: count() }).from(bankFlows).where(eq(bankFlows.taskId, taskId));
    if (
      Number(fileCount[0]?.cnt || 0) === 0 &&
      Number(detailCount[0]?.cnt || 0) === 0 &&
      Number(flowCount[0]?.cnt || 0) === 0
    ) {
      await db.delete(recognitionTasks).where(eq(recognitionTasks.id, taskId));
    }
  }

  async function attachTargetToBankFlowTask(target: TargetContext) {
    if (target.taskId <= 0) return;
    if (target.inserted <= 0) return;
    if (target.isAbnormal) return;

    if (isSameDayMatching) {
      const resolved = await ensureSameDayAggregateTask({
        billDate: target.billDate,
        counterparty,
        creatorId: options.userId,
        ruleId: options.ruleId,
        preferredTaskId: target.taskId,
      });
      if (resolved.taskId !== target.taskId) {
        await db.update(billDetails).set({ taskId: resolved.taskId })
          .where(eq(billDetails.orderFileId, target.orderFileId));
        await db.update(orderFiles).set({ taskId: resolved.taskId })
          .where(eq(orderFiles.id, target.orderFileId));
        target.taskId = resolved.taskId;
      }
      const [flowSummary] = await db.select({ count: count() })
        .from(bankFlows)
        .where(and(
          eq(bankFlows.taskId, resolved.taskId),
          gt(bankFlows.income, "0"),
          eq(bankFlows.arrivalMatchStatus, "matched"),
          eq(bankFlows.matchedCounterpartyId, Number(counterparty.id)),
        ));
      target.hasBankFlow = Number(flowSummary?.count || 0) > 0;
      affectedTasks.add(resolved.taskId);
      if (target.hasBankFlow) queuedTaskIds.add(resolved.taskId);
      return;
    }

    const expectedTotal = Number(target.totalAmount || 0);
    const located = await locateBankFlowTask(target.billDate, expectedTotal);
    if (!located) return;

    const locatedTaskIds = Array.from(new Set([located.taskId, ...(located.taskIds || [])].filter(Boolean)));
    const originalTaskId = target.taskId;
    if (located.taskId !== originalTaskId) {
      await db.update(billDetails)
        .set({ taskId: located.taskId })
        .where(eq(billDetails.orderFileId, target.orderFileId));
      await db.update(orderFiles)
        .set({ taskId: located.taskId })
        .where(eq(orderFiles.id, target.orderFileId));

      target.taskId = located.taskId;
      target.hasBankFlow = true;
      affectedTasks.add(located.taskId);

      if (target.createdTaskId === originalTaskId) {
        await deleteEmptyCreatedTask(originalTaskId);
        target.createdTask = false;
      } else {
        await refreshTaskSummary(originalTaskId);
      }
    } else {
      target.hasBankFlow = true;
    }

    if (locatedTaskIds.length > 0) {
      await db.update(recognitionTasks).set({
        ruleId: options.ruleId,
        updatedAt: new Date(),
      }).where(inArray(recognitionTasks.id, locatedTaskIds));
      locatedTaskIds.forEach((taskId) => affectedTasks.add(taskId));
    }

    for (const taskId of locatedTaskIds) {
      queuedTaskIds.add(taskId);
    }
  }

  async function insertBatch(rows: ParsedUploadRow[]) {
    if (rows.length === 0) return;
    const preparedRows: Array<{
      row: Record<string, string>;
      lineNumber: number;
      orderDate: string;
      packageDate: string;
      orderNo: string;
      storageBillNo: string;
      amountRaw: string;
      isRefundOrder: boolean;
      directlyMarkUnmatched: boolean;
    }> = [];
    const orderNosByDate = new Map<string, string[]>();
    let excludedRows = 0;

    for (const { row, lineNumber } of rows) {
      for (const key of Object.keys(row)) headers.add(key);

      if (isExcludeOrderRow(row, excludeOrderConditions, uploadFieldMap)) {
        excludedRows += 1;
        continue;
      }

      const orderNo = orderNoField ? readUploadField(row, orderNoField).trim() : "";
      if (!orderNo && detailPackageType !== "打包明细") {
        skippedRows += 1;
        continue;
      }

      const rawDate = detailPackageType === "打包明细" ? "" : readUploadField(row, dateField);
      const orderDate = detailPackageType === "打包明细" ? uploadDate || UNMATCHED_PACKAGE_BILL_DATE : normalizeDate(rawDate);
      if (!isNormalizedDate(orderDate)) {
        skippedRows += 1;
        continue;
      }
      const packageDate = detailPackageType === "打包明细" ? uploadDate || UNMATCHED_PACKAGE_BILL_DATE : addDays(orderDate, 1);
      if (!isNormalizedDate(packageDate)) {
        skippedRows += 1;
        continue;
      }

      const refundClassification = classifyRefundOrder((field) => getMappedRowValue(row, uploadFieldMap, field));
      if (refundClassification.kind === "invalid") {
        throw new Error(`订单明细第 ${lineNumber} 行${refundClassification.reason || "退款及收支方向判断异常"}，上传失败。`);
      }
      const isRefundOrder = refundClassification.kind === "refund";
      const amountRaw = isRefundOrder
        ? readUploadField(row, refundOrderConfig.amountField)
        : readUploadField(row, incomeField);
      const directlyMarkUnmatched = refundClassification.kind === "unmatched"
        || shouldDirectlyMarkOrderUnmatched(isRefundOrder, amountRaw);

      const storageBillNo = isRefundOrder && orderNo ? `${orderNo}__退款__${lineNumber}` : orderNo;
      preparedRows.push({
        row,
        lineNumber,
        orderDate,
        packageDate,
        orderNo,
        storageBillNo,
        amountRaw,
        isRefundOrder,
        directlyMarkUnmatched,
      });
      if (storageBillNo) {
        const orderNos = orderNosByDate.get(orderDate) || [];
        orderNos.push(storageBillNo);
        orderNosByDate.set(orderDate, orderNos);
      }
    }

    const uniquePackageGroups = new Map<string, { orderDate: string; packageDate: string }>();
    for (const item of preparedRows) {
      const groupKey = `${item.orderDate}|${item.packageDate}`;
      if (!uniquePackageGroups.has(groupKey)) {
        uniquePackageGroups.set(groupKey, { orderDate: item.orderDate, packageDate: item.packageDate });
      }
    }
    const today = getTodayInShanghai();
    const archiveLockDates = Array.from(uniquePackageGroups.values())
      .map((group) => group.packageDate)
      .filter((date) => date >= "1970-01-02" && isBillDetailArchiveEligibleDate(date, today));
    const archiveLockDateSet = new Set(archiveLockDates);

    if (archiveLockDates.length > 0) {
      archiveLockSession ||= await createBillDetailArchiveLockSession();
      await archiveLockSession.acquire(archiveLockDates);
    }
    {
      const existingOrderKeys = new Set<string>();
      const archivedPackageGroups = new Set<string>();
      for (const [groupKey, group] of uniquePackageGroups) {
        const cacheAllowed = !archiveLockDateSet.has(group.packageDate);
        let archivedPackageExists = cacheAllowed ? archivedPackageExistsCache.get(groupKey) : undefined;
        if (archivedPackageExists === undefined) {
          archivedPackageExists = await hasArchivedOrderPackage(db, {
            partitionDate: group.packageDate,
            packageBillDate: group.orderDate,
            detailPackageType,
            ruleId: options.ruleId,
          });
          if (cacheAllowed) archivedPackageExistsCache.set(groupKey, archivedPackageExists);
        }
        if (archivedPackageExists) archivedPackageGroups.add(groupKey);
      }
      for (const [orderDate, orderNos] of orderNosByDate) {
        const packageDate = detailPackageType === "打包明细" ? orderDate : addDays(orderDate, 1);
        if (archivedPackageGroups.has(`${orderDate}|${packageDate}`)) continue;
        const keys = await findExistingOrderKeys(orderDate, orderNos);
        for (const key of keys) existingOrderKeys.add(key);
      }

      const acceptedOrderKeys = new Set<string>();
      const values: Array<typeof billDetails.$inferInsert> = [];
      for (const {
        row,
        orderDate,
        packageDate,
        orderNo,
        storageBillNo,
        amountRaw,
        isRefundOrder,
        directlyMarkUnmatched,
      } of preparedRows) {
        if (archivedPackageGroups.has(`${orderDate}|${packageDate}`)) {
          skippedRows += 1;
          continue;
        }
        const orderKey = `${orderDate}|${storageBillNo}`;
        if (storageBillNo && (existingOrderKeys.has(orderKey) || acceptedOrderKeys.has(orderKey))) continue;
        if (storageBillNo) acceptedOrderKeys.add(orderKey);

        const target = await resolveTarget(packageDate);
        const lifecycleStatus = detailPackageType === "打包明细" && target.taskId <= 0
          ? "unmatched_package"
          : "normal";
        const rowMatch = directlyMarkUnmatched ? null : ruleItemMatcher(row);
        const ruleItem = rowMatch?.item || null;
        const amountVal = isRefundOrder
          ? normalizeRefundAmount(amountRaw)
          : cleanDecimal(amountRaw);
        const keywordField = !conditionRecognitionEnabled ? "" : ruleItem?.keywordField || ruleItems[0]?.keywordField || "商品名称";
        const descVal = readUploadField(row, keywordField);
        const matchStatus = rowMatch?.status || "unmatched";
        const rawData = isPackageTraceUpload
          ? Object.fromEntries(Object.entries(row).filter(([key, value]) => cleanCSVCell(key) && cleanCSVCell(value) !== ""))
          : buildOrderRawData(row, coreRawFields, uploadFieldMap);

        values.push({
          taskId: target.taskId,
          ruleId: options.ruleId,
          orderFileId: target.orderFileId,
          billDate: orderDate,
          partitionDate: packageDate,
          lifecycleStatus: lifecycleStatus as any,
          billNo: storageBillNo || orderNo || null,
          invoiceOtherOrderNo1: readConfiguredInvoiceOrderNoValue(row, invoiceOtherOrderNo1Field),
          invoiceOtherOrderNo2: readConfiguredInvoiceOrderNoValue(row, invoiceOtherOrderNo2Field),
          description: descVal,
          totalAmount: amountVal,
          refundAmountSnapshot: isRefundOrder ? normalizeRefundAmountSnapshot(amountRaw) : "0.00",
          rawData: rawData as any,
          matchStatus: matchStatus as any,
          ruleItemId: matchStatus === "matched" ? ruleItem?.id || null : null,
        });
      }
      if (values.length > 0) {
        const insertResult: any = await db.insert(billDetails).ignore().values(values);
        const affectedRows = Number(
          insertResult?.[0]?.affectedRows
          ?? insertResult?.affectedRows
          ?? values.length,
        );
        if (affectedRows === values.length) {
          for (const detail of values) {
            const target = targetsByOrderFileId.get(Number(detail.orderFileId || 0));
            if (target) recordInsertedDetail(target, detail);
          }
        } else {
          for (const orderFileId of new Set(values.map((detail) => Number(detail.orderFileId || 0)).filter(Boolean))) {
            const target = targetsByOrderFileId.get(orderFileId);
            if (target) target.needsDetailRebuild = true;
          }
        }
      }
    }
    processed += preparedRows.length + excludedRows;
    options.onProgress?.({ processedRows: processed, skippedRows });
  }

  try {
    const parser = isXlsxFile(options.fileName)
      ? parseXlsxRows(options.stream)
      : parseCsvRows(options.stream);

    for await (const { row: rawRow, lineNumber } of parser) {
      const row = cleanCSVRow(rawRow);
      if (!Object.values(row).some((value) => cleanCSVCell(value) !== "")) continue;
      if (!requiredColumnsChecked) {
        validateRequiredUploadColumns(Object.keys(row), requiredUploadFields);
        uploadFieldMap = buildExactFieldMap(Object.keys(row), coreRawFields);
        requiredColumnsChecked = true;
      }
      if (!isPackageTraceUpload && isClearlyNonOrderRow(row)) continue;
      batch.push({ row, lineNumber });
      if (batch.length >= BATCH_SIZE) {
        const current = batch;
        batch = [];
        await insertBatch(current);
      }
    }
    await insertBatch(batch);

    if (processed === 0 || headers.size === 0) throw new Error("明细识别失败，请检查文件");

    const rawColumns = isPackageTraceUpload ? Array.from(headers).join(",") : Array.from(uploadFieldMap.keys()).join(",");
    const refreshedTaskIds = new Set<number>();
    for (const target of targets.values()) {
      if (target.needsDetailRebuild) {
        await refreshTargetDetailCounts(target);
      } else {
        target.isAbnormal = target.inserted > 0 && isZeroOrderTotal(target.activityAmount);
      }
      await persistTargetRecognitionSummary(target);
      if (target.inserted > 0 && target.taskId > 0) affectedTasks.add(target.taskId);
      if (!target.isAbnormal) await attachTargetToBankFlowTask(target);
      if (detailPackageType === "打包明细" && target.taskId > 0 && target.hasBankFlow && !target.isAbnormal) {
        queuedTaskIds.add(target.taskId);
      }

      await db.update(orderFiles).set({
        rawColumns,
        uploadStatus: target.isAbnormal ? "abnormal" : "completed",
        entryCount: target.inserted,
        processedCount: target.inserted,
        orderTotalAmount: target.totalAmount.toFixed(2),
        refundAmount: target.refundAmount.toFixed(2),
        matchedCount: target.matched,
        unmatchedCount: target.unmatched,
        pendingSplitCount: target.pendingSplit,
        recognitionSummaryValid: !target.needsDetailRebuild,
        failedReason: target.isAbnormal ? "订单总金额为0，已标记异常，不参与认账" : null,
      }).where(eq(orderFiles.id, target.orderFileId));
      await syncOrderFilePartitionsByOrderFileId(db, target.orderFileId);

      if (target.taskId > 0) {
        await refreshTaskSummary(target.taskId);
        refreshedTaskIds.add(target.taskId);
      }
    }

    if (multiDayMatchGroupId) {
      await refreshMultiDayMatchGroupTotal(multiDayMatchGroupId);
      await evaluateMultiDayMatchGroup({ groupId: multiDayMatchGroupId });
    }

    const targetBillDates = Array.from(new Set(Array.from(targets.values())
      .filter((target) => target.taskId > 0)
      .map((target) => target.billDate)));
    for (const billDate of targetBillDates) {
      const sameDateRuleTasks = await db
        .select({ id: recognitionTasks.id })
        .from(recognitionTasks)
        .where(and(eq(recognitionTasks.billDate, billDate), eq(recognitionTasks.ruleId, options.ruleId)));
      for (const row of sameDateRuleTasks) {
        const taskId = Number(row.id);
        if (refreshedTaskIds.has(taskId)) continue;
        await refreshTaskSummary(taskId);
        refreshedTaskIds.add(taskId);
      }
    }

    for (const taskId of queuedTaskIds) {
      if (Array.from(targets.values()).some((target) => target.taskId === taskId && target.isAbnormal)) continue;
      await db.update(recognitionTasks).set({
        status: "processing",
        completedAt: null,
        updatedAt: new Date(),
      }).where(eq(recognitionTasks.id, taskId));
      await refreshRecognitionDateSummariesByTaskIds([taskId]);
      void enqueueRecognition(taskId).catch((err) => {
        console.error(`[order-files/upload-stream] 明细认账队列任务 ${taskId} 执行失败:`, err);
      });
    }

    return {
      success: true,
      count: Array.from(targets.values()).reduce((sum, item) => sum + item.inserted, 0),
      matchedCount: Array.from(targets.values()).reduce((sum, item) => sum + item.matched, 0),
      unmatchedCount: Array.from(targets.values()).reduce((sum, item) => sum + item.unmatched, 0),
      pendingSplitCount: Array.from(targets.values()).reduce((sum, item) => sum + item.pendingSplit, 0),
      skippedCount: skippedRows,
      affectedTasks: affectedTasks.size,
      orderFiles: targets.size,
    };
  } catch (err: any) {
    const failedReason = err?.message || "上传失败";
    const cleanupErrors: unknown[] = [];

    try {
      await clearOrderFilePartitionsByOrderFileIds(db, createdOrderFileIds);
    } catch (cleanupErr) {
      cleanupErrors.push(cleanupErr);
    }

    for (const id of createdOrderFileIds) {
      try {
        await db.delete(orderFileRecognitionSummaries)
          .where(eq(orderFileRecognitionSummaries.orderFileId, id));
        await db.delete(billDetails).where(eq(billDetails.orderFileId, id));
      } catch (cleanupErr) {
        cleanupErrors.push(cleanupErr);
      }
    }

    for (const target of targets.values()) {
      try {
        if (target.createdTask) {
          await db.delete(orderFiles).where(eq(orderFiles.id, target.orderFileId));
          await deleteEmptyCreatedTask(target.createdTaskId || target.taskId);
        } else {
          await db.update(orderFiles).set({
            uploadStatus: "failed",
            multiDayMatchGroupId: null,
            processedCount: target.inserted,
            orderTotalAmount: target.totalAmount.toFixed(2),
            refundAmount: target.refundAmount.toFixed(2),
            matchedCount: target.matched,
            unmatchedCount: target.unmatched,
            pendingSplitCount: target.pendingSplit,
            recognitionSummaryValid: false,
            failedReason,
          }).where(eq(orderFiles.id, target.orderFileId));
          if (target.taskId > 0) await refreshExistingTaskAfterRollback(target.taskId);
        }
      } catch (cleanupErr) {
        cleanupErrors.push(cleanupErr);
      }
    }

    if (multiDayMatchGroupId) {
      try {
        await cleanupEmptyMultiDayMatchGroup(multiDayMatchGroupId);
      } catch (cleanupErr) {
        cleanupErrors.push(cleanupErr);
      }
    }

    if (cleanupErrors.length > 0) {
      console.error("订单明细上传失败后的清理未完全成功", cleanupErrors);
    }
    throw err;
  } finally {
    await (archiveLockSession as Awaited<ReturnType<typeof createBillDetailArchiveLockSession>> | null)?.release();
  }
}

export function parseUtf8CsvStream(stream: ReadableStream<Uint8Array>) {
  const nodeStream = Readable.fromWeb(stream as any);
  // Papa Parse decodes Buffer chunks independently; Node keeps split UTF-8 bytes intact here.
  nodeStream.setEncoding("utf8");
  const parser = Papa.parse(Papa.NODE_STREAM_INPUT, { header: true, skipEmptyLines: true });
  nodeStream.pipe(parser);
  return parser;
}

function looksLikeCsvHeader(cells: unknown[]) {
  const headers = cells.map(cleanCSVCell).filter(Boolean);
  if (headers.length < 3) return false;
  if (headers[0]?.startsWith("#")) return false;

  const knownOrderHeaders = [
    "订单号",
    "商户订单号",
    "发生时间",
    "收入金额",
    "收入金额（+元）",
    "商品名称",
    "商品信息",
    "备注",
    "金额",
    "时间",
  ];
  return knownOrderHeaders.some((header) =>
    headers.some((cell) => cell === header || cell.includes(header))
  );
}

export async function* parseCsvRows(stream: ReadableStream<Uint8Array>) {
  yield* parseCsvRowsByHeader({
    stream,
    isHeaderRow: looksLikeCsvHeader,
    cleanCell: cleanCSVCell,
    missingHeaderMessage: "明细识别失败，未找到订单明细表头，请检查文件格式",
  });
}

function getXlsxCellText(cell: ExcelJS.Cell) {
  if (cell.value instanceof Date) {
    const year = cell.value.getFullYear();
    const month = String(cell.value.getMonth() + 1).padStart(2, "0");
    const day = String(cell.value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(cell.text || cell.value || "");
}

export async function* parseXlsxRows(stream: ReadableStream<Uint8Array>) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.read(Readable.fromWeb(stream as any));
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return;

  let headerRowNumber = 0;
  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const maxColumn = Math.max(row.cellCount, row.actualCellCount);
    const cells = Array.from({ length: maxColumn }, (_, index) => getXlsxCellText(row.getCell(index + 1)));
    if (looksLikeCsvHeader(cells)) {
      headerRowNumber = rowNumber;
      break;
    }
  }
  if (!headerRowNumber) {
    throw new Error("明细识别失败，未找到订单明细表头，请检查文件格式");
  }

  const headerRow = worksheet.getRow(headerRowNumber);
  const maxColumn = Math.max(headerRow.cellCount, headerRow.actualCellCount);
  const headers = Array.from({ length: maxColumn }, (_, index) => cleanCSVCell(getXlsxCellText(headerRow.getCell(index + 1))));

  for (let rowNumber = headerRowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const parsedRow: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) parsedRow[header] = getXlsxCellText(row.getCell(index + 1));
    });
    yield { row: parsedRow, lineNumber: row.number };
  }
}
