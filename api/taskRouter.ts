import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { recognitionTasks, recognitionRules, recognitionRuleExcludeConditions, ruleItems, ruleItemSplits, incomeRuleSplits, bankAccounts, bankFlows, billDetails, matchResults, orderFileRecognitionSummaries, orderRecognitionSummaryDeltas, orderFiles, orderFilePartitions, detailSplitFiles, counterpartyRecords, unrecordedCounterparties, voucherReceiptChannels, voucherResultFlows, voucherResultLines, voucherResults, multiDayMatchGroupFlows, multiDayMatchGroups } from "@db/schema";
import { asc, eq, and, sql, count, gt, inArray, isNull, lt, or } from "drizzle-orm";
import { executeIncomeRecognition, executeUploadedIncomeRecognition } from "./incomeRuleRouter";
import type { UploadedIncomeRecognitionCandidate } from "./lib/uploadedIncomeRecognition";
import { enqueueRecognition } from "./lib/recognitionQueue";
import {
  calculateManagementFeeAmount,
  calculateManagementFeeAmountByType,
  deriveFlowRecognitionStatus,
  formatCents,
  getSignedRecognitionAvailableCents,
  hasRecognitionProgress,
  isSignedAmountWithinAvailable,
  splitAmountByRatios,
  toCents,
} from "./lib/splitAmounts";
import { buildMatchResultDisplaySnapshot } from "./lib/matchResultSnapshot";
import { attachCounterpartyMatchers, getPrimaryCounterpartyMatcher } from "./lib/counterpartyMatchers";
import { createDetailRuleItemMatcher, findStaleDetailRuleItemIds } from "./lib/detailRuleMatcher";
import { userHasPermission } from "./lib/permissions";
import { clearBillDetailMatchResults } from "./lib/billDetailCleanup";
import { clearOrderFilePartitionsByOrderFileIds, moveOrderFilePartitionDetail, syncOrderFilePartitionsByOrderFileId } from "./lib/orderFilePartitions";
import {
  getDetailSourceTables,
  getBillDetailForManualRecognition,
  hasArchivedOrderPackage,
  listTaskDateBillDetails,
} from "./lib/billDetailArchiveRead";
import {
  refreshArchiveRunSnapshots,
  restoreArchivedDetailToHotTable,
} from "./lib/billDetailArchiveWrite";
import {
  isBillDetailArchiveEligibleDate,
  withBillDetailArchiveDateLocks,
} from "./lib/billDetailArchiveLocks";
import {
  canCancelFlowRecognition,
  chunkRecognitionCancellationDetailIds,
  classifyRecognitionCancellationDetailCoverage,
  deriveDetailOperationCancellationDecision,
  deriveDetailOperationOriginalTaskId,
  deriveFlowRecognitionCancellationScope,
  getRecognitionResultKind,
  hasArchivedRecognitionDetails,
  mergeFlowRecognitionCancellationScopes,
  partitionRecognitionResultIds,
  retryCommittedRecognitionCancellationRefresh,
  selectRecognitionResultGroup,
  type FlowRecognitionCancellationScopeType,
} from "./lib/recognitionCancellation";
import {
  DETAIL_SPLIT_RECOGNITION_WRITE_INDEX,
  RECOGNITION_DETAILS_CHANGED_MESSAGE,
  summarizeRecognitionWriteCoverage,
} from "./lib/recognitionWriteIntegrity";
import { findFirstAmountCombination, findVarianceAdjustmentSuggestion } from "./lib/varianceAdjustment";
import { calculatePartialTransferAmount, resolvePartialTransferPendingTaskIds } from "./lib/partialTransferAmount";
import { isVoucherScopeFullyCreated } from "./lib/voucherCreation";
import {
  isBankDirectDonation,
  normalizeProjectCenters,
  validateMemberProjectCenterRequirement,
} from "./lib/projectCenter";
import {
  countRecognitionDateSummaries,
  getRecognitionDateSummaryByBillDate,
  listRecognitionDateSummaries,
  refreshRecognitionDateSummariesByTaskIds,
  refreshRecognitionDateSummary,
} from "./lib/recognitionDateSummary";
import {
  cleanupEmptyMultiDayMatchGroup,
  evaluateMultiDayMatchGroup,
  getMultiDayMatchGroupByTaskId,
  getMultiDayMatchGroupFlows,
  isMultiDayDetailCounterparty,
  refreshMultiDayMatchGroupTotal,
  retryPendingMultiDayGroupsForBillDate,
  retryPendingMultiDayGroupsForFlowIds,
} from "./lib/multiDayDetailMatching";
import {
  allocateRecognizedAmountAcrossFlows,
  ensureSameDayAggregateTask,
} from "./lib/sameDayDetailTask";
import {
  loadBankFlowCounterparties,
  resolveBankFlowCounterparty,
} from "./lib/bankFlowCounterpartyMatching";
import { filterIngestibleBankFlows } from "./lib/bankFlowUpload";
import {
  assertBankFlowRecognitionEligible,
  getBankFlowDirection,
  isBankFlowRecognitionEligible,
} from "./lib/bankFlowRecognitionEligibility";
import { deriveBankFlowDisplayStatus } from "./lib/bankFlowRecognitionStatus";
import {
  createRefundOrderClassifier,
  isExcludedOrder,
  shouldDirectlyMarkOrderUnmatched,
  type ExcludeOrderConditionConfig,
} from "./lib/orderRuleClassification";
import { getConfiguredInvoiceOrderNoFields } from "./lib/orderUploadStream";
import {
  buildInvoiceOrderFieldSnapshot,
  readConfiguredInvoiceOrderNoValue,
} from "./lib/invoiceOrderFields";
import {
  deriveFreshOrderRecognitionPhaseSummaries,
  orderRecognitionSummaryKey,
  summarizeOrderRecognitionFiles,
  summarizeOrderRecognitionGroups,
  type OrderRecognitionPhaseSummary,
  type OrderRecognitionSummaryGroup,
} from "./lib/orderRecognitionSummary";
import {
  aggregateRecognitionSummaryDeltaRows,
  applyRecognitionSummaryDelta,
  deleteSourceRecognitionSummaryDeltas,
  deleteTargetRecognitionSummaryDeltas,
  subtractRecognitionSummaryDeltaGroups,
} from "./lib/orderRecognitionDelta";
import {
  deleteManualOrderWorkItemsByOrderFileIds,
  getManualOrderWorkItemLocators,
  listManualOrderWorkItems,
  syncManualOrderWorkItemsByDetailIds,
  syncManualOrderWorkItemsByTaskIds,
} from "./lib/manualOrderWorkItems";

const DELETE_TASK_STEPS = [
  "正在回滚分账包状态",
  "正在删除入账结果",
  "正在删除订单明细包",
  "正在删除银行到账",
  "正在删除账单日期任务",
] as const;

type DeleteTaskSessionStatus = "running" | "completed" | "failed";

type DeleteTaskSession = {
  deleteId: string;
  taskId: number;
  billDate: string;
  status: DeleteTaskSessionStatus;
  step: number;
  totalSteps: number;
  message: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
};

const deleteTaskSessions = new Map<string, DeleteTaskSession>();
const DELETE_TASK_SESSION_TTL = 30 * 60 * 1000;

function cleanupDeleteTaskSessions() {
  const now = Date.now();
  for (const [deleteId, session] of deleteTaskSessions.entries()) {
    const finishedAt = session.completedAt || session.startedAt;
    if (now - finishedAt > DELETE_TASK_SESSION_TTL) {
      deleteTaskSessions.delete(deleteId);
    }
  }
}

function createDeleteTaskSession(taskId: number, billDate = "") {
  cleanupDeleteTaskSessions();
  const deleteId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const session: DeleteTaskSession = {
    deleteId,
    taskId,
    billDate,
    status: "running",
    step: 1,
    totalSteps: DELETE_TASK_STEPS.length,
    message: DELETE_TASK_STEPS[0],
    startedAt: Date.now(),
  };
  deleteTaskSessions.set(deleteId, session);
  return session;
}

function updateDeleteTaskSession(deleteId: string, patch: Partial<DeleteTaskSession>) {
  const session = deleteTaskSessions.get(deleteId);
  if (!session) return;
  deleteTaskSessions.set(deleteId, { ...session, ...patch });
}

function normalizeManagementFeeRatio(value?: string | null) {
  const parsed = parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : "0";
}

function normalizeManagementFeeType(value?: string | null) {
  return value === "金额" ? "金额" : "比例";
}

function normalizeManagementFeeValue(value?: string | null) {
  const parsed = Number(String(value ?? "0"));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed.toFixed(2) : "0.00";
}

function normalizeRegion(value?: string | null) {
  return ["北京市", "外省市", "港澳台", "境外", "内部客商"].includes(String(value || "")) ? value : null;
}

function isAggregateDetailCounterparty(counterparty: any) {
  return counterparty?.recognitionType === "明细认账"
    && ["同日汇总匹配", "多日汇总匹配"].includes(counterparty?.detailMatchingMode);
}

function isSameDayAggregateDetailCounterparty(counterparty: any) {
  return counterparty?.recognitionType === "明细认账" && counterparty?.detailMatchingMode === "同日汇总匹配";
}

function isZeroOrderTotal(value: number) {
  return toCents(value) === 0;
}

function renderManualExpenseFundSource(template: string | null | undefined, flow: any) {
  return String(template || "").replace(/\[到账户名\]/g, flow.counterpartyName || "");
}

function getManualMembershipExpenseFundSource(budgetCode?: string | null) {
  return String(budgetCode || "").trim() === "2.1-其他银行直捐"
    ? "非限定性-项目中心-企业家捐赠"
    : "非限定性_企业家捐赠";
}

async function validateVoucherReceiptChannelCode(db: ReturnType<typeof getDb>, value?: string | null) {
  const channelCode = String(value || "").trim();
  if (!channelCode) return null;
  const [channel] = await db
    .select({ id: voucherReceiptChannels.id })
    .from(voucherReceiptChannels)
    .where(eq(voucherReceiptChannels.channelCode, channelCode));
  if (!channel) throw new Error("收款渠道不存在或已删除");
  return channelCode;
}

function normalizeSplitRatio(value?: string | null) {
  const parsed = parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : "0";
}

const manualDonationSourceValues = ["互联网募捐平台", "银行直捐", "拍卖"] as const;
const manualSimpleIncomeTypes = ["政府补助", "利息", "个税返还", "本金", "投资收益"];
const manualRemarkOnlyIncomeTypes = ["其他收入", "其他"];
const interestExpenseFundSource = "非限定性-利息收入";
type ManualSplitMode = "platform" | "direct" | "membership" | "interest" | "remarkOnly";

function normalizeManualDonationSource(value?: string | null, incomeType?: string | null) {
  if (!["捐赠收入", "订单退款"].includes(String(incomeType || ""))) return null;
  return manualDonationSourceValues.includes(value as (typeof manualDonationSourceValues)[number]) ? value : null;
}

function getManualSplitMode(incomeType?: string | null, donationSource?: string | null): ManualSplitMode {
  if (manualRemarkOnlyIncomeTypes.includes(String(incomeType || ""))) return "remarkOnly";
  if (manualSimpleIncomeTypes.includes(String(incomeType || ""))) return "interest";
  if (incomeType === "会费收入") return "membership";
  const normalizedDonationSource = normalizeManualDonationSource(donationSource, incomeType);
  if (normalizedDonationSource === "互联网募捐平台") return "platform";
  return "direct";
}

function hasManualManagementFeeInput(split: { managementFeeValue?: string | null; managementFeeRatio?: string | null }) {
  return String(split.managementFeeValue ?? split.managementFeeRatio ?? "").trim() !== "";
}

function deriveManualRecognitionType(split: { incomeType?: string | null; donationSource?: string | null }) {
  return ["捐赠收入", "订单退款"].includes(String(split.incomeType || ""))
    && split.donationSource === "银行直捐"
    ? "银行直捐"
    : "渠道捐赠";
}

function isManualDetailRecognitionResult(result: typeof matchResults.$inferSelect) {
  return !!result.bankFlowId &&
    !result.ruleItemId &&
    !result.incomeRuleId &&
    Number(result.orderDetailCountSnapshot || 0) === 1;
}

const manualRecognitionSplitInput = z.object({
  splitForm: z.enum(["百分比", "金额"]).optional().default("百分比"),
  splitRatio: z.string().optional().default("0"),
  splitAmount: z.string().optional().default("0"),
  incomeType: z.string().nullable().optional(),
  donationSource: z.enum(manualDonationSourceValues).nullable().optional(),
  incomeAttr: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
  incomeDept: z.string().nullable().optional(),
  budgetCode: z.string().nullable().optional(),
  incomeProject: z.string().nullable().optional(),
  platformProjectName: z.string().nullable().optional(),
  platformProjectDetail: z.string().nullable().optional(),
  feedbackType: z.enum(["反馈", "重点反馈"]).nullable().optional(),
  memberName: z.string().nullable().optional(),
  projectCenter: z.string().nullable().optional(),
  membershipPaymentYears: z.string().nullable().optional(),
  region: z.enum(["北京市", "外省市", "港澳台", "境外", "内部客商"]).nullable().optional(),
  isAnonymous: z.boolean().optional().default(false),
  managementFeeType: z.enum(["比例", "金额"]).nullable().optional(),
  managementFeeValue: z.string().nullable().optional(),
  managementFeeRatio: z.string().nullable().optional(),
  expenseFundSource: z.string().nullable().optional(),
});

function calculateManualSplitAmounts(
  totalAmount: number | string,
  splits: Array<z.infer<typeof manualRecognitionSplitInput>>,
) {
  const totalCents = toCents(totalAmount);
  const percentIndexes: number[] = [];
  const splitCents = splits.map((split, index) => {
    if (split.splitForm === "金额") return toCents(split.splitAmount);
    percentIndexes.push(index);
    return Math.round(totalCents * Number(normalizeSplitRatio(split.splitRatio)) / 100);
  });
  const splitTotalCents = splitCents.reduce((sum, amount) => sum + amount, 0);
  const roundingDiff = totalCents - splitTotalCents;
  if (roundingDiff !== 0) {
    if (percentIndexes.length === 0 || Math.abs(roundingDiff) > 1) {
      throw new Error(`分账金额合计必须等于认账金额 ${formatCents(totalCents)}，当前为 ${formatCents(splitTotalCents)}`);
    }
    splitCents[percentIndexes[percentIndexes.length - 1]] += roundingDiff;
  }
  if (splitCents.some((amount) => (
    amount === 0
    || (totalCents > 0 && amount < 0)
    || (totalCents < 0 && amount > 0)
  ))) {
    throw new Error("分账金额必须与认账金额方向一致且不能为0");
  }
  return splitCents.map(formatCents);
}

function calculateManualDerivedSplitRatio(splitAmount: number | string, totalAmount: number | string) {
  const totalCents = toCents(totalAmount);
  if (totalCents === 0) return "0";
  const amountCents = toCents(splitAmount);
  return ((amountCents * 100) / totalCents).toFixed(2);
}

function normalizeMembershipPaymentYears(value?: string | null) {
  const text = String(value ?? "").trim();
  return /^[1-9]\d*$/.test(text) ? parseInt(text, 10) : null;
}

function validateManualRecognitionRequiredFields(splits: Array<z.infer<typeof manualRecognitionSplitInput>>) {
  splits.forEach((split, index) => {
    const mode = getManualSplitMode(split.incomeType, split.donationSource);
    if (split.splitForm === "金额") {
      if (toCents(split.splitAmount) === 0) throw new Error(`分账 ${index + 1} 金额不能为空或0`);
    } else if (!split.splitRatio || Number(split.splitRatio) <= 0) {
      throw new Error(`分账 ${index + 1} 百分比不能为空或0`);
    }
    if (!split.incomeType?.trim()) {
      throw new Error(`分账 ${index + 1} 收入类型不能为空`);
    }
    if (
      ["捐赠收入", "订单退款"].includes(split.incomeType)
      && !normalizeManualDonationSource(split.donationSource, split.incomeType)
    ) {
      throw new Error(`分账 ${index + 1} 捐赠来源不能为空`);
    }
    if (!split.incomeAttr?.trim()) {
      throw new Error(`分账 ${index + 1} 收入属性不能为空`);
    }
    if (mode === "remarkOnly") return;
    if (!split.incomeDept?.trim()) {
      throw new Error(`分账 ${index + 1} 收入部门不能为空`);
    }
    if (!split.budgetCode?.trim()) {
      throw new Error(`分账 ${index + 1} 预算编码不能为空`);
    }
    if (!split.incomeProject?.trim()) {
      throw new Error(`分账 ${index + 1} NC项目名称不能为空`);
    }
    if (mode === "platform" && !split.platformProjectName?.trim()) {
      throw new Error(`分账 ${index + 1} 平台项目名称不能为空`);
    }
    if (mode === "platform" && !split.platformProjectDetail?.trim()) {
      throw new Error(`分账 ${index + 1} 平台项目详情不能为空`);
    }
    if (mode !== "platform" && mode !== "interest" && !split.feedbackType) {
      throw new Error(`分账 ${index + 1} 反馈类型不能为空`);
    }
    if (mode !== "platform" && mode !== "interest" && !split.region) {
      throw new Error(`分账 ${index + 1} 地区不能为空`);
    }
    if (mode === "membership" && !split.memberName?.trim()) {
      throw new Error(`分账 ${index + 1} 会员姓名不能为空`);
    }
    validateMemberProjectCenterRequirement(split, `分账 ${index + 1} `);
    if (mode === "membership" && !normalizeMembershipPaymentYears(split.membershipPaymentYears)) {
      throw new Error(`分账 ${index + 1} 缴纳年限不能为空且必须为正整数`);
    }
    if (mode !== "membership" && mode !== "interest" && !hasManualManagementFeeInput(split)) {
      throw new Error(`分账 ${index + 1} 管理费不能为空`);
    }
    if (mode !== "membership" && mode !== "interest" && !split.expenseFundSource?.trim()) {
      throw new Error(`分账 ${index + 1} 支出资金来源不能为空`);
    }
  });
}

function cleanCSVCell(value: unknown) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^[`'"]+/, "")
    .replace(/[`'"]+$/, "")
    .trim();
}

function cleanCSVRow(row: Record<string, string>) {
  const cleaned: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(row)) {
    const key = cleanCSVCell(rawKey);
    if (!key || key === "__parsed_extra") continue;
    cleaned[key] = cleanCSVCell(rawValue);
  }
  return cleaned;
}

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
  const candidates = [preferred, ...aliases].filter(Boolean);
  for (const key of candidates) {
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

function isExcludeOrderRow(
  row: Record<string, string>,
  conditions: ExcludeOrderConditionConfig[],
) {
  return isExcludedOrder(conditions, (field) => getRowValue(row, field));
}

function normalizeUploadAmount(value: unknown) {
  const cleaned = cleanCSVCell(value).replace(/,/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
}

function normalizeRefundUploadAmount(value: unknown) {
  const parsed = Math.abs(Number(normalizeUploadAmount(value)));
  return parsed > 0 ? `-${parsed.toFixed(2)}` : "0.00";
}

function normalizeRefundUploadAmountSnapshot(value: unknown) {
  const parsed = Math.abs(Number(normalizeUploadAmount(value)));
  return parsed > 0 ? parsed.toFixed(2) : "0.00";
}

/**
 * 统一日期格式为 YYYY-MM-DD
 */
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

type SupportedBankName = "广发银行" | "工商银行" | "中国银行";

function normalizeUploadedBankAccountNo(value?: string | null) {
  return String(value || "").replace(/\s+/g, "").trim();
}

async function resolveUploadedBankAccountId(
  db: ReturnType<typeof getDb>,
  bankName: SupportedBankName,
  accountNo: string,
) {
  const normalizedAccountNo = normalizeUploadedBankAccountNo(accountNo);
  if (!normalizedAccountNo) return null;

  await db.insert(bankAccounts).values({
    bankName,
    accountNo: normalizedAccountNo,
    accountAlias: "",
    sourceType: "upload",
    isDefault: false,
  }).onDuplicateKeyUpdate({
    set: {
      sourceType: "upload",
      updatedAt: new Date(),
    },
  });

  const [account] = await db.select({ id: bankAccounts.id, isDefault: bankAccounts.isDefault })
    .from(bankAccounts)
    .where(and(eq(bankAccounts.bankName, bankName), eq(bankAccounts.accountNo, normalizedAccountNo)));
  if (!account) throw new Error("保存银行到账账号失败");

  const [currentDefault] = await db.select({ id: bankAccounts.id }).from(bankAccounts)
    .where(and(eq(bankAccounts.bankName, bankName), eq(bankAccounts.isDefault, true)))
    .orderBy(asc(bankAccounts.id));
  if (!currentDefault) {
    await db.update(bankAccounts).set({ isDefault: true }).where(eq(bankAccounts.id, Number(account.id)));
  }
  return Number(account.id);
}

function isNormalizedDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function excludeAbnormalOrderFilesSql() {
  return sql`NOT EXISTS (SELECT 1 FROM order_files of_abnormal WHERE of_abnormal.id = ${billDetails.orderFileId} AND of_abnormal.upload_status = 'abnormal')`;
}

function recognizableDetailOperationSql() {
  return sql`(
    COALESCE(${billDetails.operationStatus}, 'active') = 'active'
    OR (
      ${billDetails.operationStatus} = 'transferred'
      AND EXISTS (
        SELECT 1 FROM order_files of_transferable
        WHERE of_transferable.id = ${billDetails.orderFileId}
          AND COALESCE(of_transferable.detail_package_type, 'T+1') = 'T+1'
      )
    )
  )`;
}

function transferredT1TaskScopeSql(taskId: number) {
  return and(
    eq(billDetails.taskId, taskId),
    eq(billDetails.operationStatus, "transferred"),
    sql`EXISTS (
      SELECT 1 FROM order_files of_transferable_scope
      WHERE of_transferable_scope.id = ${billDetails.orderFileId}
        AND COALESCE(of_transferable_scope.detail_package_type, 'T+1') = 'T+1'
    )`,
  );
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

type DetailPackageType = "T+1" | "打包明细";

async function getDetailPackageTypeForRule(ruleId: number): Promise<DetailPackageType> {
  const db = getDb();
  const [row] = await db
    .select({ detailPackageType: counterpartyRecords.detailPackageType })
    .from(recognitionRules)
    .leftJoin(counterpartyRecords, eq(counterpartyRecords.alias, recognitionRules.matchedCounterpartyAlias))
    .where(eq(recognitionRules.id, ruleId));
  return row?.detailPackageType === "打包明细" ? "打包明细" : "T+1";
}

function detailPackageScopeSql(summaryDate: string, packageType: DetailPackageType) {
  if (packageType === "打包明细") {
    return sql`EXISTS (
      SELECT 1 FROM order_files of_pkg
      WHERE of_pkg.id = ${billDetails.orderFileId}
        AND of_pkg.detail_package_type = '打包明细'
        AND of_pkg.upload_date = ${summaryDate}
    )`;
  }
  return and(
    eq(billDetails.billDate, addDays(summaryDate, -1)),
    sql`EXISTS (
      SELECT 1 FROM order_files of_pkg
      WHERE of_pkg.id = ${billDetails.orderFileId}
        AND COALESCE(of_pkg.detail_package_type, 'T+1') = 'T+1'
    )`,
  );
}

type DirectRecognitionOrderFile = {
  id: number;
  taskId: number;
  uploadStatus: string;
  recognitionSummaryValid: boolean;
  entryCount: number;
  orderTotalAmount: string;
  refundAmount: string;
  matchedCount: number;
  unmatchedCount: number;
  pendingSplitCount: number;
};

async function getDirectRecognitionOrderFiles(input: {
  taskId: number;
  ruleId: number;
  packageType: DetailPackageType;
  aggregateTaskIds?: number[];
}): Promise<DirectRecognitionOrderFile[]> {
  if (input.packageType !== "T+1") return [];
  const db = getDb();
  const taskIds = Array.from(new Set([input.taskId, ...(input.aggregateTaskIds || [])].map(Number).filter(Boolean)));
  if (taskIds.length === 0) return [];
  const rows = await db.select({
    id: orderFiles.id,
    taskId: orderFiles.taskId,
    uploadStatus: orderFiles.uploadStatus,
    recognitionSummaryValid: orderFiles.recognitionSummaryValid,
    entryCount: orderFiles.entryCount,
    orderTotalAmount: orderFiles.orderTotalAmount,
    refundAmount: orderFiles.refundAmount,
    matchedCount: orderFiles.matchedCount,
    unmatchedCount: orderFiles.unmatchedCount,
    pendingSplitCount: orderFiles.pendingSplitCount,
  })
    .from(orderFiles)
    .where(and(
      inArray(orderFiles.taskId, taskIds),
      eq(orderFiles.ruleId, input.ruleId),
      sql`COALESCE(${orderFiles.detailPackageType}, 'T+1') = 'T+1'`,
      sql`COALESCE(${orderFiles.uploadStatus}, 'completed') <> 'abnormal'`,
    ));
  return rows.map((row) => ({
    id: Number(row.id || 0),
    taskId: Number(row.taskId || 0),
    uploadStatus: String(row.uploadStatus || "completed"),
    recognitionSummaryValid: Boolean(row.recognitionSummaryValid),
    entryCount: Number(row.entryCount || 0),
    orderTotalAmount: String(row.orderTotalAmount || "0.00"),
    refundAmount: String(row.refundAmount || "0.00"),
    matchedCount: Number(row.matchedCount || 0),
    unmatchedCount: Number(row.unmatchedCount || 0),
    pendingSplitCount: Number(row.pendingSplitCount || 0),
  })).filter((row) => row.id > 0);
}

async function loadOrderFileRecognitionSummary(
  directOrderFiles: DirectRecognitionOrderFile[],
  enabled: boolean,
) {
  const orderFileIds = directOrderFiles.map((file) => file.id);
  const emptyResult = {
    cachedOrderFileIds: [] as number[],
    fallbackOrderFileIds: orderFileIds,
    cachedFiles: [] as DirectRecognitionOrderFile[],
    fileSummary: summarizeOrderRecognitionFiles([]),
    groups: new Map<string, OrderRecognitionSummaryGroup>(),
  };
  if (!enabled || orderFileIds.length === 0) return emptyResult;

  const db = getDb();
  const cachedFiles = directOrderFiles.filter(
    (file) => file.uploadStatus === "completed" && file.recognitionSummaryValid,
  );
  const cachedOrderFileIds = cachedFiles.map((file) => file.id);
  if (cachedOrderFileIds.length === 0) return emptyResult;

  const [rows, deltaRows] = await Promise.all([
    db
      .select({
        ruleItemId: orderFileRecognitionSummaries.ruleItemId,
        isRefund: orderFileRecognitionSummaries.isRefund,
        detailCount: orderFileRecognitionSummaries.detailCount,
        totalAmount: orderFileRecognitionSummaries.totalAmount,
      })
      .from(orderFileRecognitionSummaries)
      .where(inArray(orderFileRecognitionSummaries.orderFileId, cachedOrderFileIds)),
    db
      .select({
        summaryKind: orderRecognitionSummaryDeltas.summaryKind,
        ruleItemId: orderRecognitionSummaryDeltas.ruleItemId,
        isRefund: orderRecognitionSummaryDeltas.isRefund,
        detailCount: orderRecognitionSummaryDeltas.detailCount,
        totalAmount: orderRecognitionSummaryDeltas.totalAmount,
      })
      .from(orderRecognitionSummaryDeltas)
      .where(and(
        eq(orderRecognitionSummaryDeltas.deltaType, "source_deduction"),
        inArray(orderRecognitionSummaryDeltas.orderFileId, cachedOrderFileIds),
      )),
  ]);
  const baseGroups = new Map<string, OrderRecognitionSummaryGroup>();
  for (const row of rows) {
    const ruleItemId = Number(row.ruleItemId || 0);
    if (!ruleItemId) continue;
    const isRefund = Number(row.isRefund || 0) === 1;
    const key = orderRecognitionSummaryKey(ruleItemId, isRefund);
    const current = baseGroups.get(key) || {
      ruleItemId,
      isRefund,
      detailCount: 0,
      totalCents: 0,
    };
    current.detailCount += Number(row.detailCount || 0);
    current.totalCents += toCents(row.totalAmount || 0);
    baseGroups.set(key, current);
  }
  const deductions = aggregateRecognitionSummaryDeltaRows(deltaRows);
  const groups = subtractRecognitionSummaryDeltaGroups(baseGroups, deductions.groups);
  if (!groups) return emptyResult;

  const baseFileSummary = summarizeOrderRecognitionFiles(cachedFiles);
  const fileSummary = {
    ...baseFileSummary,
    totalCents: baseFileSummary.totalCents - deductions.totalCents,
    count: baseFileSummary.count - deductions.count,
  };
  if (fileSummary.count < 0) return emptyResult;
  const groupSummary = summarizeOrderRecognitionGroups(groups.values());
  const effectiveMatchedCount = cachedFiles.reduce(
    (sum, file) => sum + Number(file.matchedCount || 0),
    0,
  );
  const effectiveDetailCount = cachedFiles.reduce(
    (sum, file) => sum
      + Number(file.matchedCount || 0)
      + Number(file.unmatchedCount || 0)
      + Number(file.pendingSplitCount || 0),
    0,
  );
  if (
    groupSummary.count !== effectiveMatchedCount
    || fileSummary.count !== effectiveDetailCount
  ) return emptyResult;

  const cachedIdSet = new Set(cachedOrderFileIds);
  return {
    cachedOrderFileIds,
    fallbackOrderFileIds: orderFileIds.filter((id) => !cachedIdSet.has(id)),
    cachedFiles,
    fileSummary,
    groups,
  };
}

async function getDirectRecognitionPartitionDates(orderFileIds: number[]) {
  if (orderFileIds.length === 0) return [];
  const rows = await getDb()
    .select({
      orderFileId: orderFilePartitions.orderFileId,
      partitionDate: orderFilePartitions.partitionDate,
    })
    .from(orderFilePartitions)
    .where(inArray(orderFilePartitions.orderFileId, orderFileIds));
  const locatedFileIds = new Set(rows.map((row) => Number(row.orderFileId || 0)).filter(Boolean));
  if (orderFileIds.some((id) => !locatedFileIds.has(id))) return [];
  return Array.from(new Set(rows
    .map((row) => String(row.partitionDate || ""))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))));
}

async function getTransferredT1TaskDetailCounts(taskId: number, ruleId: number) {
  const [row] = await getDb()
    .select({
      totalCount: count(),
      openCount: sql<number>`SUM(CASE WHEN ${billDetails.matchResultId} IS NULL THEN 1 ELSE 0 END)`,
    })
    .from(billDetails)
    .innerJoin(orderFiles, eq(orderFiles.id, billDetails.orderFileId))
    .where(and(
      eq(billDetails.taskId, taskId),
      eq(billDetails.ruleId, ruleId),
      eq(billDetails.operationStatus, "transferred"),
      eq(orderFiles.detailPackageType, "T+1"),
      sql`COALESCE(${orderFiles.uploadStatus}, 'completed') <> 'abnormal'`,
    ));
  return {
    totalCount: Number(row?.totalCount || 0),
    openCount: Number(row?.openCount || 0),
  };
}

async function loadTaskTransferRecognitionSummary(input: {
  taskId: number;
  ruleId: number;
  partitionDate: string;
  expectedOpenCount: number;
  enabled: boolean;
}) {
  const emptyResult = {
    valid: input.expectedOpenCount === 0,
    count: 0,
    totalCents: 0,
    groups: new Map<string, OrderRecognitionSummaryGroup>(),
  };
  if (!input.enabled || input.expectedOpenCount === 0) return emptyResult;

  const rows = await getDb()
    .select({
      summaryKind: orderRecognitionSummaryDeltas.summaryKind,
      ruleItemId: orderRecognitionSummaryDeltas.ruleItemId,
      isRefund: orderRecognitionSummaryDeltas.isRefund,
      detailCount: orderRecognitionSummaryDeltas.detailCount,
      totalAmount: orderRecognitionSummaryDeltas.totalAmount,
    })
    .from(orderRecognitionSummaryDeltas)
    .where(and(
      eq(orderRecognitionSummaryDeltas.deltaType, "target_transfer_in"),
      eq(orderRecognitionSummaryDeltas.taskId, input.taskId),
      eq(orderRecognitionSummaryDeltas.ruleId, input.ruleId),
      eq(orderRecognitionSummaryDeltas.partitionDate, input.partitionDate),
    ));
  const summary = aggregateRecognitionSummaryDeltaRows(rows);
  const groupedCount = summarizeOrderRecognitionGroups(summary.groups.values()).count;
  return {
    valid: summary.count === input.expectedOpenCount
      && summary.count >= 0
      && groupedCount <= summary.count
      && Array.from(summary.groups.values()).every((group) => group.detailCount > 0),
    ...summary,
  };
}

function jsonPathForField(fieldName: string) {
  return `$."${fieldName.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const refundDetailWhereSql = (isRefund: boolean) =>
  isRefund
    ? sql`CAST(${billDetails.refundAmountSnapshot} AS DECIMAL(18,2)) > 0`
    : sql`CAST(${billDetails.refundAmountSnapshot} AS DECIMAL(18,2)) <= 0`;

type TaskDisplayStatus = "pending_recognition" | "processing" | "large_variance" | "partial_matched" | "completed";
type FlowRecognitionStatus = "unrecognized" | "partial_matched" | "recognized" | "large_variance";
type AggregateFlowStatus = {
  status: Exclude<FlowRecognitionStatus, "large_variance">;
  recognizedAmount: number;
  recognitionAvailableAmount: number;
  allResultsVouchered: boolean;
  hasArchivedDetails: boolean;
};
type FlowRecognitionCancellationScope = {
  type: FlowRecognitionCancellationScopeType;
  clickedFlow: typeof bankFlows.$inferSelect;
  flows: Array<typeof bankFlows.$inferSelect>;
  taskIds: number[];
  results: Array<typeof matchResults.$inferSelect>;
};
type SyncTaskFlowRecognitionStatusOptions = {
  preserveLargeVariance?: boolean;
};
type RefreshTaskStatusByFlowsOptions = SyncTaskFlowRecognitionStatusOptions & {
  refreshDateSummary?: boolean;
};

function normalizeSummaryStatusFilter(status?: string) {
  if (!status) return undefined;
  return status === "pending_details" ? "pending_recognition" : status;
}

function recognitionEligibleMatchResultWhere() {
  return sql`(
    ${matchResults.bankFlowId} IS NULL
    OR EXISTS (
      SELECT 1
      FROM bank_flows eligible_result_flow
      WHERE eligible_result_flow.id = ${matchResults.bankFlowId}
        AND CAST(eligible_result_flow.income AS DECIMAL(18,2)) > 0
    )
  )`;
}

async function getTaskFlowProgress(taskIds: number[]) {
  const db = getDb();
  if (taskIds.length === 0) return new Map<number, { allTotal: number; total: number; recognized: number; resultCount: number }>();

  const flowRows = await db
    .select({
      taskId: bankFlows.taskId,
      allTotal: count(),
      total: sql<number>`SUM(CASE WHEN CAST(${bankFlows.income} AS DECIMAL(18,2)) > 0 THEN 1 ELSE 0 END)`,
      recognized: sql<number>`SUM(CASE WHEN CAST(${bankFlows.income} AS DECIMAL(18,2)) > 0 AND ${bankFlows.recognitionStatus} = 'recognized' THEN 1 ELSE 0 END)`,
    })
    .from(bankFlows)
    .where(inArray(bankFlows.taskId, taskIds))
    .groupBy(bankFlows.taskId);
  const resultRows = await db
    .select({
      taskId: matchResults.taskId,
      resultCount: count(),
    })
    .from(matchResults)
    .where(and(
      inArray(matchResults.taskId, taskIds),
      recognitionEligibleMatchResultWhere(),
    ))
    .groupBy(matchResults.taskId);
  const resultCountByTaskId = new Map(resultRows.map((row) => [Number(row.taskId), Number(row.resultCount || 0)]));

  return new Map(flowRows.map((row) => [
    Number(row.taskId),
    {
      allTotal: Number(row.allTotal || 0),
      total: Number(row.total || 0),
      recognized: Number(row.recognized || 0),
      resultCount: resultCountByTaskId.get(Number(row.taskId)) || 0,
    },
  ]));
}

function deriveTaskStatus(rawStatus: string, progress?: { allTotal?: number; total: number; recognized: number; resultCount: number }): TaskDisplayStatus {
  if (rawStatus === "processing") return "processing";
  if (rawStatus === "large_variance") return "large_variance";
  if (rawStatus === "partial_matched") return "partial_matched";
  const total = progress?.total || 0;
  const recognized = progress?.recognized || 0;
  if ((progress?.allTotal || 0) > 0 && total === 0) return "completed";
  if (total > 0 && recognized >= total) return "completed";
  if (recognized > 0 || (progress?.resultCount || 0) > 0) return "partial_matched";
  return "pending_recognition";
}

async function refreshTaskStatusByFlows(
  taskId: number,
  options: RefreshTaskStatusByFlowsOptions = {},
) {
  const db = getDb();
  await syncTaskFlowRecognitionStatus(taskId, options);
  const aggregateContext = await getAggregateDetailTaskContext(taskId);
  if (aggregateContext?.flows.length) {
    const aggregateStatusByFlowId = await getAggregateFlowStatusById(aggregateContext.flows);
    const taskFlowStatuses = aggregateContext.flows
      .filter((flow) => Number(flow.taskId || 0) === taskId)
      .map((flow) => aggregateStatusByFlowId.get(Number(flow.id)))
      .filter(Boolean) as AggregateFlowStatus[];
    if (taskFlowStatuses.length > 0) {
      const status = taskFlowStatuses.every((item) => item.status === "recognized")
        ? "completed"
        : taskFlowStatuses.some((item) => item.status === "recognized" || item.status === "partial_matched")
          ? "partial_matched"
          : "pending_recognition";
      await db.update(recognitionTasks).set({
        status: status === "pending_recognition" ? "pending_details" : status,
        updatedAt: new Date(),
        completedAt: status === "completed" ? new Date() : null,
      }).where(eq(recognitionTasks.id, taskId));
      if (options.refreshDateSummary !== false) {
        await refreshRecognitionDateSummariesByTaskIds([taskId]);
      }
      return status;
    }
  }
  const progress = (await getTaskFlowProgress([taskId])).get(taskId);
  const status = deriveTaskStatus("", progress);
  await db.update(recognitionTasks).set({
    status: status === "pending_recognition" ? "pending_details" : status,
    updatedAt: new Date(),
    completedAt: status === "completed" ? new Date() : null,
  }).where(eq(recognitionTasks.id, taskId));
  if (options.refreshDateSummary !== false) {
    await refreshRecognitionDateSummariesByTaskIds([taskId]);
  }
  return status;
}

async function settleProcessingTaskStatusesByFlows(taskIds: number[]) {
  const db = getDb();
  const uniqueTaskIds = Array.from(new Set(taskIds.map(Number).filter(Boolean)));
  if (uniqueTaskIds.length === 0) return;

  // 认账任务收尾时统一固化流水状态，列表读取不再承担校正写回。
  for (const taskId of uniqueTaskIds) {
    await syncTaskFlowRecognitionStatus(taskId, { preserveLargeVariance: true });
  }

  const flowRows = await db
    .select({
      taskId: bankFlows.taskId,
      allTotal: count(),
      total: sql<number>`SUM(CASE WHEN CAST(${bankFlows.income} AS DECIMAL(18,2)) > 0 THEN 1 ELSE 0 END)`,
      recognized: sql<number>`SUM(CASE WHEN CAST(${bankFlows.income} AS DECIMAL(18,2)) > 0 AND ${bankFlows.recognitionStatus} = 'recognized' THEN 1 ELSE 0 END)`,
      partialMatched: sql<number>`SUM(CASE WHEN CAST(${bankFlows.income} AS DECIMAL(18,2)) > 0 AND ${bankFlows.recognitionStatus} = 'partial_matched' THEN 1 ELSE 0 END)`,
      largeVariance: sql<number>`SUM(CASE WHEN CAST(${bankFlows.income} AS DECIMAL(18,2)) > 0 AND ${bankFlows.recognitionStatus} = 'large_variance' THEN 1 ELSE 0 END)`,
    })
    .from(bankFlows)
    .where(inArray(bankFlows.taskId, uniqueTaskIds))
    .groupBy(bankFlows.taskId);
  const flowSummaryByTaskId = new Map(flowRows.map((row) => [Number(row.taskId), {
    allTotal: Number(row.allTotal || 0),
    total: Number(row.total || 0),
    recognized: Number(row.recognized || 0),
    partialMatched: Number(row.partialMatched || 0),
    largeVariance: Number(row.largeVariance || 0),
  }]));

  for (const taskId of uniqueTaskIds) {
    const summary = flowSummaryByTaskId.get(taskId);
    const status = (summary?.largeVariance || 0) > 0
      ? "large_variance" as const
      : (summary?.total || 0) > 0 && (summary?.recognized || 0) >= (summary?.total || 0)
        ? "completed" as const
        : (summary?.allTotal || 0) > 0 && (summary?.total || 0) === 0
          ? "completed" as const
        : (summary?.recognized || 0) > 0 || (summary?.partialMatched || 0) > 0
          ? "partial_matched" as const
          : "pending_details" as const;
    await db.update(recognitionTasks).set({
      status,
      completedAt: status === "completed" ? new Date() : null,
      updatedAt: new Date(),
    }).where(and(
      eq(recognitionTasks.id, taskId),
      eq(recognitionTasks.status, "processing"),
    ));
  }
  await refreshRecognitionDateSummariesByTaskIds(uniqueTaskIds);
}

export async function getRelatedRecognitionTaskIds(recognitionTaskId: number) {
  const aggregateContext = await getAggregateDetailTaskContext(recognitionTaskId);
  return Array.from(new Set([
    recognitionTaskId,
    ...(aggregateContext?.flows || []).map((item) => Number(item.taskId)).filter(Boolean),
  ]));
}

export async function markRecognitionTasksProcessing(taskIds: number[], affectedTaskIds: number[] = []) {
  const db = getDb();
  const processingTaskIds = Array.from(new Set(taskIds.map(Number).filter(Boolean)));
  if (processingTaskIds.length === 0) return [];
  await db.update(recognitionTasks).set({
    status: "processing",
    completedAt: null,
    updatedAt: new Date(),
  }).where(inArray(recognitionTasks.id, processingTaskIds));
  await refreshRecognitionDateSummariesByTaskIds(Array.from(new Set([
    ...affectedTaskIds,
    ...processingTaskIds,
  ])));
  return processingTaskIds;
}

export async function settleRecognitionTasksAfterProcessing(taskIds: number[]) {
  await settleProcessingTaskStatusesByFlows(taskIds);
}

async function enqueueIncrementalRecognition(
  recognitionTaskId: number,
  affectedTaskIds: number[] = [],
  logLabel = "增量认账",
) {
  const processingTaskIds = await markRecognitionTasksProcessing(
    await getRelatedRecognitionTaskIds(recognitionTaskId),
    affectedTaskIds,
  );

  const settleRelatedTaskStatuses = async () => {
    try {
      await settleProcessingTaskStatusesByFlows(processingTaskIds);
    } catch (statusErr) {
      console.error(`[${logLabel}] 自动认账结束后恢复关联任务状态失败:`, statusErr);
    }
  };
  void enqueueRecognition(recognitionTaskId, { useSummaryDeltas: true }).then(
    settleRelatedTaskStatuses,
    async (err) => {
      console.error(`[${logLabel}] 任务 ${recognitionTaskId} 自动增量认账失败:`, err);
      await settleRelatedTaskStatuses();
    },
  );
  return processingTaskIds;
}

async function syncTaskFlowRecognitionStatus(taskId: number, options: SyncTaskFlowRecognitionStatusOptions = {}) {
  const db = getDb();
  const aggregateDetailStatus = await syncAggregateDetailTaskFlowRecognitionStatus(taskId, options);
  if (aggregateDetailStatus) return;
  const fastPackageStatus = await syncFastPackageTaskFlowRecognitionStatus(taskId, options);
  if (fastPackageStatus) return;
  const flowStatusWhere = options.preserveLargeVariance
    ? and(eq(bankFlows.taskId, taskId), gt(bankFlows.income, "0"), sql`${bankFlows.recognitionStatus} <> 'large_variance'`)
    : and(eq(bankFlows.taskId, taskId), gt(bankFlows.income, "0"));

  const [flowSummary] = await db.select({
    total: sql<string>`COALESCE(SUM(CAST(${bankFlows.income} AS DECIMAL(18,2))), 0.00)`,
    count: count(),
  }).from(bankFlows).where(and(eq(bankFlows.taskId, taskId), gt(bankFlows.income, "0")));
  const flowCount = Number(flowSummary?.count || 0);
  if (flowCount === 0) return;

  const [recognizedSummary] = await db.select({
    total: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
  }).from(matchResults).where(and(
    eq(matchResults.taskId, taskId),
    recognitionEligibleMatchResultWhere(),
  ));
  const bankTotal = Number(flowSummary?.total || 0);
  const recognizedTotal = Number(recognizedSummary?.total || 0);

  if (deriveFlowRecognitionStatus(bankTotal, recognizedTotal) === "recognized") {
    await db.update(bankFlows)
      .set({ recognitionStatus: "recognized" })
      .where(flowStatusWhere);
    return;
  }

  await db.update(bankFlows)
    .set({ recognitionStatus: "unrecognized" })
    .where(flowStatusWhere);

  const recognizedRows = await db
    .select({
      bankFlowId: matchResults.bankFlowId,
      total: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
    })
    .from(matchResults)
    .where(and(
      eq(matchResults.taskId, taskId),
      sql`${matchResults.bankFlowId} IS NOT NULL`,
      recognitionEligibleMatchResultWhere(),
    ))
    .groupBy(matchResults.bankFlowId);

  const flowIds = recognizedRows.map((row) => Number(row.bankFlowId || 0)).filter(Boolean);
  if (flowIds.length === 0) return;

  const flows = await db.select({ id: bankFlows.id, income: bankFlows.income, recognitionStatus: bankFlows.recognitionStatus })
    .from(bankFlows)
    .where(and(inArray(bankFlows.id, flowIds), gt(bankFlows.income, "0")));
  const largeVarianceFlowIds = new Set(
    options.preserveLargeVariance
      ? flows.filter((flow) => flow.recognitionStatus === "large_variance").map((flow) => Number(flow.id))
      : [],
  );
  const incomeByFlowId = new Map(flows.map((flow) => [Number(flow.id), Number(flow.income || 0)]));
  for (const row of recognizedRows) {
    const flowId = Number(row.bankFlowId || 0);
    if (!flowId) continue;
    if (largeVarianceFlowIds.has(flowId)) continue;
    const status = deriveFlowRecognitionStatus(incomeByFlowId.get(flowId) || 0, Number(row.total || 0));
    await db.update(bankFlows)
      .set({ recognitionStatus: status })
      .where(eq(bankFlows.id, flowId));
  }
}

async function getAggregateDetailTaskContext(taskId: number) {
  const db = getDb();
  const [task] = await db
    .select({
      id: recognitionTasks.id,
      ruleId: recognitionTasks.ruleId,
      billDate: recognitionTasks.billDate,
      matchedCounterpartyAlias: recognitionRules.matchedCounterpartyAlias,
      counterpartyId: counterpartyRecords.id,
      recognitionType: counterpartyRecords.recognitionType,
      detailMatchingMode: counterpartyRecords.detailMatchingMode,
    })
    .from(recognitionTasks)
    .leftJoin(recognitionRules, eq(recognitionRules.id, recognitionTasks.ruleId))
    .leftJoin(counterpartyRecords, eq(counterpartyRecords.alias, recognitionRules.matchedCounterpartyAlias))
    .where(eq(recognitionTasks.id, taskId));
  if (!task) return null;

  const counterparty = await attachCounterpartyMatchers(db, {
    id: task.counterpartyId,
    recognitionType: task.recognitionType,
    detailMatchingMode: task.detailMatchingMode,
  });
  if (!isAggregateDetailCounterparty(counterparty)) return null;

  if (isMultiDayDetailCounterparty(counterparty)) {
    const group = await getMultiDayMatchGroupByTaskId(taskId);
    if (!group) return null;
    const groupFlows = await getMultiDayMatchGroupFlows(Number(group.id));
    const flows = groupFlows
      .map((item) => item.flow)
      .filter((flow) => isBankFlowRecognitionEligible(flow.income))
      .filter((flow) => flow.arrivalMatchStatus === "matched"
        && Number(flow.matchedCounterpartyId || 0) === Number(counterparty.id));
    return { task, flows, group, isMultiDay: true };
  }

  const flows = await db
    .select()
    .from(bankFlows)
    .where(and(
      eq(bankFlows.taskId, taskId),
      gt(bankFlows.income, "0"),
      eq(bankFlows.arrivalMatchStatus, "matched"),
      eq(bankFlows.matchedCounterpartyId, Number(counterparty.id)),
    ))
    .orderBy(asc(bankFlows.transactionTime), asc(bankFlows.id));

  return { task, flows, group: null, isMultiDay: false };
}

async function getFlowRecognitionCancellationScope(flowId: number): Promise<FlowRecognitionCancellationScope> {
  const db = getDb();
  const [clickedFlow] = await db.select().from(bankFlows).where(eq(bankFlows.id, flowId));
  if (!clickedFlow) throw new Error("流水不存在");

  const aggregateContext = await getAggregateDetailTaskContext(Number(clickedFlow.taskId));
  const aggregateFlows = aggregateContext?.flows || [];
  const isAggregateFlow = aggregateFlows.some((flow) => Number(flow.id) === Number(clickedFlow.id));
  let taskFlowCount = 0;
  if (!isAggregateFlow) {
    const [taskFlowSummary] = await db
      .select({ total: count() })
      .from(bankFlows)
      .where(eq(bankFlows.taskId, Number(clickedFlow.taskId)));
    taskFlowCount = Number(taskFlowSummary?.total || 0);
  }
  const derivedScope = deriveFlowRecognitionCancellationScope({
    clickedFlow,
    aggregateFlows,
    isMultiDay: Boolean(aggregateContext?.isMultiDay),
    taskFlowCount,
  });
  const flows = isAggregateFlow ? aggregateFlows : [clickedFlow];
  const { type, flowIds, taskIds, includeTaskScopedLegacyResults } = derivedScope;

  const flowResultWhere = inArray(matchResults.bankFlowId, flowIds);
  const results = await db
    .select()
    .from(matchResults)
    .where(includeTaskScopedLegacyResults
      ? or(
        flowResultWhere,
        and(
          inArray(matchResults.taskId, taskIds),
          isNull(matchResults.bankFlowId),
        ),
      )
      : flowResultWhere)
    .orderBy(asc(matchResults.id));

  return {
    type,
    clickedFlow,
    flows,
    taskIds,
    results,
  };
}

function getFlowRecognitionCancellationScopeLabel(type: FlowRecognitionCancellationScopeType) {
  if (type === "same_day") return "同日汇总任务";
  if (type === "multi_day") return "多日汇总匹配组";
  return "该银行到账";
}

async function hasCompletedArchiveRunForDates(queryDb: any, dates: string[]) {
  const uniqueDates = Array.from(new Set(dates
    .map((date) => String(date || "").trim())
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))));
  for (const partitionDate of uniqueDates) {
    const sources = await getDetailSourceTables(queryDb, partitionDate);
    if (sources.some((source) => source.archived)) return true;
  }
  return false;
}

async function getDetailOperationCancellationPlan(detail: DetailSummarySnapshot) {
  const db = getDb();
  const operationStatus = String(detail.operationStatus || "");
  if (operationStatus !== "ignored" && operationStatus !== "transferred") {
    throw new Error("该订单明细当前没有可取消的忽略或转移操作");
  }
  const originalTaskId = deriveDetailOperationOriginalTaskId({
    operationStatus,
    taskId: detail.taskId,
    originalTaskId: detail.originalTaskId,
  });
  if (!originalTaskId) {
    throw new Error(operationStatus === "transferred" ? "缺少原数据包，无法取消转移" : "缺少原日期汇总任务");
  }

  const [originalTask] = await db
    .select({
      id: recognitionTasks.id,
      billDate: recognitionTasks.billDate,
    })
    .from(recognitionTasks)
    .where(eq(recognitionTasks.id, originalTaskId));
  if (!originalTask) throw new Error("原日期汇总任务不存在");

  const originalFlows = await db
    .select()
    .from(bankFlows)
    .where(eq(bankFlows.taskId, originalTaskId))
    .orderBy(asc(bankFlows.transactionTime), asc(bankFlows.id));
  const scopes: FlowRecognitionCancellationScope[] = [];
  const coveredFlowIds = new Set<number>();
  for (const flow of originalFlows) {
    const flowId = Number(flow.id || 0);
    if (!flowId || coveredFlowIds.has(flowId)) continue;
    const scope = await getFlowRecognitionCancellationScope(flowId);
    scopes.push(scope);
    for (const scopeFlow of scope.flows) {
      coveredFlowIds.add(Number(scopeFlow.id));
    }
  }

  const combinedScope = mergeFlowRecognitionCancellationScopes(scopes.map((scope) => ({
    type: scope.type,
    flowIds: scope.flows.map((flow) => Number(flow.id)).filter(Boolean),
    taskIds: scope.taskIds,
    includeTaskScopedLegacyResults: scope.type === "same_day",
  })));
  const resultById = new Map<number, typeof matchResults.$inferSelect>();
  for (const scope of scopes) {
    for (const result of scope.results) {
      resultById.set(Number(result.id), result);
    }
  }
  const results = Array.from(resultById.values());
  const resultIds = results.map((result) => Number(result.id)).filter(Boolean);
  const [voucherLine] = resultIds.length > 0
    ? await db
      .select({ id: voucherResultLines.id })
      .from(voucherResultLines)
      .where(inArray(voucherResultLines.matchResultId, resultIds))
      .limit(1)
    : [];
  const hasLockedResult = results.some((result) => result.voucherStatus === "created");
  const hasGeneratedVoucher = Boolean(voucherLine);
  const hasArchivedDetails = hasArchivedRecognitionDetails(results);
  const recognizedAmount = results.reduce(
    (sum, result) => sum + Number(result.splitAmount || 0),
    0,
  );
  const scopeLabel = combinedScope.scopeCount === 1 && combinedScope.type !== "multiple"
    ? getFlowRecognitionCancellationScopeLabel(combinedScope.type)
    : combinedScope.scopeCount > 1
      ? `${combinedScope.scopeCount} 个银行到账范围`
      : "原日期汇总";

  return {
    operationStatus: operationStatus as "ignored" | "transferred",
    operationLabel: operationStatus === "ignored" ? "忽略" : "转移",
    originalTaskId,
    originalDate: String(originalTask.billDate || detail.originalRecognitionDate || detail.partitionDate || ""),
    scopeType: combinedScope.type,
    scopeLabel,
    flowIds: combinedScope.flowIds,
    taskIds: combinedScope.taskIds,
    results,
    resultIds,
    recognizedAmount: recognizedAmount.toFixed(2),
    hasLockedResult,
    hasGeneratedVoucher,
    hasArchivedDetails,
  };
}

async function refreshCommittedRecognitionCancellationState(input: {
  affectedTaskIds: number[];
  hasDetailRecognition: boolean;
}) {
  const db = getDb();
  for (const taskId of input.affectedTaskIds) {
    await refreshTaskStatusByFlows(taskId, { refreshDateSummary: false });
  }
  if (input.hasDetailRecognition) {
    for (const taskId of input.affectedTaskIds) {
      const [remainingResultSummary] = await db
        .select({ total: count() })
        .from(matchResults)
        .where(eq(matchResults.taskId, taskId));
      await db
        .update(recognitionTasks)
        .set({
          status: Number(remainingResultSummary?.total || 0) > 0 ? "partial_matched" : "pending_details",
          completedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(recognitionTasks.id, taskId));
    }
  }
  await refreshRecognitionDateSummariesByTaskIds(input.affectedTaskIds);
}

async function cancelRecognitionResults(input: {
  resultIds: number[];
  affectedFlowIds?: number[];
  requestedTaskIds?: number[];
  deferDerivedStateRefresh?: boolean;
}) {
  const db = getDb();
  const targetResultIds = Array.from(new Set(input.resultIds.map(Number).filter(Boolean)));
  if (targetResultIds.length === 0) throw new Error("未找到可取消的认账结果");

  const initialResults = await db
    .select()
    .from(matchResults)
    .where(inArray(matchResults.id, targetResultIds));
  if (initialResults.length !== targetResultIds.length) throw new Error("认账结果已变化，请刷新后重试");
  if (hasArchivedRecognitionDetails(initialResults)) {
    throw new Error("取消范围内存在已归档订单明细，只能取消热区订单明细的认账");
  }

  const resultPartitions = partitionRecognitionResultIds(initialResults);
  const automaticDetailResultIds = resultPartitions.detail;
  const manualDetailResultIds = resultPartitions.manual_detail;
  const detailResultIds = Array.from(new Set([
    ...automaticDetailResultIds,
    ...manualDetailResultIds,
  ]));
  const detailResultIdSet = new Set(detailResultIds);
  const hasDetailRecognition = detailResultIds.length > 0;
  const expectedHotDetailCount = initialResults.reduce(
    (total, result) => detailResultIdSet.has(Number(result.id))
      ? total + Number(result.detailCount || 0)
      : total,
    0,
  );
  const lockDates = new Set<string>();
  const hotPartitionRows = hasDetailRecognition
    ? await db
      .select({ partitionDate: billDetails.partitionDate, detailCount: count() })
      .from(billDetails)
      .where(inArray(billDetails.matchResultId, detailResultIds))
      .groupBy(billDetails.partitionDate)
    : [];
  for (const row of hotPartitionRows) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(row.partitionDate || ""))) {
      lockDates.add(String(row.partitionDate));
    }
  }
  for (const result of initialResults) {
    if (
      detailResultIdSet.has(Number(result.id))
      && /^\d{4}-\d{2}-\d{2}$/.test(String(result.entryTime || ""))
    ) {
      lockDates.add(String(result.entryTime));
    }
  }

  const transactionResult = await withBillDetailArchiveDateLocks(
    Array.from(lockDates),
    () => db.transaction(async (tx) => {
      const lockedResults = await tx
        .select()
        .from(matchResults)
        .where(inArray(matchResults.id, targetResultIds));
      if (lockedResults.length !== targetResultIds.length) throw new Error("认账结果已变化，请刷新后重试");
      if (hasArchivedRecognitionDetails(lockedResults)) {
        throw new Error("取消范围内存在已归档订单明细，只能取消热区订单明细的认账");
      }
      if (lockedResults.some((result) => result.voucherStatus === "created")) {
        throw new Error("取消范围内存在已锁定的入账结果，请先取消凭证或锁定");
      }
      const [voucherLine] = await tx
        .select({ id: voucherResultLines.id })
        .from(voucherResultLines)
        .where(inArray(voucherResultLines.matchResultId, targetResultIds))
        .limit(1);
      if (voucherLine) throw new Error("取消范围内存在已生成凭证的入账结果，请先取消凭证");

      const targetDetails = hasDetailRecognition
        ? await tx
          .select({
            id: billDetails.id,
            taskId: billDetails.taskId,
            orderFileId: billDetails.orderFileId,
            detailSplitFileId: billDetails.detailSplitFileId,
            splitSourceDetailId: billDetails.splitSourceDetailId,
            operationStatus: billDetails.operationStatus,
            ignoreReason: billDetails.ignoreReason,
            matchResultId: billDetails.matchResultId,
            matchStatus: billDetails.matchStatus,
          })
          .from(billDetails)
          .where(inArray(billDetails.matchResultId, detailResultIds))
        : [];
      const hasMissingDetailCoverage = hasDetailRecognition
        && targetDetails.length < expectedHotDetailCount;
      const hasCompletedArchiveRun = hasMissingDetailCoverage
        ? await hasCompletedArchiveRunForDates(tx, Array.from(lockDates))
        : false;
      const detailCoverage = classifyRecognitionCancellationDetailCoverage({
        expectedDetailCount: expectedHotDetailCount,
        hotDetailCount: targetDetails.length,
        hasArchivedDetails: false,
        hasCompletedArchiveRun,
      });
      if (detailCoverage.status === "archived") {
        throw new Error("取消范围内存在已归档订单明细，只能取消热区订单明细的认账");
      }
      if (detailCoverage.status === "orphaned") {
        console.warn("[recognition-cancellation] 清理订单明细已删除的残留入账结果", {
          targetResultIds,
          expectedDetailCount: expectedHotDetailCount,
          hotDetailCount: targetDetails.length,
          missingDetailCount: detailCoverage.missingDetailCount,
        });
      }
      const sourceDetailIdSet = new Set<number>();
      const splitSourceIdSet = new Set<number>();
      for (const detail of targetDetails) {
        const detailId = Number(detail.id || 0);
        const splitSourceDetailId = Number(detail.splitSourceDetailId || 0);
        if (!detail.detailSplitFileId && detailId) sourceDetailIdSet.add(detailId);
        if (splitSourceDetailId) {
          sourceDetailIdSet.add(splitSourceDetailId);
          splitSourceIdSet.add(splitSourceDetailId);
        }
        if (
          detail.operationStatus === "split_replaced"
          || String(detail.ignoreReason || "").startsWith("已按明细分账拆分认账")
        ) {
          if (detailId) {
            sourceDetailIdSet.add(detailId);
            splitSourceIdSet.add(detailId);
          }
        }
      }
      const sourceDetailIds = Array.from(sourceDetailIdSet);
      const splitSourceIds = Array.from(splitSourceIdSet);
      type DetailCancellationSnapshot = Pick<
        (typeof targetDetails)[number],
        "id" | "taskId" | "orderFileId" | "matchResultId" | "matchStatus"
      >;
      const sourceDetailsBeforeById = new Map<number, DetailCancellationSnapshot>();
      const sourceDetailTaskIds = new Set<number>();
      const rememberSourceDetailBefore = (detail: DetailCancellationSnapshot) => {
        const detailId = Number(detail.id || 0);
        if (!detailId) return;
        sourceDetailsBeforeById.set(detailId, detail);
        const taskId = Number(detail.taskId || 0);
        if (taskId) sourceDetailTaskIds.add(taskId);
      };
      for (const detail of targetDetails) {
        if (sourceDetailIdSet.has(Number(detail.id || 0))) {
          rememberSourceDetailBefore(detail);
        }
      }
      const missingSourceDetailIds = sourceDetailIds.filter(
        (detailId) => !sourceDetailsBeforeById.has(detailId),
      );
      for (const detailIdChunk of chunkRecognitionCancellationDetailIds(missingSourceDetailIds)) {
        const rows = await tx
          .select({
            id: billDetails.id,
            taskId: billDetails.taskId,
            orderFileId: billDetails.orderFileId,
            matchResultId: billDetails.matchResultId,
            matchStatus: billDetails.matchStatus,
          })
          .from(billDetails)
          .where(inArray(billDetails.id, detailIdChunk));
        for (const row of rows) rememberSourceDetailBefore(row);
      }

      if (automaticDetailResultIds.length > 0) {
        await tx
          .update(billDetails)
          .set({ matchResultId: sql`NULL` })
          .where(inArray(billDetails.matchResultId, automaticDetailResultIds));
      }
      if (manualDetailResultIds.length > 0) {
        await tx
          .update(billDetails)
          .set({
            matchStatus: "unmatched",
            ruleItemId: null,
            matchResultId: sql`NULL`,
          })
          .where(inArray(billDetails.matchResultId, manualDetailResultIds));
      }

      for (const splitSourceIdChunk of chunkRecognitionCancellationDetailIds(splitSourceIds)) {
        const idList = sql.join(splitSourceIdChunk.map((id) => sql`${id}`), sql`, `);
        await tx.execute(sql`
          UPDATE bill_details source_detail
          LEFT JOIN (
            SELECT linked_detail.split_source_detail_id, MIN(linked_detail.match_result_id) AS match_result_id
            FROM bill_details linked_detail
            WHERE linked_detail.split_source_detail_id IN (${idList})
              AND linked_detail.match_result_id IS NOT NULL
            GROUP BY linked_detail.split_source_detail_id
          ) remaining_split ON remaining_split.split_source_detail_id = source_detail.id
          SET source_detail.match_result_id = remaining_split.match_result_id
          WHERE source_detail.id IN (${idList})
        `);
      }
      await syncManualOrderWorkItemsByDetailIds(
        tx,
        Array.from(new Set([
          ...targetDetails.map((detail) => Number(detail.id || 0)),
          ...sourceDetailIds,
        ])),
      );

      const taskDeltas = new Map<number, { matched: number; unmatched: number }>();
      const orderFileDeltas = new Map<number, { matched: number; unmatched: number }>();
      for (const detailIdChunk of chunkRecognitionCancellationDetailIds(sourceDetailIds)) {
        const sourceDetailsAfter = await tx
          .select({
            id: billDetails.id,
            taskId: billDetails.taskId,
            orderFileId: billDetails.orderFileId,
            matchResultId: billDetails.matchResultId,
            matchStatus: billDetails.matchStatus,
          })
          .from(billDetails)
          .where(inArray(billDetails.id, detailIdChunk));
        const afterById = new Map(sourceDetailsAfter.map((detail) => [Number(detail.id), detail]));
        for (const detailId of detailIdChunk) {
          const before = sourceDetailsBeforeById.get(detailId);
          const after = afterById.get(detailId);
          if (!before || !after) continue;
          const matchedDelta = Number(Boolean(after.matchResultId)) - Number(Boolean(before.matchResultId));
          const unmatchedDelta = Number(after.matchStatus === "unmatched") - Number(before.matchStatus === "unmatched");
          const taskId = Number(before.taskId || 0);
          if (taskId) {
            const delta = taskDeltas.get(taskId) || { matched: 0, unmatched: 0 };
            delta.matched += matchedDelta;
            delta.unmatched += unmatchedDelta;
            taskDeltas.set(taskId, delta);
          }
          const orderFileId = Number(before.orderFileId || 0);
          if (orderFileId && (matchedDelta || unmatchedDelta)) {
            const delta = orderFileDeltas.get(orderFileId) || { matched: 0, unmatched: 0 };
            delta.matched += Number(after.matchStatus === "matched") - Number(before.matchStatus === "matched");
            delta.unmatched += unmatchedDelta;
            orderFileDeltas.set(orderFileId, delta);
          }
        }
      }
      for (const [taskId, delta] of taskDeltas) {
        await tx
          .update(recognitionTasks)
          .set({
            matchedCount: sql`GREATEST(COALESCE(${recognitionTasks.matchedCount}, 0) + ${delta.matched}, 0)`,
            unmatchedCount: sql`GREATEST(COALESCE(${recognitionTasks.unmatchedCount}, 0) + ${delta.unmatched}, 0)`,
            completedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(recognitionTasks.id, taskId));
      }
      for (const [orderFileId, delta] of orderFileDeltas) {
        await tx
          .update(orderFiles)
          .set({
            matchedCount: sql`GREATEST(COALESCE(${orderFiles.matchedCount}, 0) + ${delta.matched}, 0)`,
            unmatchedCount: sql`GREATEST(COALESCE(${orderFiles.unmatchedCount}, 0) + ${delta.unmatched}, 0)`,
          })
          .where(eq(orderFiles.id, orderFileId));
      }

      await tx.delete(matchResults).where(inArray(matchResults.id, targetResultIds));

      const incomeRecognitionFlowIds = Array.from(new Set([
        ...(input.affectedFlowIds || []),
        ...lockedResults
        .filter((result) => result.incomeRuleId && result.bankFlowId)
        .map((result) => Number(result.bankFlowId))
        .filter(Boolean),
      ]));
      const automaticIncomeFlowIds = new Set(lockedResults
        .filter((result) => result.incomeRuleId && result.bankFlowId)
        .map((result) => Number(result.bankFlowId))
        .filter(Boolean));
      for (const flowId of incomeRecognitionFlowIds) {
        const [remainingResult] = await tx
          .select({ id: matchResults.id })
          .from(matchResults)
          .where(eq(matchResults.bankFlowId, flowId))
          .limit(1);
        if (!remainingResult) {
          await tx
            .update(bankFlows)
            .set(automaticIncomeFlowIds.has(flowId)
              ? {
                incomeRuleId: null,
                matchedCounterpartyId: null,
                arrivalMatchStatus: "cancelled",
              }
              : { incomeRuleId: null })
            .where(eq(bankFlows.id, flowId));
        }
      }
      return {
        affectedTaskIds: Array.from(new Set([
          ...(input.requestedTaskIds || []),
          ...lockedResults.map((result) => Number(result.taskId || 0)),
          ...sourceDetailTaskIds,
        ].filter(Boolean))),
        orphanedDetailCount: detailCoverage.status === "orphaned"
          ? detailCoverage.missingDetailCount
          : 0,
      };
    }),
  );

  const derivedStateRefresh = retryCommittedRecognitionCancellationRefresh({
    refresh: () => refreshCommittedRecognitionCancellationState({
      affectedTaskIds: transactionResult.affectedTaskIds,
      hasDetailRecognition,
    }),
    maxAttempts: 3,
    retryDelayMs: 500,
    onAttemptError: (error, attempt) => {
      console.error(
        `[recognition-cancellation] 认账结果已回滚，刷新派生状态失败（第 ${attempt} 次）:`,
        error,
      );
    },
  });
  if (input.deferDerivedStateRefresh) {
    void derivedStateRefresh;
  } else {
    await derivedStateRefresh;
  }

  return {
    affectedTaskIds: transactionResult.affectedTaskIds,
    cancelledResultCount: targetResultIds.length,
    orphanedDetailCount: transactionResult.orphanedDetailCount,
  };
}

async function getAggregateFlowStatusById(
  flows: Array<typeof bankFlows.$inferSelect>,
  options: { includeTaskScopedLegacyResults?: boolean } = {},
) {
  const db = getDb();
  const statuses = new Map<number, AggregateFlowStatus>();
  const flowIds = flows.map((flow) => Number(flow.id)).filter(Boolean);
  if (flowIds.length === 0) return statuses;
  const taskIds = Array.from(new Set(flows.map((flow) => Number(flow.taskId)).filter(Boolean)));
  const archivedResultWhere = options.includeTaskScopedLegacyResults && taskIds.length > 0
    ? or(
      inArray(matchResults.bankFlowId, flowIds),
      and(
        inArray(matchResults.taskId, taskIds),
        isNull(matchResults.bankFlowId),
      ),
    )
    : inArray(matchResults.bankFlowId, flowIds);

  const [[recognizedSummary], [archivedSummary]] = await Promise.all([
    db
      .select({
        total: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
        resultCount: count(),
        pendingVoucherCount: sql<number>`COALESCE(SUM(CASE WHEN ${matchResults.voucherStatus} = 'pending' THEN 1 ELSE 0 END), 0)`,
      })
      .from(matchResults)
      .where(inArray(matchResults.bankFlowId, flowIds)),
    db
      .select({
        archivedDetailResultCount: sql<number>`COALESCE(SUM(CASE WHEN ${matchResults.hasArchivedDetails} = 1 THEN 1 ELSE 0 END), 0)`,
      })
      .from(matchResults)
      .where(archivedResultWhere),
  ]);

  const allResultsVouchered = isVoucherScopeFullyCreated([recognizedSummary]);
  const hasArchivedDetails = Number(archivedSummary?.archivedDetailResultCount || 0) > 0;
  for (const allocation of allocateRecognizedAmountAcrossFlows(flows, recognizedSummary?.total || 0)) {
    statuses.set(allocation.flowId, {
      status: allocation.status,
      recognizedAmount: allocation.recognizedAmount,
      recognitionAvailableAmount: allocation.recognitionAvailableAmount,
      allResultsVouchered,
      hasArchivedDetails,
    });
  }

  return statuses;
}

async function getAggregateFlowStatusByIdForTaskIds(taskIds: number[]) {
  const statuses = new Map<number, AggregateFlowStatus>();
  const visitedContexts = new Set<string>();
  for (const taskId of taskIds) {
    const context = await getAggregateDetailTaskContext(taskId);
    if (!context?.flows.length) continue;
    const contextKey = context.group
      ? `multi-day:${context.group.id}`
      : `same-day:${context.task.id}`;
    if (visitedContexts.has(contextKey)) continue;
    visitedContexts.add(contextKey);
    const contextStatuses = await getAggregateFlowStatusById(context.flows, {
      includeTaskScopedLegacyResults: !context.isMultiDay,
    });
    for (const [flowId, status] of contextStatuses) {
      statuses.set(flowId, status);
    }
  }
  return statuses;
}

async function getPartialRecognitionFlowContext(flowId: number) {
  const db = getDb();
  const [row] = await db
    .select({
      flow: bankFlows,
      taskBillDate: recognitionTasks.billDate,
      taskRuleId: recognitionTasks.ruleId,
    })
    .from(bankFlows)
    .leftJoin(recognitionTasks, eq(recognitionTasks.id, bankFlows.taskId))
    .where(eq(bankFlows.id, flowId));
  if (!row) throw new Error("银行流水不存在");

  const taskId = Number(row.flow.taskId || 0);
  const ruleId = Number(row.taskRuleId || 0);
  const billDate = String(row.taskBillDate || "");
  if (!taskId || !ruleId || !billDate) throw new Error("该流水缺少明细认账任务信息");
  const detailPackageType = await getDetailPackageTypeForRule(ruleId);

  const aggregateContext = await getAggregateDetailTaskContext(taskId);
  const aggregateFlowIncluded = Boolean(
    aggregateContext?.flows.some((flow) => Number(flow.id) === Number(row.flow.id)),
  );
  const aggregateStatus = aggregateContext && aggregateFlowIncluded
    ? (await getAggregateFlowStatusById(aggregateContext.flows)).get(Number(row.flow.id))
    : null;
  let recognizedAmount = Number(aggregateStatus?.recognizedAmount || 0);
  let recognitionAvailableAmount = Number(aggregateStatus?.recognitionAvailableAmount || 0);
  let status = aggregateStatus?.status;

  if (!aggregateStatus) {
    const [recognizedSummary] = await db.select({
      total: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
    }).from(matchResults).where(eq(matchResults.bankFlowId, Number(row.flow.id)));
    recognizedAmount = Number(recognizedSummary?.total || 0);
    recognitionAvailableAmount = getSignedRecognitionAvailableCents(row.flow.income, recognizedAmount) / 100;
    status = deriveFlowRecognitionStatus(Number(row.flow.income || 0), recognizedAmount);
  }

  const pendingSplitTaskIds = resolvePartialTransferPendingTaskIds(
    taskId,
    aggregateFlowIncluded
      ? (aggregateContext?.flows || []).map((flow) => Number(flow.taskId)).filter(Boolean)
      : [],
  );
  const [pendingSplitSummary] = await db.select({
    total: sql<string>`COALESCE(SUM(CAST(${billDetails.totalAmount} AS DECIMAL(18,2))), 0.00)`,
  }).from(billDetails).where(and(
    inArray(billDetails.taskId, pendingSplitTaskIds),
    isNull(billDetails.detailSplitFileId),
    eq(billDetails.matchStatus, "pending_split"),
    sql`${billDetails.matchResultId} IS NULL`,
    recognizableDetailOperationSql(),
    excludeAbnormalOrderFilesSql(),
  ));
  const pendingSplitAmount = Number(pendingSplitSummary?.total || 0);

  return {
    flow: row.flow,
    taskId,
    ruleId,
    billDate,
    detailPackageType,
    recognizedAmount,
    recognitionAvailableAmount,
    pendingSplitAmount,
    status,
  };
}

async function syncAggregateDetailTaskFlowRecognitionStatus(taskId: number, options: SyncTaskFlowRecognitionStatusOptions = {}) {
  const db = getDb();
  const context = await getAggregateDetailTaskContext(taskId);
  if (!context || context.flows.length === 0) return false;

  const aggregateStatusByFlowId = await getAggregateFlowStatusById(context.flows);
  for (const flow of context.flows) {
    if (options.preserveLargeVariance && flow.recognitionStatus === "large_variance") continue;
    const status = aggregateStatusByFlowId.get(Number(flow.id));
    await db.update(bankFlows)
      .set({ recognitionStatus: status?.status || "unrecognized" })
      .where(eq(bankFlows.id, Number(flow.id)));
  }

  return true;
}

async function getFastPackageTaskContext(taskId: number) {
  const db = getDb();
  const [task] = await db
    .select({
      id: recognitionTasks.id,
      ruleId: recognitionTasks.ruleId,
      billDate: recognitionTasks.billDate,
      conditionRecognitionEnabled: recognitionRules.conditionRecognitionEnabled,
      matchedCounterpartyAlias: recognitionRules.matchedCounterpartyAlias,
      detailPackageType: counterpartyRecords.detailPackageType,
    })
    .from(recognitionTasks)
    .leftJoin(recognitionRules, eq(recognitionRules.id, recognitionTasks.ruleId))
    .leftJoin(counterpartyRecords, eq(counterpartyRecords.alias, recognitionRules.matchedCounterpartyAlias))
    .where(eq(recognitionTasks.id, taskId));

  const matchedCounterpartyAlias = String(task?.matchedCounterpartyAlias || "").trim();
  if (!task || task.conditionRecognitionEnabled !== false || task.detailPackageType !== "打包明细" || !matchedCounterpartyAlias) {
    return null;
  }
  return {
    id: Number(task.id),
    ruleId: Number(task.ruleId || 0),
    billDate: String(task.billDate || ""),
    matchedCounterpartyAlias,
  };
}

async function getFastPackageTotals(taskId: number) {
  const db = getDb();
  const context = await getFastPackageTaskContext(taskId);
  if (!context) return null;

  const [bankSummary] = await db.select({
    total: sql<string>`COALESCE(SUM(CAST(${bankFlows.income} AS DECIMAL(18,2))), 0.00)`,
    count: count(),
  }).from(bankFlows).where(and(eq(bankFlows.taskId, taskId), gt(bankFlows.income, "0")));
  if (Number(bankSummary?.count || 0) === 0) return null;

  const [detailSummary] = await db.select({
    total: sql<string>`COALESCE(SUM(CAST(${orderFiles.orderTotalAmount} AS DECIMAL(18,2)) - CAST(${orderFiles.refundAmount} AS DECIMAL(18,2))), 0.00)`,
    count: sql<number>`COALESCE(SUM(${orderFiles.entryCount}), 0)`,
    pendingSplitCount: sql<number>`COALESCE(SUM(${orderFiles.pendingSplitCount}), 0)`,
  }).from(orderFiles)
    .leftJoin(recognitionRules, eq(recognitionRules.id, orderFiles.ruleId))
    .where(and(
      eq(recognitionRules.matchedCounterpartyAlias, context.matchedCounterpartyAlias),
      eq(orderFiles.detailPackageType, "打包明细"),
      eq(orderFiles.uploadDate, context.billDate),
      sql`${orderFiles.uploadStatus} <> 'abnormal'`,
    ));

  const [recognizedSummary] = await db.select({
    total: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
    detailCount: sql<number>`COALESCE(SUM(${matchResults.detailCount}), 0)`,
  }).from(matchResults)
    .leftJoin(ruleItems, eq(ruleItems.id, matchResults.ruleItemId))
    .leftJoin(recognitionRules, eq(recognitionRules.id, ruleItems.ruleId))
    .where(and(
      eq(matchResults.taskId, taskId),
      eq(recognitionRules.matchedCounterpartyAlias, context.matchedCounterpartyAlias),
      recognitionEligibleMatchResultWhere(),
    ));

  return {
    ...context,
    bankTotal: Number(bankSummary?.total || 0),
    detailTotal: Number(detailSummary?.total || 0),
    detailCount: Number(detailSummary?.count || 0),
    pendingSplitCount: Number(detailSummary?.pendingSplitCount || 0),
    recognizedTotal: Number(recognizedSummary?.total || 0),
    recognizedCount: Number(recognizedSummary?.detailCount || 0),
  };
}

async function syncFastPackageTaskFlowRecognitionStatus(taskId: number, options: SyncTaskFlowRecognitionStatusOptions = {}) {
  const db = getDb();
  const totals = await getFastPackageTotals(taskId);
  if (!totals) return false;
  const flowStatusWhere = options.preserveLargeVariance
    ? and(eq(bankFlows.taskId, taskId), gt(bankFlows.income, "0"), sql`${bankFlows.recognitionStatus} <> 'large_variance'`)
    : and(eq(bankFlows.taskId, taskId), gt(bankFlows.income, "0"));

  const isComplete = totals.detailCount > 0
    && toCents(totals.bankTotal) === toCents(totals.detailTotal)
    && toCents(totals.recognizedTotal) === toCents(totals.bankTotal);
  await db.update(bankFlows)
    .set({ recognitionStatus: isComplete ? "recognized" : toCents(totals.recognizedTotal) > 0 ? "partial_matched" : "unrecognized" })
    .where(flowStatusWhere);
  return true;
}

async function recognizeRemainingFastPackageRuleDetails(
  taskId: number,
  billDate: string,
  matchedCounterpartyAlias: string,
  bankFlowId: number | null,
  bankFlowSnapshot: ReturnType<typeof buildMatchResultDisplaySnapshot> & { bankIncome: string },
  detailRegion: any,
  entryTime: string,
) {
  const db = getDb();
  const groups = await db.select({
    ruleId: billDetails.ruleId,
    ruleItemId: billDetails.ruleItemId,
    total: sql<string>`COALESCE(SUM(CAST(${billDetails.totalAmount} AS DECIMAL(18,2))), 0.00)`,
    count: count(),
    isRefund: sql<number>`CASE WHEN CAST(${billDetails.refundAmountSnapshot} AS DECIMAL(18,2)) > 0 THEN 1 ELSE 0 END`,
  })
    .from(billDetails)
    .leftJoin(orderFiles, eq(orderFiles.id, billDetails.orderFileId))
    .leftJoin(recognitionRules, eq(recognitionRules.id, billDetails.ruleId))
    .leftJoin(ruleItems, eq(ruleItems.id, billDetails.ruleItemId))
    .where(and(
      eq(billDetails.taskId, taskId),
      eq(recognitionRules.matchedCounterpartyAlias, matchedCounterpartyAlias),
      eq(recognitionRules.conditionRecognitionEnabled, false),
      eq(orderFiles.detailPackageType, "打包明细"),
      eq(orderFiles.uploadDate, billDate),
      sql`${orderFiles.uploadStatus} <> 'abnormal'`,
      isNull(billDetails.detailSplitFileId),
      sql`${billDetails.matchResultId} IS NULL`,
      sql`COALESCE(${billDetails.operationStatus}, 'active') = 'active'`,
      eq(billDetails.matchStatus, "matched"),
      sql`${billDetails.ruleItemId} IS NOT NULL`,
    ))
    .groupBy(
      billDetails.ruleId,
      billDetails.ruleItemId,
      sql`CASE WHEN CAST(${billDetails.refundAmountSnapshot} AS DECIMAL(18,2)) > 0 THEN 1 ELSE 0 END`,
    );

  for (const group of groups) {
    const ruleItemId = Number(group.ruleItemId || 0);
    const ruleId = Number(group.ruleId || 0);
    const groupTotal = Number(group.total || 0);
    const groupCount = Number(group.count || 0);
    const isRefundGroup = Number(group.isRefund || 0) === 1;
    if (!ruleId || !ruleItemId || groupCount === 0 || toCents(groupTotal) === 0) continue;

    const splits = await db.select()
      .from(ruleItemSplits)
      .where(eq(ruleItemSplits.ruleItemId, ruleItemId))
      .orderBy(asc(ruleItemSplits.sortOrder), asc(ruleItemSplits.id));

    let firstMatchResultId: number | null = null;
    const resultIncomeType = () => isRefundGroup ? "订单退款" : "捐赠收入";
    const resultDonationSource = () => isRefundGroup ? null : "互联网募捐平台";

    if (splits.length === 0) {
      const result = await db.insert(matchResults).values({
        taskId,
        ruleItemId,
        bankFlowId,
        recognitionType: "渠道捐赠",
        incomeType: resultIncomeType(),
        donationSource: resultDonationSource(),
        ...bankFlowSnapshot,
        region: detailRegion,
        totalAmount: groupTotal.toFixed(2),
        splitAmount: groupTotal.toFixed(2),
        splitRatio: "100",
        detailCount: groupCount,
        orderDetailCountSnapshot: groupCount,
        entryTime,
      }).$returningId();
      firstMatchResultId = Number(result[0]?.id) || null;
    } else {
      const splitAmounts = splitAmountByRatios(groupTotal, splits.map((split) => normalizeSplitRatio(split.splitRatio || "100")));
      for (const [index, split] of splits.entries()) {
        const managementFeeRatio = normalizeManagementFeeRatio(split.managementFeeRatio);
        const result = await db.insert(matchResults).values({
          taskId,
          ruleItemId,
          bankFlowId,
          recognitionType: "渠道捐赠",
          incomeType: resultIncomeType(),
          donationSource: resultDonationSource(),
          incomeAttr: split.incomeAttr,
          incomeDept: split.incomeDept,
          budgetCode: split.budgetCode,
          incomeProject: split.incomeProject,
          platformProjectName: split.platformProjectName,
          ...bankFlowSnapshot,
          platformProjectDisplayName: split.platformProjectName || null,
          platformProjectDetail: split.platformProjectDetail,
          region: detailRegion,
          managementFeeRatio,
          managementFeeAmount: calculateManagementFeeAmount(splitAmounts[index], managementFeeRatio),
          expenseFundSource: split.expenseFundSource,
          totalAmount: groupTotal.toFixed(2),
          splitAmount: splitAmounts[index],
          splitRatio: normalizeSplitRatio(split.splitRatio),
          detailCount: index === 0 ? groupCount : 0,
          orderDetailCountSnapshot: groupCount,
          entryTime,
        }).$returningId();
        const mrId = Number(result[0]?.id) || null;
        if (mrId && !firstMatchResultId) firstMatchResultId = mrId;
      }
    }

    if (!firstMatchResultId) continue;
    await db.update(billDetails).set({
      matchStatus: "matched",
      ruleItemId,
      matchResultId: firstMatchResultId,
    }).where(and(
      eq(billDetails.taskId, taskId),
      eq(billDetails.ruleId, ruleId),
      eq(billDetails.ruleItemId, ruleItemId),
      sql`${billDetails.matchResultId} IS NULL`,
      eq(billDetails.matchStatus, "matched"),
      sql`COALESCE(${billDetails.operationStatus}, 'active') = 'active'`,
      isNull(billDetails.detailSplitFileId),
      sql`EXISTS (
        SELECT 1 FROM order_files of_pkg
        WHERE of_pkg.id = ${billDetails.orderFileId}
          AND of_pkg.detail_package_type = '打包明细'
          AND of_pkg.upload_date = ${billDate}
          AND of_pkg.upload_status <> 'abnormal'
      )`,
      isRefundGroup ? refundDetailWhereSql(true) : refundDetailWhereSql(false),
    ));
  }
}

async function getTaskIdsForBillDate(billDate: string) {
  const db = getDb();
  const rows = await db
    .select({ id: recognitionTasks.id })
    .from(recognitionTasks)
    .where(eq(recognitionTasks.billDate, billDate));
  return rows.map((row) => row.id);
}

async function getDateTaskIdsByTaskId(taskId: number) {
  const db = getDb();
  const [task] = await db
    .select({ billDate: recognitionTasks.billDate })
    .from(recognitionTasks)
    .where(eq(recognitionTasks.id, taskId));
  if (!task) return [];
  return getTaskIdsForBillDate(task.billDate);
}

async function getManualDetailMatchedFlowsForReference(
  db: any,
  detailRef: { taskId: number | null; ruleId: number | null },
) {
  const detailRuleId = Number(detailRef.ruleId || 0);
  const multiDayGroup = await getMultiDayMatchGroupByTaskId(Number(detailRef.taskId));
  if (multiDayGroup) {
    const groupFlows = await getMultiDayMatchGroupFlows(Number(multiDayGroup.id));
    return groupFlows
      .filter((item) => isBankFlowRecognitionEligible(item.flow.income))
      .map((item) => ({
        id: Number(item.flow.id),
        referenceNo: item.flow.referenceNo,
        income: String(item.flow.income || "0.00"),
        transactionTime: item.flow.transactionTime,
      }));
  }
  const dateTaskIds = await getDateTaskIdsByTaskId(Number(detailRef.taskId));
  if (!detailRuleId || dateTaskIds.length === 0) return [];

  const [rule] = await db
    .select({ matchedCounterpartyAlias: recognitionRules.matchedCounterpartyAlias })
    .from(recognitionRules)
    .where(eq(recognitionRules.id, detailRuleId));
  const alias = String(rule?.matchedCounterpartyAlias || "").trim();
  const [counterpartyRow] = alias
    ? await db.select().from(counterpartyRecords).where(eq(counterpartyRecords.alias, alias))
    : [];
  const counterparty = await attachCounterpartyMatchers(db, counterpartyRow);
  const scopedTaskIds = isSameDayAggregateDetailCounterparty(counterparty)
    ? [Number(detailRef.taskId)].filter(Boolean)
    : dateTaskIds;
  const flowRows = await db
    .select({ flow: bankFlows, taskRuleId: recognitionTasks.ruleId })
    .from(bankFlows)
    .leftJoin(recognitionTasks, eq(recognitionTasks.id, bankFlows.taskId))
    .where(and(
      inArray(bankFlows.taskId, scopedTaskIds),
      gt(bankFlows.income, "0"),
      ...(counterparty ? [
        eq(bankFlows.arrivalMatchStatus, "matched"),
        eq(bankFlows.matchedCounterpartyId, Number(counterparty.id)),
      ] : []),
    ));

  return flowRows
    .filter((item: any) => Number(item.taskRuleId || 0) === detailRuleId)
    .filter((item: any) => counterparty || Number(item.flow.taskId) === Number(detailRef.taskId))
    .map((item: any) => ({
      id: Number(item.flow.id),
      referenceNo: item.flow.referenceNo,
      income: String(item.flow.income || "0.00"),
      transactionTime: item.flow.transactionTime,
    }));
}

async function getActiveDetailCountForTask(task: { id: number; billDate: string; ruleId?: number | null }) {
  const db = getDb();
  const taskId = Number(task.id);
  const ruleId = Number(task.ruleId || 0);
  if (!ruleId) return 0;
  const detailPackageType = await getDetailPackageTypeForRule(ruleId);
  if (detailPackageType === "打包明细") {
    const [summary] = await db.select({
      cnt: sql<number>`COALESCE(SUM(${orderFiles.entryCount}), 0)`,
    }).from(orderFiles).where(and(
      eq(orderFiles.ruleId, ruleId),
      eq(orderFiles.detailPackageType, "打包明细"),
      eq(orderFiles.uploadDate, task.billDate),
      sql`${orderFiles.uploadStatus} <> 'abnormal'`,
    ));
    return Number(summary?.cnt || 0);
  }

  const [result] = await db
    .select({ cnt: count() })
    .from(billDetails)
    .where(and(
      or(
        detailPackageScopeSql(task.billDate, detailPackageType),
        transferredT1TaskScopeSql(taskId),
      ),
      eq(billDetails.ruleId, ruleId),
      isNull(billDetails.detailSplitFileId),
      recognizableDetailOperationSql(),
      excludeAbnormalOrderFilesSql(),
    ));

  return Number(result?.cnt || 0);
}

async function refreshTaskDetailSummary(taskId: number) {
  const db = getDb();
  const activeWhere = and(
    eq(billDetails.taskId, taskId),
    isNull(billDetails.detailSplitFileId),
    sql`(
      ${recognizableDetailOperationSql()}
      OR ${billDetails.operationStatus} = 'split_replaced'
      OR ${billDetails.ignoreReason} LIKE '已按明细分账拆分认账%'
    )`,
    excludeAbnormalOrderFilesSql(),
  );
  const sumResult = await db.select({
    total: sql`SUM(CAST(${billDetails.totalAmount} AS DECIMAL(18,2)))`,
  }).from(billDetails).where(activeWhere);
  const [cntResult] = await db.select({
    cnt: count(),
    matchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchResultId} IS NOT NULL THEN 1 ELSE 0 END)`,
    unmatchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'unmatched' THEN 1 ELSE 0 END)`,
    pendingSplitCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'pending_split' AND ${billDetails.matchResultId} IS NULL THEN 1 ELSE 0 END)`,
  }).from(billDetails).where(activeWhere);
  const total = Number(sumResult[0]?.total || 0);
  const cnt = Number(cntResult?.cnt || 0);
  await db.update(recognitionTasks).set({
    billDetailTotal: total.toFixed(2),
    billDetailCount: cnt,
    matchedCount: Number(cntResult?.matchedCount || 0),
    unmatchedCount: Number(cntResult?.unmatchedCount || 0),
    pendingSplitCount: Number(cntResult?.pendingSplitCount || 0),
    hasDetailFile: cnt > 0,
    updatedAt: new Date(),
  }).where(eq(recognitionTasks.id, taskId));
  const orderFileSummaries = await db.select({
    orderFileId: billDetails.orderFileId,
    matchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'matched' THEN 1 ELSE 0 END)`,
    unmatchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'unmatched' THEN 1 ELSE 0 END)`,
    pendingSplitCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'pending_split' THEN 1 ELSE 0 END)`,
  }).from(billDetails).where(and(
    activeWhere,
    sql`${billDetails.operationStatus} <> 'transferred'`,
  )).groupBy(billDetails.orderFileId);
  for (const summary of orderFileSummaries) {
    if (!summary.orderFileId) continue;
    await db.update(orderFiles).set({
      matchedCount: Number(summary.matchedCount || 0),
      unmatchedCount: Number(summary.unmatchedCount || 0),
      pendingSplitCount: Number(summary.pendingSplitCount || 0),
    }).where(eq(orderFiles.id, Number(summary.orderFileId)));
  }
  await refreshRecognitionDateSummariesByTaskIds([taskId]);
}

type DetailSummarySnapshot = {
  id?: number | null;
  taskId: number | null;
  ruleId: number | null;
  ruleItemId: number | null;
  orderFileId: number | null;
  detailSplitFileId: number | null;
  originalTaskId?: number | null;
  partitionDate?: string | null;
  originalRecognitionDate?: string | null;
  operationStatus: string | null;
  ignoreReason: string | null;
  matchResultId: number | null;
  matchStatus: string | null;
  totalAmount: string | number | null;
  refundAmountSnapshot: string | number | null;
  orderFileUploadStatus?: string | null;
  detailPackageType?: string | null;
  recognitionSummaryValid?: boolean | null;
};

function detailIsIncludedInSummary(detail: DetailSummarySnapshot) {
  if (detail.detailSplitFileId) return false;
  if (detail.orderFileUploadStatus === "abnormal") return false;
  const operationStatus = String(detail.operationStatus || "active");
  const ignoreReason = String(detail.ignoreReason || "");
  return operationStatus === "active"
    || (operationStatus === "transferred" && detail.detailPackageType !== "打包明细")
    || operationStatus === "split_replaced"
    || ignoreReason.startsWith("已按明细分账拆分认账");
}

function getDetailSummaryDelta(detail: DetailSummarySnapshot, direction: 1 | -1) {
  if (!detailIsIncludedInSummary(detail)) {
    return null;
  }
  const totalAmount = Number(detail.totalAmount || 0);
  const matchStatus = String(detail.matchStatus || "");
  const hasMatchResult = Boolean(Number(detail.matchResultId || 0));
  const includeInOrderFileSummary = String(detail.operationStatus || "active") !== "transferred";
  return {
    taskId: Number(detail.taskId || 0),
    orderFileId: Number(detail.orderFileId || 0),
    entryCount: direction,
    billDetailTotal: totalAmount * direction,
    taskMatchedCount: (hasMatchResult ? 1 : 0) * direction,
    taskUnmatchedCount: (matchStatus === "unmatched" ? 1 : 0) * direction,
    taskPendingSplitCount: (matchStatus === "pending_split" && !hasMatchResult ? 1 : 0) * direction,
    orderMatchedCount: (includeInOrderFileSummary && matchStatus === "matched" ? 1 : 0) * direction,
    orderUnmatchedCount: (includeInOrderFileSummary && matchStatus === "unmatched" ? 1 : 0) * direction,
    orderPendingSplitCount: (includeInOrderFileSummary && matchStatus === "pending_split" ? 1 : 0) * direction,
  };
}

async function getDetailSummarySnapshot(detailId: number, database: any = getDb()) {
  const db = database;
  const [detail] = await db
    .select({
      id: billDetails.id,
      taskId: billDetails.taskId,
      ruleId: sql<number>`COALESCE(${billDetails.ruleId}, ${orderFiles.ruleId}, 0)`,
      ruleItemId: billDetails.ruleItemId,
      orderFileId: billDetails.orderFileId,
      detailSplitFileId: billDetails.detailSplitFileId,
      originalTaskId: billDetails.originalTaskId,
      partitionDate: billDetails.partitionDate,
      originalRecognitionDate: billDetails.originalRecognitionDate,
      operationStatus: billDetails.operationStatus,
      ignoreReason: billDetails.ignoreReason,
      matchResultId: billDetails.matchResultId,
      matchStatus: billDetails.matchStatus,
      totalAmount: billDetails.totalAmount,
      refundAmountSnapshot: billDetails.refundAmountSnapshot,
      orderFileUploadStatus: orderFiles.uploadStatus,
      detailPackageType: orderFiles.detailPackageType,
      recognitionSummaryValid: orderFiles.recognitionSummaryValid,
    })
    .from(billDetails)
    .leftJoin(orderFiles, eq(billDetails.orderFileId, orderFiles.id))
    .where(eq(billDetails.id, detailId));
  return detail || null;
}

async function ensureManualOrderDetailsInHotTable(detailIds: number[]) {
  const ids = Array.from(new Set(detailIds.map(Number).filter(Boolean)));
  if (ids.length === 0) return;
  const db = getDb();
  const locators = await getManualOrderWorkItemLocators(db, ids);
  const archivedLocators = locators.filter(
    (item: any) => String(item.storageLocation || "") === "archive",
  );
  if (archivedLocators.length === 0) return;
  const partitionDates = Array.from(new Set<string>(
    archivedLocators
      .map((item: any) => String(item.partitionDate || ""))
      .filter((date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)),
  ));
  if (partitionDates.length === 0) return;

  await withBillDetailArchiveDateLocks(partitionDates, async () => {
    await db.transaction(async (tx) => {
      const restoredDates = new Set<string>();
      for (const locator of archivedLocators as any[]) {
        const detailId = Number(locator.detailId || 0);
        const partitionDate = String(locator.partitionDate || "");
        if (!detailId || !/^\d{4}-\d{2}-\d{2}$/.test(partitionDate)) continue;
        const [hotDetail] = await tx
          .select({ id: billDetails.id })
          .from(billDetails)
          .where(and(
            eq(billDetails.id, detailId),
            eq(billDetails.partitionDate, partitionDate),
          ))
          .limit(1);
        if (hotDetail) continue;
        const restored = await restoreArchivedDetailToHotTable(tx, {
          detailId,
          partitionDate,
        });
        if (!restored) {
          throw new Error(`订单明细 ${detailId} 的归档数据不存在，请刷新后重试`);
        }
        restoredDates.add(partitionDate);
      }
      await syncManualOrderWorkItemsByDetailIds(
        tx,
        archivedLocators.map((item: any) => Number(item.detailId || 0)),
      );
      if (restoredDates.size > 0) {
        const dates = Array.from(restoredDates);
        await refreshArchiveRunSnapshots(
          tx,
          dates.map((date) => `bill_details_archive_${date.slice(0, 7).replace("-", "")}`),
          dates,
        );
      }
    });
  });
}

async function applyDetailSummaryDelta(
  detail: DetailSummarySnapshot,
  direction: 1 | -1,
  options: {
    refreshDateSummary?: boolean;
    db?: any;
    recognitionSummaryMode?: "invalidate" | "delta";
  } = {},
) {
  const delta = getDetailSummaryDelta(detail, direction);
  if (!delta?.taskId) return;
  const db = options.db || getDb();
  const recognitionSummaryMode = options.recognitionSummaryMode || "invalidate";
  if (recognitionSummaryMode === "delta") {
    await applyRecognitionSummaryDelta(db, detail, direction);
  }
  await db.update(recognitionTasks).set({
    billDetailTotal: sql`CAST(${recognitionTasks.billDetailTotal} AS DECIMAL(18,2)) + ${delta.billDetailTotal.toFixed(2)}`,
    billDetailCount: sql`GREATEST(COALESCE(${recognitionTasks.billDetailCount}, 0) + ${delta.entryCount}, 0)`,
    matchedCount: sql`GREATEST(COALESCE(${recognitionTasks.matchedCount}, 0) + ${delta.taskMatchedCount}, 0)`,
    unmatchedCount: sql`GREATEST(COALESCE(${recognitionTasks.unmatchedCount}, 0) + ${delta.taskUnmatchedCount}, 0)`,
    pendingSplitCount: sql`GREATEST(COALESCE(${recognitionTasks.pendingSplitCount}, 0) + ${delta.taskPendingSplitCount}, 0)`,
    hasDetailFile: sql`GREATEST(COALESCE(${recognitionTasks.billDetailCount}, 0) + ${delta.entryCount}, 0) > 0`,
    updatedAt: new Date(),
  }).where(eq(recognitionTasks.id, delta.taskId));

  if (delta.orderFileId) {
    await db.update(orderFiles).set({
      matchedCount: sql`GREATEST(COALESCE(${orderFiles.matchedCount}, 0) + ${delta.orderMatchedCount}, 0)`,
      unmatchedCount: sql`GREATEST(COALESCE(${orderFiles.unmatchedCount}, 0) + ${delta.orderUnmatchedCount}, 0)`,
      pendingSplitCount: sql`GREATEST(COALESCE(${orderFiles.pendingSplitCount}, 0) + ${delta.orderPendingSplitCount}, 0)`,
      ...(recognitionSummaryMode === "invalidate" ? { recognitionSummaryValid: false } : {}),
    }).where(eq(orderFiles.id, delta.orderFileId));
    if (recognitionSummaryMode === "invalidate") {
      await deleteSourceRecognitionSummaryDeltas(db, [delta.orderFileId]);
    }
  }

  if (options.refreshDateSummary !== false) {
    await refreshRecognitionDateSummariesByTaskIds([delta.taskId]);
  }
}

function amountToCents(value: unknown) {
  return toCents(Number(value || 0));
}

function ignoredT1TransferCandidateConditions(ruleId: number, targetTaskId: number) {
  return [
    eq(billDetails.operationStatus, "ignored"),
    sql`${billDetails.matchResultId} IS NULL`,
    isNull(billDetails.detailSplitFileId),
    sql`COALESCE(${billDetails.ignoreReason}, '') NOT LIKE '已拆分%'`,
    sql`COALESCE(${billDetails.ignoreReason}, '') NOT LIKE '已按明细分账拆分认账%'`,
    sql`COALESCE(${orderFiles.detailPackageType}, 'T+1') = 'T+1'`,
    sql`COALESCE(${orderFiles.uploadStatus}, 'completed') <> 'abnormal'`,
    sql`COALESCE(${billDetails.ruleId}, ${orderFiles.ruleId}, ${recognitionTasks.ruleId}) = ${ruleId}`,
    sql`${billDetails.taskId} <> ${targetTaskId}`,
    eq(billDetails.matchStatus, "matched"),
  ];
}

async function resetStaleAggregateDetailRecognitionForRerun(taskId: number) {
  const db = getDb();
  const context = await getAggregateDetailTaskContext(taskId);
  if (!context || context.flows.length === 0) return false;

  const ruleId = Number(context.task.ruleId || 0);
  if (!ruleId) return false;
  const detailPackageType = await getDetailPackageTypeForRule(ruleId);
  const detailScope = or(
    detailPackageScopeSql(context.task.billDate, detailPackageType),
    transferredT1TaskScopeSql(taskId),
  );
  const activeDetailWhere = and(
    detailScope,
    eq(billDetails.ruleId, ruleId),
    isNull(billDetails.detailSplitFileId),
    sql`(
      ${recognizableDetailOperationSql()}
      OR ${billDetails.operationStatus} = 'split_replaced'
      OR ${billDetails.ignoreReason} LIKE '已按明细分账拆分认账%'
    )`,
    excludeAbnormalOrderFilesSql(),
  );

  const flowIds = context.flows.map((flow) => Number(flow.id)).filter(Boolean);
  const bankTotal = context.flows.reduce((sum, flow) => sum + Number(flow.income || 0), 0);
  const [detailSummary] = await db.select({
    total: sql<string>`COALESCE(SUM(CAST(${billDetails.totalAmount} AS DECIMAL(18,2))), 0.00)`,
    openTotal: sql<string>`COALESCE(SUM(CASE WHEN ${billDetails.matchResultId} IS NULL THEN CAST(${billDetails.totalAmount} AS DECIMAL(18,2)) ELSE 0 END), 0.00)`,
  }).from(billDetails).where(activeDetailWhere);
  const [resultSummary] = await db.select({
    total: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
  }).from(matchResults).where(and(
    inArray(matchResults.bankFlowId, flowIds),
    sql`${matchResults.ruleItemId} IS NOT NULL`,
  ));

  const detailTotal = Number(detailSummary?.total || 0);
  const openTotal = Number(detailSummary?.openTotal || 0);
  const resultTotal = Number(resultSummary?.total || 0);
  const shouldReset =
    toCents(detailTotal) === toCents(bankTotal) &&
    toCents(openTotal) === 0 &&
    toCents(resultTotal) !== toCents(bankTotal);
  if (!shouldReset) return false;

  const resultRows = await db.select({ id: matchResults.id }).from(matchResults).where(and(
    inArray(matchResults.bankFlowId, flowIds),
    sql`${matchResults.ruleItemId} IS NOT NULL`,
  ));
  const resultIds = resultRows.map((row) => Number(row.id)).filter(Boolean);
  if (resultIds.length === 0) return false;

  const [createdVoucherSummary] = await db.select({ count: count() }).from(matchResults).where(and(
    inArray(matchResults.id, resultIds),
    eq(matchResults.voucherStatus, "created"),
  ));
  if (Number(createdVoucherSummary?.count || 0) > 0) {
    throw new Error("同日汇总认账结果已有制单记录，无法自动重新执行认账");
  }

  await clearBillDetailMatchResults(db, resultIds);
  await db.delete(matchResults).where(inArray(matchResults.id, resultIds));
  await db.update(bankFlows)
    .set({ recognitionStatus: "unrecognized" })
    .where(inArray(bankFlows.id, flowIds));

  const sourceTaskRows = await db.select({ taskId: billDetails.taskId })
    .from(billDetails)
    .where(activeDetailWhere)
    .groupBy(billDetails.taskId);
  for (const sourceTaskId of sourceTaskRows.map((row) => Number(row.taskId)).filter(Boolean)) {
    await refreshTaskDetailSummary(sourceTaskId);
  }
  for (const statusTaskId of Array.from(new Set(context.flows.map((flow) => Number(flow.taskId)).filter(Boolean)))) {
    await refreshTaskStatusByFlows(statusTaskId);
  }
  return true;
}

async function markTaskLargeVariance(taskId: number, detailTotal: number, detailCount: number, diffAmount: number) {
  const db = getDb();
  const [statusSummary] = await db.select({
    matchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchResultId} IS NOT NULL THEN 1 ELSE 0 END)`,
    unmatchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'unmatched' THEN 1 ELSE 0 END)`,
    pendingSplitCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'pending_split' AND ${billDetails.matchResultId} IS NULL THEN 1 ELSE 0 END)`,
  }).from(billDetails).where(and(
    eq(billDetails.taskId, taskId),
    isNull(billDetails.detailSplitFileId),
    recognizableDetailOperationSql(),
    excludeAbnormalOrderFilesSql(),
  ));
  await db.update(recognitionTasks).set({
    status: "large_variance",
    billDetailTotal: detailTotal.toFixed(2),
    billDetailCount: detailCount,
    matchedCount: Number(statusSummary?.matchedCount || 0),
    unmatchedCount: Number(statusSummary?.unmatchedCount || 0),
    pendingSplitCount: Number(statusSummary?.pendingSplitCount || 0),
    diffAmount: Math.max(0, diffAmount).toFixed(2),
    completedAt: null,
    updatedAt: new Date(),
  }).where(eq(recognitionTasks.id, taskId));
  await db.update(bankFlows)
    .set({ recognitionStatus: "large_variance" })
    .where(and(eq(bankFlows.taskId, taskId), gt(bankFlows.income, "0")));
  await refreshRecognitionDateSummariesByTaskIds([taskId]);
}

async function markTaskLargeVarianceFromSummary(
  taskId: number,
  detailTotal: number,
  detailCount: number,
  diffAmount: number,
  matchedCount: number,
  pendingSplitCount = 0,
) {
  const db = getDb();
  await db.update(recognitionTasks).set({
    status: "large_variance",
    billDetailTotal: detailTotal.toFixed(2),
    billDetailCount: detailCount,
    matchedCount,
    unmatchedCount: Math.max(0, detailCount - matchedCount),
    pendingSplitCount,
    diffAmount: Math.max(0, diffAmount).toFixed(2),
    completedAt: null,
    updatedAt: new Date(),
  }).where(eq(recognitionTasks.id, taskId));
  await db.update(bankFlows)
    .set({ recognitionStatus: "large_variance" })
    .where(and(eq(bankFlows.taskId, taskId), gt(bankFlows.income, "0")));
  await refreshRecognitionDateSummariesByTaskIds([taskId]);
}

async function tryFastPackageVarianceCheck(
  task: typeof recognitionTasks.$inferSelect & { rule?: any },
  ruleItemsList: Array<{ id: number }>,
  isAggregateDetailMode: boolean,
) {
  if (task.rule?.conditionRecognitionEnabled !== false) return null;
  const detailRuleId = Number(task.ruleId || 0);
  if (!detailRuleId) return null;
  const matchedCounterpartyAlias = String(task.rule?.matchedCounterpartyAlias || "").trim();
  if (!matchedCounterpartyAlias) return null;
  const detailPackageType = await getDetailPackageTypeForRule(detailRuleId);
  if (detailPackageType !== "打包明细") return null;

  const db = getDb();
  const [detailSummary] = await db.select({
    total: sql<string>`COALESCE(SUM(CAST(${orderFiles.orderTotalAmount} AS DECIMAL(18,2)) - CAST(${orderFiles.refundAmount} AS DECIMAL(18,2))), 0.00)`,
    count: sql<number>`COALESCE(SUM(${orderFiles.entryCount}), 0)`,
    pendingSplitCount: sql<number>`COALESCE(SUM(${orderFiles.pendingSplitCount}), 0)`,
  }).from(orderFiles)
    .leftJoin(recognitionRules, eq(recognitionRules.id, orderFiles.ruleId))
    .where(and(
    eq(recognitionRules.matchedCounterpartyAlias, matchedCounterpartyAlias),
    eq(orderFiles.detailPackageType, "打包明细"),
    eq(orderFiles.uploadDate, task.billDate),
    sql`${orderFiles.uploadStatus} <> 'abnormal'`,
  ));
  const detailTotal = Number(detailSummary?.total || 0);
  const detailCount = Number(detailSummary?.count || 0);
  if (detailCount === 0) return null;

  let availableRecognitionTotal = 0;
  let recognizedTotal = 0;
  let recognizedCount = 0;
  if (isAggregateDetailMode) {
    const aggregateContext = await getAggregateDetailTaskContext(Number(task.id));
    const aggregateCandidateFlows = aggregateContext?.flows || [];
    const flowIds = aggregateCandidateFlows.map((flow) => Number(flow.id)).filter(Boolean);
    const recognizedRows = flowIds.length > 0
      ? await db.select({
        total: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
        detailCount: sql<number>`COALESCE(SUM(${matchResults.detailCount}), 0)`,
      }).from(matchResults).where(and(
        inArray(matchResults.bankFlowId, flowIds),
        ruleItemsList.length > 0 ? inArray(matchResults.ruleItemId, ruleItemsList.map((item) => Number(item.id))) : sql`1 = 1`,
      ))
      : [];
    recognizedTotal = Number(recognizedRows[0]?.total || 0);
    recognizedCount = Number(recognizedRows[0]?.detailCount || 0);
    availableRecognitionTotal = Math.max(0, aggregateCandidateFlows.reduce((sum, flow) => sum + Number(flow.income || 0), 0) - recognizedTotal);
  } else {
    const [bankTotalRow] = await db.select({
      total: sql<string>`COALESCE(SUM(CAST(${bankFlows.income} AS DECIMAL(18,2))), 0.00)`,
    }).from(bankFlows).where(and(
      eq(bankFlows.taskId, Number(task.id)),
      gt(bankFlows.income, "0"),
    ));
    const [recognizedRow] = await db.select({
      total: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
      detailCount: sql<number>`COALESCE(SUM(${matchResults.detailCount}), 0)`,
    }).from(matchResults).where(and(
      eq(matchResults.taskId, Number(task.id)),
      recognitionEligibleMatchResultWhere(),
    ));
    recognizedTotal = Number(recognizedRow?.total || 0);
    recognizedCount = Number(recognizedRow?.detailCount || 0);
    availableRecognitionTotal = Math.max(0, Number(bankTotalRow?.total || 0) - recognizedTotal);
  }

  const requiredRecognitionCents = Math.max(0, toCents(detailTotal) - toCents(recognizedTotal));
  const availableRecognitionCents = Math.max(0, toCents(availableRecognitionTotal));
  if (requiredRecognitionCents <= availableRecognitionCents) return null;
  const requiredRecognitionTotal = requiredRecognitionCents / 100;
  const normalizedAvailableRecognitionTotal = availableRecognitionCents / 100;

  await markTaskLargeVarianceFromSummary(
    Number(task.id),
    detailTotal,
    detailCount,
    requiredRecognitionTotal - normalizedAvailableRecognitionTotal,
    recognizedCount,
    Number(detailSummary?.pendingSplitCount || 0),
  );
  return {
    success: true,
    status: "large_variance",
    matchedCount: recognizedCount,
    unmatchedCount: Math.max(0, detailCount - recognizedCount),
    ignoredCount: 0,
    hasVariance: true,
    skipped: true,
    reason: "未认账订单明细金额大于剩余未认账银行流水金额，未执行明细认账",
  };
}

async function refreshPendingDetailMatches(
  detailScope: any,
  ruleId: number,
  ruleItems: Array<{ id: number; detailKeyword?: string | null; keywordField?: string | null; keywordMatchType?: string | null }>,
  multiSplitConfig?: { conditionRecognitionEnabled?: boolean | null; enabled?: boolean | null; keywordField?: string | null; keyword?: string | null },
) {
  const db = getDb();
  const openMatchedRuleItemRows = await db
    .select({ ruleItemId: billDetails.ruleItemId })
    .from(billDetails)
    .where(and(
      detailScope,
      eq(billDetails.ruleId, ruleId),
      sql`${billDetails.matchResultId} IS NULL`,
      eq(billDetails.matchStatus, "matched"),
      sql`${billDetails.ruleItemId} IS NOT NULL`,
      recognizableDetailOperationSql(),
      excludeAbnormalOrderFilesSql(),
    ))
    .groupBy(billDetails.ruleItemId);
  const staleRuleItemIds = findStaleDetailRuleItemIds(
    openMatchedRuleItemRows.map((row) => row.ruleItemId),
    ruleItems,
  );
  if (staleRuleItemIds.length > 0) {
    await db.update(billDetails).set({
      matchStatus: "unmatched",
      ruleItemId: null,
    }).where(and(
      detailScope,
      eq(billDetails.ruleId, ruleId),
      sql`${billDetails.matchResultId} IS NULL`,
      eq(billDetails.matchStatus, "matched"),
      inArray(billDetails.ruleItemId, staleRuleItemIds),
      recognizableDetailOperationSql(),
      excludeAbnormalOrderFilesSql(),
    ));
  }

  const pendingWhere = and(
    detailScope,
    eq(billDetails.ruleId, ruleId),
    sql`${billDetails.matchResultId} IS NULL`,
    eq(billDetails.matchStatus, "unmatched"),
    recognizableDetailOperationSql(),
    excludeAbnormalOrderFilesSql(),
  );

  const exactItems = ruleItems.filter((item) => item.keywordMatchType !== "包含");
  const containsItems = ruleItems.filter((item) => item.keywordMatchType === "包含");
  const packageRecognitionItem = multiSplitConfig?.conditionRecognitionEnabled === false ? ruleItems[0] : null;
  const multiSplitEnabled = Boolean(multiSplitConfig?.enabled);
  const multiSplitKeywordField = String(multiSplitConfig?.keywordField || "").trim();
  const multiSplitKeyword = String(multiSplitConfig?.keyword || "").trim();
  const combinedSplitItems = ruleItems.filter((item) =>
    multiSplitEnabled
    && multiSplitKeywordField
    && multiSplitKeyword
    && String(item.keywordField || "").trim() === multiSplitKeywordField
    && String(item.detailKeyword || "").trim()
  );
  const combinedExactSplitItems = combinedSplitItems.filter((item) => item.keywordMatchType !== "包含");
  const combinedContainsSplitItems = combinedSplitItems.filter((item) => item.keywordMatchType === "包含");

  if (packageRecognitionItem) {
    await db.update(billDetails).set({
      matchStatus: "matched",
      ruleItemId: packageRecognitionItem.id,
    }).where(pendingWhere);
  } else {
    for (const item of exactItems) {
      await applyPendingMatch(item);
    }

    if (combinedSplitItems.length > 0) {
      for (const item of combinedExactSplitItems) {
        await applyPendingSplitMatch(item);
      }
      for (const item of combinedContainsSplitItems) {
        await applyPendingSplitMatch(item);
      }
    }

    for (const item of containsItems) {
      await applyPendingMatch(item);
    }
  }

  async function applyPendingMatch(item: typeof ruleItems[number]) {
    const keyword = String(item.detailKeyword || "").trim();
    if (!keyword) return;

    const keywordField = String(item.keywordField || "").trim();
    const keywordValue = keywordField
      ? sql`JSON_UNQUOTE(JSON_EXTRACT(${billDetails.rawData}, ${jsonPathForField(keywordField)}))`
      : sql`${billDetails.description}`;
    const keywordMatch = item.keywordMatchType === "包含"
      ? sql`${keywordValue} LIKE ${`%${keyword}%`}`
      : sql`${keywordValue} = ${keyword}`;

    await db.update(billDetails).set({
      matchStatus: "matched",
      ruleItemId: item.id,
    }).where(and(
      pendingWhere,
      keywordMatch,
    ));
  }

  async function applyPendingSplitMatch(item: typeof ruleItems[number]) {
    const keyword = String(item.detailKeyword || "").trim();
    if (!keyword || !multiSplitKeywordField || !multiSplitKeyword) return;

    const keywordValue = sql`JSON_UNQUOTE(JSON_EXTRACT(${billDetails.rawData}, ${jsonPathForField(multiSplitKeywordField)}))`;
    const normalizedValue = sql`TRIM(REPLACE(REPLACE(REPLACE(${keywordValue}, '  ', ' '), '  ', ' '), '  ', ' '))`;
    const combinedKeyword = `${keyword} ${multiSplitKeyword}`;
    const keywordMatch = item.keywordMatchType === "包含"
      ? sql`${normalizedValue} LIKE ${`%${combinedKeyword}%`}`
      : sql`${normalizedValue} = ${combinedKeyword}`;

    await db.update(billDetails).set({
      matchStatus: "pending_split",
      ruleItemId: null,
    }).where(and(
      pendingWhere,
      keywordMatch,
    ));
  }

  const summaries = await db
    .select({
      orderFileId: billDetails.orderFileId,
      matchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'matched' THEN 1 ELSE 0 END)`,
      unmatchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'unmatched' THEN 1 ELSE 0 END)`,
      pendingSplitCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'pending_split' THEN 1 ELSE 0 END)`,
    })
    .from(billDetails)
    .where(and(
      detailScope,
      eq(billDetails.ruleId, ruleId),
      excludeAbnormalOrderFilesSql(),
    ))
    .groupBy(billDetails.orderFileId);

  for (const summary of summaries) {
    if (!summary.orderFileId) continue;
    await db.update(orderFiles).set({
      matchedCount: Number(summary.matchedCount || 0),
      unmatchedCount: Number(summary.unmatchedCount || 0),
      pendingSplitCount: Number(summary.pendingSplitCount || 0),
    }).where(eq(orderFiles.id, Number(summary.orderFileId)));
  }
}

async function assertNoCreatedVoucherForTaskIds(taskIds: number[], message: string) {
  const db = getDb();
  if (taskIds.length === 0) return;
  const rows = await db
    .select({ count: count() })
    .from(matchResults)
    .where(and(
      inArray(matchResults.taskId, taskIds),
      eq(matchResults.voucherStatus, "created"),
    ));
  if (Number(rows[0]?.count || 0) > 0) {
    throw new Error(message);
  }
}

function chunkIds(ids: number[], size = 5000) {
  const chunks: number[][] = [];
  for (let index = 0; index < ids.length; index += size) {
    chunks.push(ids.slice(index, index + size));
  }
  return chunks;
}

async function assertNoCreatedVoucherForResultIds(matchResultIds: number[], message: string) {
  const db = getDb();
  const uniqueIds = Array.from(new Set(matchResultIds.map(Number).filter(Boolean)));
  if (uniqueIds.length === 0) return;
  for (const chunk of chunkIds(uniqueIds)) {
    const [result] = await db.select({ count: count() }).from(matchResults).where(and(
      inArray(matchResults.id, chunk),
      eq(matchResults.voucherStatus, "created"),
    ));
    if (Number(result?.count || 0) > 0) {
      throw new Error(message);
    }
  }
}

async function deleteDateTasksWithSteps(
  taskId: number,
  setStep: (step: number, message: string) => void,
) {
  const db = getDb();
  const taskIds = await getDateTaskIdsByTaskId(taskId);
  if (taskIds.length === 0) return { billDates: [], deletedTasks: 0 };

  const taskRows = await db
    .select({ id: recognitionTasks.id, billDate: recognitionTasks.billDate })
    .from(recognitionTasks)
    .where(inArray(recognitionTasks.id, taskIds));
  const billDates = Array.from(new Set(taskRows.map((item) => item.billDate).filter(Boolean)));
  const deletedOrderFileRows = await db
    .select({ id: orderFiles.id })
    .from(orderFiles)
    .where(inArray(orderFiles.taskId, taskIds));
  const deletedOrderFileIds = deletedOrderFileRows.map((item) => Number(item.id || 0)).filter(Boolean);

  const details = await db
    .select({
      id: billDetails.id,
      taskId: billDetails.taskId,
      orderFileId: billDetails.orderFileId,
      detailSplitFileId: billDetails.detailSplitFileId,
      splitSourceDetailId: billDetails.splitSourceDetailId,
      matchResultId: billDetails.matchResultId,
    })
    .from(billDetails)
    .where(inArray(billDetails.taskId, taskIds));

  const detailIds = Array.from(new Set(details.map((item) => Number(item.id)).filter(Boolean)));
  const detailIdSet = new Set(detailIds);
  const sourceIdsToRollback = Array.from(new Set(
    details
      .map((item) => Number(item.splitSourceDetailId || 0))
      .filter((id) => id && !detailIdSet.has(id)),
  ));
  const resultIds = new Set<number>();
  const affectedDetailSplitFileIds = new Set<number>();

  details.forEach((item) => {
    const resultId = Number(item.matchResultId || 0);
    if (resultId) resultIds.add(resultId);
    const splitFileId = Number(item.detailSplitFileId || 0);
    if (splitFileId) affectedDetailSplitFileIds.add(splitFileId);
  });

  const taskResultRows = await db
    .select({ id: matchResults.id })
    .from(matchResults)
    .where(inArray(matchResults.taskId, taskIds));
  taskResultRows.forEach((item) => {
    const resultId = Number(item.id || 0);
    if (resultId) resultIds.add(resultId);
  });

  const linkedMultiDayGroups = await db
    .select({ groupId: multiDayMatchGroupFlows.groupId })
    .from(multiDayMatchGroupFlows)
    .innerJoin(bankFlows, eq(bankFlows.id, multiDayMatchGroupFlows.bankFlowId))
    .where(inArray(bankFlows.taskId, taskIds));
  const releasedMultiDayGroupIds = Array.from(new Set(linkedMultiDayGroups
    .map((row) => Number(row.groupId || 0))
    .filter(Boolean)));
  const releasedMultiDayOrderFileIds = new Set<number>();
  const releasedMultiDayFlowIds = new Set<number>();
  const releasedMultiDayTaskIds = new Set<number>();
  for (const groupId of releasedMultiDayGroupIds) {
    const groupFiles = await db.select({ id: orderFiles.id })
      .from(orderFiles)
      .where(eq(orderFiles.multiDayMatchGroupId, groupId));
    groupFiles.forEach((row) => releasedMultiDayOrderFileIds.add(Number(row.id)));
    const groupFlows = await db
      .select({ bankFlowId: multiDayMatchGroupFlows.bankFlowId, taskId: bankFlows.taskId })
      .from(multiDayMatchGroupFlows)
      .innerJoin(bankFlows, eq(bankFlows.id, multiDayMatchGroupFlows.bankFlowId))
      .where(eq(multiDayMatchGroupFlows.groupId, groupId));
    groupFlows.forEach((row) => {
      releasedMultiDayFlowIds.add(Number(row.bankFlowId));
      releasedMultiDayTaskIds.add(Number(row.taskId));
    });
  }
  if (releasedMultiDayFlowIds.size > 0) {
    const groupResults = await db.select({ id: matchResults.id })
      .from(matchResults)
      .where(inArray(matchResults.bankFlowId, Array.from(releasedMultiDayFlowIds)));
    groupResults.forEach((row) => resultIds.add(Number(row.id)));
  }

  const linkedSplitDetailIds: number[] = [];
  for (const chunk of chunkIds(detailIds)) {
    const linkedRows = await db
      .select({
        id: billDetails.id,
        detailSplitFileId: billDetails.detailSplitFileId,
        matchResultId: billDetails.matchResultId,
      })
      .from(billDetails)
      .where(and(
        inArray(billDetails.splitSourceDetailId, chunk),
        sql`${billDetails.detailSplitFileId} IS NOT NULL`,
      ));
    linkedRows.forEach((row) => {
      const detailId = Number(row.id || 0);
      if (detailId) linkedSplitDetailIds.push(detailId);
      const splitFileId = Number(row.detailSplitFileId || 0);
      if (splitFileId) affectedDetailSplitFileIds.add(splitFileId);
      const resultId = Number(row.matchResultId || 0);
      if (resultId) resultIds.add(resultId);
    });
  }

  if (sourceIdsToRollback.length > 0) {
    for (const chunk of chunkIds(sourceIdsToRollback)) {
      const sourceRows = await db
        .select({ matchResultId: billDetails.matchResultId })
        .from(billDetails)
        .where(inArray(billDetails.id, chunk));
      sourceRows.forEach((row) => {
        const resultId = Number(row.matchResultId || 0);
        if (resultId) resultIds.add(resultId);
      });
    }
  }

  const allResultIds = Array.from(resultIds);
  await assertNoCreatedVoucherForResultIds(allResultIds, "该账单日期已有入账锁定记录，无法删除。");

  setStep(1, DELETE_TASK_STEPS[0]);
  await db.transaction(async (tx) => {
    for (const chunk of chunkIds(linkedSplitDetailIds)) {
      await tx.update(billDetails).set({
        taskId: 0,
        orderFileId: null,
        splitSourceDetailId: null,
        billDate: "1970-01-01",
        partitionDate: "1970-01-01",
        lifecycleStatus: "unmatched_package",
        matchResultId: sql`NULL`,
      }).where(inArray(billDetails.id, chunk));
    }
    for (const chunk of chunkIds(sourceIdsToRollback)) {
      await tx.update(billDetails).set({
        matchStatus: "pending_split",
        matchResultId: sql`NULL`,
        ruleItemId: null,
        operationStatus: "active",
        ignoreReason: null,
      }).where(and(
        inArray(billDetails.id, chunk),
        sql`(
          ${billDetails.operationStatus} = 'split_replaced'
          OR (
            ${billDetails.operationStatus} = 'ignored'
            AND ${billDetails.ignoreReason} LIKE '已按明细分账拆分认账%'
          )
        )`,
      ));
    }
    if (releasedMultiDayGroupIds.length > 0) {
      const allGroupOrderFileIds = Array.from(releasedMultiDayOrderFileIds);
      if (allGroupOrderFileIds.length > 0) {
        await tx.update(billDetails).set({ matchResultId: sql`NULL` }).where(and(
          inArray(billDetails.orderFileId, allGroupOrderFileIds),
          isNull(billDetails.detailSplitFileId),
        ));
        const remainingGroupOrderFileIds = allGroupOrderFileIds.filter((id) => !deletedOrderFileIds.includes(id));
        if (remainingGroupOrderFileIds.length > 0) {
          await tx.update(orderFiles).set({ taskId: 0, uploadDate: null })
            .where(inArray(orderFiles.id, remainingGroupOrderFileIds));
          await tx.update(billDetails).set({
            taskId: 0,
            billDate: "1970-01-01",
            partitionDate: "1970-01-01",
            lifecycleStatus: "unmatched_package",
          }).where(and(
            inArray(billDetails.orderFileId, remainingGroupOrderFileIds),
            isNull(billDetails.detailSplitFileId),
          ));
        }
      }
      if (releasedMultiDayFlowIds.size > 0) {
        await tx.update(bankFlows).set({ recognitionStatus: "unrecognized" })
          .where(inArray(bankFlows.id, Array.from(releasedMultiDayFlowIds)));
      }
      await tx.delete(multiDayMatchGroupFlows)
        .where(inArray(multiDayMatchGroupFlows.groupId, releasedMultiDayGroupIds));
      await tx.update(multiDayMatchGroups).set({
        status: "unmatched",
        anchorTaskId: null,
        latestBillDate: null,
        updatedAt: new Date(),
      }).where(inArray(multiDayMatchGroups.id, releasedMultiDayGroupIds));
    }
  });
  setStep(2, DELETE_TASK_STEPS[1]);
  for (const chunk of chunkIds(allResultIds)) {
    await db.transaction(async (tx) => {
      await clearBillDetailMatchResults(tx, chunk);
      await tx.delete(matchResults).where(inArray(matchResults.id, chunk));
    });
  }

  setStep(3, DELETE_TASK_STEPS[2]);
  await db.transaction(async (tx) => {
    await deleteManualOrderWorkItemsByOrderFileIds(tx, deletedOrderFileIds);
    await clearOrderFilePartitionsByOrderFileIds(tx, Array.from(new Set([
      ...deletedOrderFileIds,
      ...Array.from(releasedMultiDayOrderFileIds),
    ])));
    await tx.delete(billDetails).where(inArray(billDetails.taskId, taskIds));
    await tx.delete(orderFiles).where(inArray(orderFiles.taskId, taskIds));
  });

  setStep(4, DELETE_TASK_STEPS[3]);
  await db.delete(bankFlows).where(inArray(bankFlows.taskId, taskIds));

  setStep(5, DELETE_TASK_STEPS[4]);
  await db.delete(recognitionTasks).where(inArray(recognitionTasks.id, taskIds));
  for (const orderFileId of Array.from(releasedMultiDayOrderFileIds).filter((id) => !deletedOrderFileIds.includes(id))) {
    await syncOrderFilePartitionsByOrderFileId(db, orderFileId);
  }
  for (const remainingTaskId of Array.from(releasedMultiDayTaskIds).filter((id) => !taskIds.includes(id))) {
    await refreshTaskStatusByFlows(remainingTaskId);
  }
  for (const groupId of releasedMultiDayGroupIds) {
    await cleanupEmptyMultiDayMatchGroup(groupId);
    const [remaining] = await db.select({ count: count() })
      .from(orderFiles)
      .where(eq(orderFiles.multiDayMatchGroupId, groupId));
    if (Number(remaining?.count || 0) > 0) {
      await refreshMultiDayMatchGroupTotal(groupId);
      await evaluateMultiDayMatchGroup({ groupId });
    }
  }
  for (const billDate of billDates) {
    await refreshRecognitionDateSummary(billDate);
  }
  for (const splitFileId of Array.from(affectedDetailSplitFileIds)) {
    const [summary] = await db.select({
      entryCount: count(),
      matchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'matched' THEN 1 ELSE 0 END)`,
      unmatchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'unmatched' THEN 1 ELSE 0 END)`,
      pendingRecognitionCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'matched' AND ${billDetails.matchResultId} IS NULL THEN 1 ELSE 0 END)`,
      recognizedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchResultId} IS NOT NULL THEN 1 ELSE 0 END)`,
    }).from(billDetails).where(eq(billDetails.detailSplitFileId, splitFileId));
    await db.update(detailSplitFiles).set({
      entryCount: Number(summary?.entryCount || 0),
      processedCount: Number(summary?.entryCount || 0),
      matchedCount: Number(summary?.matchedCount || 0),
      unmatchedCount: Number(summary?.unmatchedCount || 0),
      pendingRecognitionCount: Number(summary?.pendingRecognitionCount || 0),
      recognizedCount: Number(summary?.recognizedCount || 0),
    }).where(eq(detailSplitFiles.id, splitFileId));
  }

  return { billDates, deletedTasks: taskIds.length };
}

async function runDeleteTaskSession(deleteId: string, taskId: number) {
  try {
    const result = await deleteDateTasksWithSteps(taskId, (step, message) => {
      updateDeleteTaskSession(deleteId, { step, message, status: "running" });
    });
    updateDeleteTaskSession(deleteId, {
      billDate: result.billDates[0] || "",
      status: "completed",
      step: DELETE_TASK_STEPS.length,
      message: "删除完成，正在刷新列表",
      completedAt: Date.now(),
    });
  } catch (err: any) {
    updateDeleteTaskSession(deleteId, {
      status: "failed",
      message: "删除失败",
      error: err?.message || "删除失败",
      completedAt: Date.now(),
    });
  }
}

async function resolveTransferTargetTask(
  targetDate: string,
  ruleId: number,
  creatorId: number,
  database: any = getDb(),
) {
  const db = database;
  const dateTasks = await db.select().from(recognitionTasks).where(eq(recognitionTasks.billDate, targetDate));
  const sameRuleTask = dateTasks.find((task: any) => Number(task.ruleId || 0) === ruleId);
  if (sameRuleTask) return Number(sameRuleTask.id);

  const rule = await db.query.recognitionRules.findFirst({ where: eq(recognitionRules.id, ruleId) });
  if (rule?.matchedCounterpartyAlias && dateTasks.length > 0) {
    const [counterpartyRow] = await db.select().from(counterpartyRecords)
      .where(eq(counterpartyRecords.alias, rule.matchedCounterpartyAlias));
    const counterparty = await attachCounterpartyMatchers(db, counterpartyRow);
    const taskIds = dateTasks.map((task: any) => Number(task.id));
    const dateFlows = taskIds.length > 0 && counterparty
      ? await db.select().from(bankFlows).where(and(
        inArray(bankFlows.taskId, taskIds),
        eq(bankFlows.arrivalMatchStatus, "matched"),
        eq(bankFlows.matchedCounterpartyId, Number(counterparty.id)),
      ))
      : [];
    const candidateFlows = dateFlows;
    if (counterparty && isSameDayAggregateDetailCounterparty(counterparty) && candidateFlows.length > 0) {
      const taskId = Number(candidateFlows[0].taskId);
      await db.update(recognitionTasks).set({ ruleId, updatedAt: new Date() }).where(eq(recognitionTasks.id, taskId));
      return taskId;
    }
    if (candidateFlows.length === 1) {
      const taskId = Number(candidateFlows[0].taskId);
      await db.update(recognitionTasks).set({ ruleId, updatedAt: new Date() }).where(eq(recognitionTasks.id, taskId));
      return taskId;
    }
  }

  const reusableDetailTask = dateTasks.find((task: any) => Number(task.bankFlowCount || 0) === 0);
  if (reusableDetailTask) {
    const taskId = Number(reusableDetailTask.id);
    await db.update(recognitionTasks).set({ ruleId, updatedAt: new Date() }).where(eq(recognitionTasks.id, taskId));
    return taskId;
  }

  const taskResult = await db.insert(recognitionTasks).values({
    ruleId,
    billDate: targetDate,
    creatorId,
    status: "pending_details",
    bankFlowTotal: "0.00",
    bankFlowCount: 0,
  }).$returningId();
  const taskId = Number(taskResult[0]?.id);
  if (!taskId) throw new Error("创建转移目标数据包失败");
  return taskId;
}

async function transferBillDetailToDate(
  detailId: number,
  targetDateInput: string,
  creatorId: number,
  database: any = getDb(),
) {
  const db = database;
  const [detail] = await db
    .select({
      id: billDetails.id,
      taskId: billDetails.taskId,
      ruleId: billDetails.ruleId,
      orderFileRuleId: orderFiles.ruleId,
      orderFileId: billDetails.orderFileId,
      detailPackageType: orderFiles.detailPackageType,
      matchResultId: billDetails.matchResultId,
      partitionDate: billDetails.partitionDate,
    })
    .from(billDetails)
    .leftJoin(orderFiles, eq(billDetails.orderFileId, orderFiles.id))
    .where(eq(billDetails.id, detailId));
  if (!detail) throw new Error("订单明细不存在");
  if (detail.matchResultId) throw new Error("已认账明细不能转移");
  if (detail.detailPackageType === "打包明细") throw new Error("打包明细不支持转移，只能转移 T+1 订单");

  const [sourceTask] = await db.select().from(recognitionTasks).where(eq(recognitionTasks.id, Number(detail.taskId)));
  if (!sourceTask) throw new Error("原数据包不存在");

  const targetDate = normalizeDate(targetDateInput);
  if (!targetDate) throw new Error("请选择有效日期");
  if (targetDate === sourceTask.billDate) throw new Error("目标日期不能与当前数据包日期相同");

  const ruleId = Number(detail.ruleId || detail.orderFileRuleId || sourceTask.ruleId || 0);
  if (!ruleId) throw new Error("该明细缺少明细认账规则，无法转移");

  const sourceTaskId = Number(detail.taskId);
  const targetTaskId = await resolveTransferTargetTask(targetDate, ruleId, creatorId, db);
  await db.update(billDetails).set({
    taskId: targetTaskId,
    partitionDate: targetDate,
    operationStatus: "transferred",
    originalTaskId: sourceTaskId,
    originalRecognitionDate: detail.partitionDate || sourceTask.billDate,
    lifecycleStatus: "normal",
    ignoreReason: `由 ${sourceTask.billDate} 转移至 ${targetDate}`,
  }).where(eq(billDetails.id, detailId));
  await moveOrderFilePartitionDetail(db, {
    orderFileId: Number(detail.orderFileId || 0),
    detailId,
    fromPartitionDate: detail.partitionDate,
    toPartitionDate: targetDate,
  });
  await syncManualOrderWorkItemsByDetailIds(db, [detailId]);

  return { sourceTaskId, targetTaskId, targetDate };
}

async function bindAggregateDetailCandidateTasks(tasks: Array<{ id: number; billDate: string; ruleId?: number | null }>) {
  const db = getDb();
  const boundTaskIds = new Set<number>();
  const detailRuleIds = Array.from(new Set(tasks.map((task) => Number(task.ruleId || 0)).filter((ruleId) => ruleId > 0)));

  for (const ruleId of detailRuleIds) {
    const rule = await db.query.recognitionRules.findFirst({ where: eq(recognitionRules.id, ruleId) });
    if (!rule?.matchedCounterpartyAlias) continue;

    const [counterpartyRow] = await db.select().from(counterpartyRecords)
      .where(eq(counterpartyRecords.alias, rule.matchedCounterpartyAlias));
    const counterparty = await attachCounterpartyMatchers(db, counterpartyRow);
    if (!counterparty || !isSameDayAggregateDetailCounterparty(counterparty)) continue;

    for (const billDate of Array.from(new Set(tasks.map((task) => task.billDate)))) {
      const dateTasks = tasks.filter((task) => task.billDate === billDate);
      const dateTaskIds = dateTasks.map((task) => Number(task.id));
      if (dateTaskIds.length === 0) continue;

      const dateFlows = await db.select().from(bankFlows).where(and(
        inArray(bankFlows.taskId, dateTaskIds),
        eq(bankFlows.arrivalMatchStatus, "matched"),
        eq(bankFlows.matchedCounterpartyId, Number(counterparty.id)),
      ));
      const candidateTaskIds = Array.from(new Set(dateFlows
        .filter((flow) => isBankFlowRecognitionEligible(flow.income))
        .map((flow) => Number(flow.taskId))
        .filter(Boolean)));
      if (candidateTaskIds.length === 0) continue;
      const [creatorTask] = await db.select({ creatorId: recognitionTasks.creatorId })
        .from(recognitionTasks)
        .where(eq(recognitionTasks.id, candidateTaskIds[0]));
      const resolved = await ensureSameDayAggregateTask({
        billDate,
        counterparty,
        creatorId: Number(creatorTask?.creatorId || 0),
        ruleId,
        preferredTaskId: candidateTaskIds[0],
      });
      boundTaskIds.add(resolved.taskId);
    }
  }

  return Array.from(boundTaskIds);
}

export const taskRouter = createRouter({
  list: authedQuery
    .input(
      z.object({
        status: z.string().optional(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(50).default(20),
      }).optional(),
    )
    .query(async ({ input }) => {
      const page = input?.page || 1;
      const pageSize = input?.pageSize || 20;
      const status = normalizeSummaryStatusFilter(input?.status);
      const [items, total] = await Promise.all([
        listRecognitionDateSummaries({ status, page, pageSize }),
        countRecognitionDateSummaries(status),
      ]);
      return {
        items: items.map((item) => ({
          ...item,
          id: item.primaryTaskId,
        })),
        total,
        page,
        pageSize,
      };
    }),

  getById: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const task = await db.query.recognitionTasks.findFirst({
        where: eq(recognitionTasks.id, input.id),
      });
      if (!task) throw new Error("任务不存在");
      const taskIds = await getTaskIdsForBillDate(task.billDate);
      const summary = await getRecognitionDateSummaryByBillDate(task.billDate);
      return {
        ...task,
        taskIds,
        status: summary?.status ?? deriveTaskStatus(task.status, undefined),
        bankFlowTotal: summary?.bankFlowTotal ?? task.bankFlowTotal ?? "0.00",
        bankFlowIncomeTotal: summary?.bankFlowIncomeTotal ?? "0.00",
        bankFlowCount: summary?.bankFlowCount ?? task.bankFlowCount ?? 0,
        recognizedBankFlowCount: Number(summary?.recognizedBankFlowCount ?? 0),
        billDetailTotal: summary?.billDetailTotal ?? task.billDetailTotal ?? "0.00",
        billDetailCount: summary?.billDetailCount ?? task.billDetailCount ?? 0,
        diffAmount: summary?.diffAmount ?? task.diffAmount ?? "0.00",
        matchedCount: summary?.matchedCount ?? task.matchedCount ?? 0,
        unmatchedCount: summary?.unmatchedCount ?? task.unmatchedCount ?? 0,
        recognizedAmount: summary?.recognizedAmount ?? "0.00",
        pendingSplitCount: summary?.pendingSplitCount ?? task.pendingSplitCount ?? 0,
        varianceRuleName: summary?.varianceRuleName ?? "",
        completedAt: summary?.completedAt ?? task.completedAt,
        updatedAt: summary?.updatedAt ?? task.updatedAt,
      };
    }),

  uploadBankFlowsAndCreateTasks: authedQuery
    .input(z.object({
      flows: z.array(z.object({
        bankName: z.enum(["广发银行", "工商银行", "中国银行"]).optional(),
        bankAccountNo: z.string().max(100).optional(),
        referenceNo: z.string(),
        transactionTime: z.string(),
        income: z.string(),
        counterpartyAccount: z.string().optional(),
        counterpartyName: z.string().optional(),
        counterpartyBank: z.string().optional(),
        branch: z.string().optional(),
        summary: z.string().optional(),
        purpose: z.string().optional(),
        postScript: z.string().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const flows = filterIngestibleBankFlows(input.flows);
      if (flows.length === 0) return { createdTasks: 0, insertedFlows: 0, duplicateExistingFlows: 0, ignoredFlows: [], ambiguousFlows: [] };

      const defaultAccountRows = await db.select({
        id: bankAccounts.id,
        bankName: bankAccounts.bankName,
      }).from(bankAccounts)
        .where(eq(bankAccounts.isDefault, true))
        .orderBy(asc(bankAccounts.id));
      const defaultAccountIdByBank = new Map<string, number>();
      for (const account of defaultAccountRows) {
        if (!defaultAccountIdByBank.has(account.bankName)) {
          defaultAccountIdByBank.set(account.bankName, Number(account.id));
        }
      }

      const parsedAccountIdByKey = new Map<string, number>();
      for (const flow of flows) {
        const bankName = (flow.bankName || "广发银行") as SupportedBankName;
        const accountNo = normalizeUploadedBankAccountNo(flow.bankAccountNo);
        if (!accountNo) continue;
        const accountKey = `${bankName}\u0000${accountNo}`;
        if (parsedAccountIdByKey.has(accountKey)) continue;
        const accountId = await resolveUploadedBankAccountId(db, bankName, accountNo);
        if (!accountId) continue;
        parsedAccountIdByKey.set(accountKey, accountId);
        if (!defaultAccountIdByBank.has(bankName)) defaultAccountIdByBank.set(bankName, accountId);
      }

      const getFlowBankAccountId = (flow: (typeof flows)[number]) => {
        const bankName = (flow.bankName || "广发银行") as SupportedBankName;
        const accountNo = normalizeUploadedBankAccountNo(flow.bankAccountNo);
        if (accountNo) return parsedAccountIdByKey.get(`${bankName}\u0000${accountNo}`) || null;
        return defaultAccountIdByBank.get(bankName) || null;
      };

      const dateGroups = new Map<string, typeof flows>();
      for (const f of flows) {
        const dateKey = normalizeDate(f.transactionTime);
        if (!dateGroups.has(dateKey)) dateGroups.set(dateKey, []);
        dateGroups.get(dateKey)!.push(f);
      }

      let createdTasks = 0;
      let insertedFlows = 0;
      let duplicateExistingFlows = 0;
      const insertedBankFlowIds: number[] = [];
      const insertedTaskIds = new Set<number>();
      const uploadedIncomeRecognitionCandidates: UploadedIncomeRecognitionCandidate[] = [];
      const sameDayTaskIdsToRecognize = new Set<number>();
      const counterparties = await loadBankFlowCounterparties(db);
      const ignoredFlows: Array<{ date: string; referenceNo: string; amount: string }> = [];
      const ambiguousFlows: Array<{ date: string; referenceNo: string; aliases: string[] }> = [];

      for (const [billDate, dayFlows] of dateGroups) {
        const dateTaskIds = await getTaskIdsForBillDate(billDate);
        const existingRefs = dateTaskIds.length > 0
          ? await db.select({ id: bankFlows.id, ref: bankFlows.referenceNo, bankAccountId: bankFlows.bankAccountId })
            .from(bankFlows)
            .where(inArray(bankFlows.taskId, dateTaskIds))
          : [];
        const existingSet = new Set(existingRefs.map((r) => r.ref));
        const existingByRef = new Map(existingRefs.map((row) => [row.ref, row]));
        const newFlows = dayFlows.filter((f) => !existingSet.has(f.referenceNo));
        duplicateExistingFlows += dayFlows.length - newFlows.length;
        for (const f of dayFlows) {
          if (existingSet.has(f.referenceNo)) {
            const existingFlow = existingByRef.get(f.referenceNo);
            const bankAccountId = getFlowBankAccountId(f);
            if (existingFlow && !existingFlow.bankAccountId && bankAccountId) {
              await db.update(bankFlows).set({ bankAccountId })
                .where(and(eq(bankFlows.id, Number(existingFlow.id)), isNull(bankFlows.bankAccountId)));
              existingFlow.bankAccountId = bankAccountId;
            }
            ignoredFlows.push({
              date: billDate || normalizeDate(f.transactionTime) || f.transactionTime || "",
              referenceNo: f.referenceNo,
              amount: f.income,
            });
          }
        }
        if (newFlows.length === 0) continue;

        const reusableTasks = dateTaskIds.length > 0
          ? (await db.select({
            id: recognitionTasks.id,
            bankFlowCount: recognitionTasks.bankFlowCount,
            hasDetailFile: recognitionTasks.hasDetailFile,
            sameDayCounterpartyId: recognitionTasks.sameDayCounterpartyId,
          }).from(recognitionTasks).where(inArray(recognitionTasks.id, dateTaskIds)))
            .filter((task) => Number(task.bankFlowCount || 0) === 0 && task.hasDetailFile && !task.sameDayCounterpartyId)
          : [];

        for (const f of newFlows) {
          const counterpartyResolution = toCents(f.income) > 0
            ? resolveBankFlowCounterparty({
              ...f,
              bankName: f.bankName || "广发银行",
            }, counterparties)
            : null;
          const matchedCounterparty = counterpartyResolution?.kind === "matched"
            ? counterpartyResolution.counterparty
            : null;
          const sameDayCounterparty = matchedCounterparty?.recognitionType === "明细认账"
            && matchedCounterparty.detailMatchingMode === "同日汇总匹配"
            ? matchedCounterparty
            : null;
          if (counterpartyResolution?.kind === "ambiguous") {
            ambiguousFlows.push({
              date: billDate,
              referenceNo: f.referenceNo,
              aliases: counterpartyResolution.aliases,
            });
          }
          let taskId = 0;
          if (sameDayCounterparty) {
            const resolved = await ensureSameDayAggregateTask({
              billDate,
              counterparty: sameDayCounterparty,
              creatorId: ctx.user.id,
            });
            taskId = resolved.taskId;
            if (resolved.created) createdTasks++;
          } else {
            const reusableTask = toCents(f.income) > 0 ? reusableTasks.shift() : undefined;
            taskId = Number(reusableTask?.id || 0);
            if (taskId) {
              await db.update(recognitionTasks).set({
                bankFlowTotal: f.income,
                bankFlowCount: 1,
                status: "pending_details",
                updatedAt: new Date(),
              }).where(eq(recognitionTasks.id, taskId));
            } else {
              const taskResult = await db.insert(recognitionTasks).values({
                ruleId: 0,
                billDate,
                creatorId: ctx.user.id,
                status: "pending_details",
                bankFlowTotal: f.income,
                bankFlowCount: 1,
              }).$returningId();
              taskId = Number(taskResult[0]?.id);
              if (!taskId) throw new Error("创建流水认账任务失败");
              createdTasks++;
            }
          }

          const insertedFlow = await db.insert(bankFlows).values({
            taskId,
            bankName: f.bankName || "广发银行",
            bankAccountId: getFlowBankAccountId(f),
            matchedCounterpartyId: matchedCounterparty ? Number(matchedCounterparty.id) : null,
            arrivalMatchStatus: matchedCounterparty ? "matched" : "unmatched",
            referenceNo: f.referenceNo,
            transactionTime: f.transactionTime,
            income: f.income,
            counterpartyAccount: f.counterpartyAccount || null,
            counterpartyName: f.counterpartyName || null,
            counterpartyBank: f.counterpartyBank || null,
            branch: f.branch || null,
            summary: f.summary || null,
            purpose: f.purpose || null,
            postScript: f.postScript || null,
          }).$returningId();
          const insertedFlowId = Number(insertedFlow[0]?.id || 0);
          if (insertedFlowId) {
            insertedBankFlowIds.push(insertedFlowId);
            insertedTaskIds.add(taskId);
            if (matchedCounterparty?.recognitionType === "到账认账") {
              uploadedIncomeRecognitionCandidates.push({
                flowId: insertedFlowId,
                taskId,
                billDate,
                matchedCounterpartyId: Number(matchedCounterparty.id),
                matchedCounterpartyAlias: String(matchedCounterparty.alias),
                arrivalRegion: matchedCounterparty.arrivalRegion || null,
              });
            }
          }
          insertedFlows++;
          if (sameDayCounterparty) {
            await db.update(recognitionTasks).set({
              bankFlowTotal: sql`COALESCE(${recognitionTasks.bankFlowTotal}, 0) + ${f.income}`,
              bankFlowCount: sql`COALESCE(${recognitionTasks.bankFlowCount}, 0) + 1`,
              status: "pending_details",
              completedAt: null,
              updatedAt: new Date(),
            }).where(eq(recognitionTasks.id, taskId));
            sameDayTaskIdsToRecognize.add(taskId);
          }

          // 仅唯一匹配失败的流水进入未记录到账信息；歧义匹配保留给人工处理。
          try {
            const accountNo = f.counterpartyAccount;
            const flowBankName = f.bankName || "广发银行";
            if (accountNo && counterpartyResolution?.kind === "unmatched") {
              const existing = await db.select().from(unrecordedCounterparties).where(and(
                sql`${unrecordedCounterparties.bankName} <=> ${flowBankName}`,
                eq(unrecordedCounterparties.accountNo, accountNo),
                eq(unrecordedCounterparties.accountName, f.counterpartyName || ''),
                eq(unrecordedCounterparties.summary, f.summary || ''),
                eq(unrecordedCounterparties.purpose, f.purpose || ''),
                eq(unrecordedCounterparties.postScript, f.postScript || ''),
              ));
              if (existing.length > 0) {
                await db.update(unrecordedCounterparties).set({
                  occurrenceCount: existing[0].occurrenceCount + 1,
                  lastSeenAt: new Date(),
                }).where(eq(unrecordedCounterparties.id, existing[0].id));
              } else {
                await db.insert(unrecordedCounterparties).values({
                  bankName: flowBankName,
                  accountNo,
                  accountName: f.counterpartyName || '',
                  summary: f.summary || '',
                  purpose: f.purpose || '',
                  postScript: f.postScript || '',
                  occurrenceCount: 1,
                });
              }
            }
          } catch (e: any) {
            console.error(`[autoUnrecorded] task ${taskId} failed:`, e.message);
          }

        }
      }

      // 新增流水已经完成滤重、到账信息固化和入库；到账认账规则只读取一次，按 100 条批量生成结果。
      const uploadedIncomeRecognitionResult = await executeUploadedIncomeRecognition(uploadedIncomeRecognitionCandidates);
      if (uploadedIncomeRecognitionResult.errorMessage) {
        console.error(
          `[autoIncomeRec] 上传批量到账认账失败，未完成 ${uploadedIncomeRecognitionResult.failedFlowCount} 条:`,
          uploadedIncomeRecognitionResult.errorMessage,
        );
      }
      for (const taskId of uploadedIncomeRecognitionResult.affectedTaskIds) {
        await refreshTaskStatusByFlows(taskId, { refreshDateSummary: false });
      }
      await refreshRecognitionDateSummariesByTaskIds(Array.from(insertedTaskIds));

      for (const taskId of sameDayTaskIdsToRecognize) {
        const [fileSummary] = await db.select({ count: count() })
          .from(orderFiles)
          .where(and(
            eq(orderFiles.taskId, taskId),
            sql`COALESCE(${orderFiles.uploadStatus}, 'completed') <> 'abnormal'`,
          ));
        if (Number(fileSummary?.count || 0) === 0) continue;
        await db.update(recognitionTasks).set({
          status: "processing",
          completedAt: null,
          updatedAt: new Date(),
        }).where(eq(recognitionTasks.id, taskId));
        void enqueueRecognition(taskId, { refreshUnmatchedMatches: true }).catch((err) => {
          console.error(`[same-day-bank-flow] 同日汇总任务 ${taskId} 自动认账失败:`, err);
        });
      }
      await retryPendingMultiDayGroupsForFlowIds(insertedBankFlowIds);
      return {
        createdTasks,
        insertedFlows,
        duplicateExistingFlows,
        ignoredFlows,
        ambiguousFlows,
        incomeMatchedCount: uploadedIncomeRecognitionResult.matchedCount,
        incomePendingAmountCount: uploadedIncomeRecognitionResult.pendingAmountCount,
        incomeNoRuleCount: uploadedIncomeRecognitionResult.noRuleCount,
        incomeSkippedCount: uploadedIncomeRecognitionResult.skippedCount,
        incomeRecognitionFailedCount: uploadedIncomeRecognitionResult.failedFlowCount,
      };
    }),

  uploadOrderFile: authedQuery
    .input(z.object({
      fileName: z.string(),
      ruleId: z.number().min(1, "请选择认账规则"),
      headers: z.array(z.string()),
      details: z.array(z.record(z.string(), z.string())),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const headers = input.headers.map(cleanCSVCell).filter(Boolean);
      let details = input.details.map(cleanCSVRow).filter((row) =>
        Object.values(row).some((value) => cleanCSVCell(value) !== "") && !isClearlyNonOrderRow(row)
      );
      if (details.length === 0 || headers.length === 0) throw new Error("明细识别失败，请检查文件");

      const ruleData = await db.query.recognitionRules.findFirst({
        where: eq(recognitionRules.id, input.ruleId),
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

      const dateField = ruleData.dateField || "时间";
      const incomeField = ruleData.incomeField || "金额";
      const orderNoField = ruleData.orderNoField || "订单号";
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
      const requiredUploadFields = [
        dateField,
        incomeField,
        orderNoField,
        ...getConfiguredInvoiceOrderNoFields(ruleData),
        ...excludeOrderConditions.map((condition) => condition.field || null),
        ruleData.refundOrderEnabled ? ruleData.refundJudgeField : null,
        ruleData.refundOrderEnabled ? ruleData.refundAmountField : null,
        ruleData.detailSplitEnabled ? ruleData.multiSplitKeywordField : null,
      ].filter((field): field is string => Boolean(field));
      const keywordField = ruleData.items[0]?.keywordField || "商品名称";
      validateRequiredUploadColumns(headers, requiredUploadFields);
      const refundConfig = {
        enabled: ruleData.refundOrderEnabled,
        judgeField: ruleData.refundJudgeField,
        judgeValue: ruleData.refundJudgeValue,
        directionJudgeValue: ruleData.refundDirectionJudgeValue,
        incomeField,
        amountField: ruleData.refundAmountField,
      };
      const classifyRefundOrder = createRefundOrderClassifier(refundConfig);
      const refundClassificationByRow = new WeakMap<Record<string, string>, ReturnType<typeof classifyRefundOrder>>();
      const classifyRefundOrderRow = (row: Record<string, string>) => {
        const cached = refundClassificationByRow.get(row);
        if (cached) return cached;
        const classification = classifyRefundOrder((field) => getRowValue(row, field));
        refundClassificationByRow.set(row, classification);
        return classification;
      };
      const isRefundOrderRow = (row: Record<string, string>) => classifyRefundOrderRow(row).kind === "refund";

      details = details.filter((detail) => !isExcludeOrderRow(detail, excludeOrderConditions));
      if (details.length === 0) return { success: true, count: 0, affectedTasks: 0 };

      for (let index = 0; index < details.length; index += 1) {
        const d = details[index];
        const refundClassification = classifyRefundOrderRow(d);
        if (refundClassification.kind === "invalid") {
          throw new Error(`订单明细第 ${index + 1} 条${refundClassification.reason || "退款及收支方向判断异常"}，上传失败。`);
        }
        const orderNo = getRowValue(d, orderNoField).trim();
        if (!orderNo) {
          throw new Error(`订单明细第 ${index + 1} 条未找到订单号，上传失败。`);
        }
      }

      const dateGroups = new Map<string, typeof details>();
      for (let index = 0; index < details.length; index += 1) {
        const d = details[index];
        const rawDate = getRowValue(d, dateField);
        const orderDate = normalizeDate(rawDate);
        if (!isNormalizedDate(orderDate)) {
          throw new Error(`订单明细第 ${index + 1} 条无法解析账单日期，上传失败。`);
        }
        const packageDate = addDays(orderDate, 1);
        if (!isNormalizedDate(packageDate)) {
          throw new Error(`订单明细第 ${index + 1} 条账单日期“${rawDate}”格式异常，上传失败。`);
        }
        if (!dateGroups.has(packageDate)) dateGroups.set(packageDate, []);
        dateGroups.get(packageDate)!.push(d);
      }

      if (dateGroups.size === 0) throw new Error("明细识别失败，请检查文件");

      const today = getTodayInShanghai();
      const archiveLockDates = Array.from(dateGroups.keys())
        .filter((date) => isBillDetailArchiveEligibleDate(date, today));

      return withBillDetailArchiveDateLocks(archiveLockDates, async () => {
        let totalInserted = 0;
        const affectedTasks: number[] = [];

        for (const [packageDate, dayDetails] of dateGroups) {
        const getOrderDate = (d: Record<string, string>) =>
          normalizeDate(String(d[dateField] || ""));
        const orderDate = getOrderDate(dayDetails[0]);
        const archivedPackageExists = await hasArchivedOrderPackage(db, {
          partitionDate: packageDate,
          packageBillDate: orderDate,
          detailPackageType: "T+1",
          ruleId: input.ruleId,
        });
        if (archivedPackageExists) continue;
        const dayDetailIndexByRow = new Map(dayDetails.map((d, index) => [d, index]));
        const getStorageBillNo = (d: Record<string, string>) => {
          const orderNo = getRowValue(d, orderNoField).trim();
          const rowIndex = (dayDetailIndexByRow.get(d) ?? 0) + 1;
          return isRefundOrderRow(d) && orderNo ? `${orderNo}__退款__${rowIndex}` : orderNo;
        };
        const orderNos = Array.from(new Set(
          dayDetails.map((d) => getStorageBillNo(d)).filter(Boolean)
        ));
        // Intentionally omit partition_date: transferred details must still block
        // a duplicate upload. bd_rule_bill_date_bill_no_partition_uq accelerates
        // this cross-partition lookup without changing the historical rule/date/order key.
        const existingOrders = orderNos.length > 0
          ? await db
            .select({ billNo: billDetails.billNo })
            .from(billDetails)
            .where(and(
              eq(billDetails.billDate, orderDate),
              eq(billDetails.ruleId, input.ruleId),
              inArray(billDetails.billNo, orderNos),
            ))
          : [];
        const existingOrderKeys = new Set(existingOrders.map((item) => `${orderDate}|${item.billNo}`));
        const acceptedOrderKeys = new Set<string>();
        const newDetails = dayDetails.filter((d) => {
          const orderNo = getStorageBillNo(d);
          const detailOrderDate = getOrderDate(d);
          const orderKey = `${detailOrderDate}|${orderNo}`;
          if (existingOrderKeys.has(orderKey) || acceptedOrderKeys.has(orderKey)) return false;
          acceptedOrderKeys.add(orderKey);
          return true;
        });

        if (newDetails.length === 0) continue;

        const dateTaskIds = await getTaskIdsForBillDate(packageDate);
        if (dateTaskIds.length === 0) {
          throw new Error(`${packageDate} 没有对应银行流水，请先添加银行到账`);
        }

        const dateFlows = await db.select().from(bankFlows).where(and(
          inArray(bankFlows.taskId, dateTaskIds),
          eq(bankFlows.arrivalMatchStatus, "matched"),
          eq(bankFlows.matchedCounterpartyId, Number(counterparty.id)),
        ));
        const candidateFlows = dateFlows;
        if (candidateFlows.length === 0) {
          throw new Error(`${packageDate} 没有匹配该明细认账规则到账信息的银行流水`);
        }

        const dayTotal = newDetails.reduce((sum, d) => {
          const isRefundOrder = isRefundOrderRow(d);
          const amountVal = isRefundOrder
            ? normalizeRefundUploadAmount(getRowValue(d, ruleData.refundAmountField || ""))
            : normalizeUploadAmount(getRowValue(d, incomeField));
          if (!amountVal) {
            const orderNo = getRowValue(d, orderNoField);
            throw new Error(`订单明细 ${orderDate} / ${orderNo || "未知订单号"} 未找到收入金额，上传失败。`);
          }
          return sum + Number(amountVal || 0);
        }, 0);
        const sameDayResolvedTask = isSameDayAggregateDetailCounterparty(counterparty)
          ? await ensureSameDayAggregateTask({
            billDate: packageDate,
            counterparty,
            creatorId: ctx.user.id,
            ruleId: input.ruleId,
            preferredTaskId: Number(candidateFlows[0]?.taskId || 0),
          })
          : null;
        const targetFlow = sameDayResolvedTask
          ? candidateFlows[0]
          : (() => {
            const exactCandidates = candidateFlows.filter((flow) => toCents(flow.income || 0) === toCents(dayTotal));
            return exactCandidates.length === 1
              ? exactCandidates[0]
              : candidateFlows.length === 1
                ? candidateFlows[0]
                : null;
          })();
        if (!targetFlow) {
          throw new Error(`${packageDate} 存在多条可能匹配的银行流水，无法自动确定订单明细归属`);
        }
        const taskId = sameDayResolvedTask?.taskId || Number(targetFlow.taskId);

        const recognitionTaskIds = [taskId];
        await db.update(recognitionTasks).set({
          ruleId: input.ruleId,
          updatedAt: new Date(),
        }).where(inArray(recognitionTasks.id, recognitionTaskIds));

        const fileResult = await db.insert(orderFiles).values({
          taskId, fileName: input.fileName,
          ruleId: input.ruleId,
          matchedAccountName: primaryCounterpartyMatcher.accountName || primaryCounterpartyMatcher.accountNo,
          incomePurpose: primaryCounterpartyMatcher.purpose || null,
          incomePostScript: primaryCounterpartyMatcher.postScript || null,
          rawColumns: headers.join(","),
          invoiceOrderNoFieldSnapshot,
          entryCount: newDetails.length,
          uploaderId: ctx.user.id,
        }).$returningId();
        const orderFileId = Number(fileResult[0]?.id);
        if (!orderFileId) throw new Error("创建订单文件记录失败");

        const ruleItemMatcher = createDetailRuleItemMatcher(
          ruleData.items,
          (row: Record<string, string>, keywordField) => row[keywordField],
          {
            conditionRecognitionEnabled: ruleData.conditionRecognitionEnabled,
            enabled: ruleData.detailSplitEnabled,
            keywordField: ruleData.multiSplitKeywordField,
            keyword: ruleData.multiSplitKeyword,
          },
        );
        const chunkSize = 10000;
        for (let i = 0; i < newDetails.length; i += chunkSize) {
          const chunk = newDetails.slice(i, i + chunkSize);
          await db.insert(billDetails).ignore().values(chunk.map((d) => {
            const isRefundOrder = isRefundOrderRow(d);
            const amountVal = isRefundOrder
              ? normalizeRefundUploadAmount(getRowValue(d, ruleData.refundAmountField || ""))
              : normalizeUploadAmount(getRowValue(d, incomeField));
            const directlyMarkUnmatched = classifyRefundOrderRow(d).kind === "unmatched"
              || shouldDirectlyMarkOrderUnmatched(isRefundOrder, getRowValue(d, incomeField));
            const rowMatch = directlyMarkUnmatched ? null : ruleItemMatcher(d);
            const ruleItem = rowMatch?.item || null;
            const descVal = ruleData.conditionRecognitionEnabled === false
              ? getRowValue(d, "商品名称", ["商品信息", "备注", "认账关键字", "商品", "项目名称"])
              : String(d[ruleItem?.keywordField || keywordField] || "");
            const orderDateValue = getOrderDate(d);
            return {
              taskId, ruleId: input.ruleId, orderFileId, billDate: orderDateValue,
              partitionDate: packageDate,
              lifecycleStatus: "normal" as any,
              billNo: getStorageBillNo(d),
              invoiceOtherOrderNo1: readConfiguredInvoiceOrderNoValue(d, ruleData.invoiceOtherOrderNo1Field),
              invoiceOtherOrderNo2: readConfiguredInvoiceOrderNoValue(d, ruleData.invoiceOtherOrderNo2Field),
              description: descVal,
              totalAmount: amountVal,
              refundAmountSnapshot: isRefundOrder ? normalizeRefundUploadAmountSnapshot(getRowValue(d, ruleData.refundAmountField || "")) : "0.00",
              rawData: d as any,
              matchStatus: rowMatch?.status as any || "unmatched" as const,
              ruleItemId: rowMatch?.status === "matched" ? ruleItem?.id || null : null,
            };
          }));
        }
        await syncOrderFilePartitionsByOrderFileId(db, orderFileId);

        await refreshTaskDetailSummary(taskId);

        const fileCountResult = await db.select({ cnt: count() }).from(billDetails).where(eq(billDetails.orderFileId, orderFileId));
        const insertedCount = Number(fileCountResult[0]?.cnt || 0);
        const fileTotalResult = await db.select({
          total: sql<string>`COALESCE(SUM(CASE WHEN CAST(${billDetails.refundAmountSnapshot} AS DECIMAL(18,2)) > 0 THEN 0 ELSE CAST(${billDetails.totalAmount} AS DECIMAL(18,2)) END), 0.00)`,
          refundAmount: sql<string>`COALESCE(SUM(CAST(${billDetails.refundAmountSnapshot} AS DECIMAL(18,2))), 0.00)`,
          activityAmount: sql<string>`COALESCE(SUM(ABS(CAST(${billDetails.totalAmount} AS DECIMAL(18,2)))), 0.00)`,
        }).from(billDetails).where(eq(billDetails.orderFileId, orderFileId));
        const fileTotal = Number(fileTotalResult[0]?.total || 0);
        const fileRefundAmount = Number(fileTotalResult[0]?.refundAmount || 0);
        const fileActivityAmount = Number(fileTotalResult[0]?.activityAmount || 0);
        const isAbnormal = insertedCount > 0 && isZeroOrderTotal(fileActivityAmount);
        const fileMatchSummary = await db.select({
          matchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'matched' THEN 1 ELSE 0 END)`,
          unmatchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'unmatched' THEN 1 ELSE 0 END)`,
          pendingSplitCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'pending_split' THEN 1 ELSE 0 END)`,
        }).from(billDetails).where(eq(billDetails.orderFileId, orderFileId));
        await db.update(orderFiles).set({
          uploadStatus: isAbnormal ? "abnormal" : "completed",
          entryCount: insertedCount,
          processedCount: insertedCount,
          orderTotalAmount: fileTotal.toFixed(2),
          refundAmount: fileRefundAmount.toFixed(2),
          matchedCount: Number(fileMatchSummary[0]?.matchedCount || 0),
          unmatchedCount: Number(fileMatchSummary[0]?.unmatchedCount || 0),
          pendingSplitCount: Number(fileMatchSummary[0]?.pendingSplitCount || 0),
          failedReason: isAbnormal ? "订单总金额为0，已标记异常，不参与认账" : null,
        }).where(eq(orderFiles.id, orderFileId));
        totalInserted += insertedCount;
        if (insertedCount > 0 && !isAbnormal) affectedTasks.push(...recognitionTaskIds);
      }

        for (const taskId of Array.from(new Set(affectedTasks))) {
          await db.update(recognitionTasks).set({
            status: "processing",
            completedAt: null,
            updatedAt: new Date(),
          }).where(eq(recognitionTasks.id, taskId));
          await refreshRecognitionDateSummariesByTaskIds([taskId]);
          await enqueueRecognition(taskId);
        }

        return { success: true, count: totalInserted, affectedTasks: affectedTasks.length };
      });
    }),

  deleteOrderFile: authedQuery
    .input(z.object({ orderFileId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "order_detail_package_delete"))) throw new Error("权限不足");
      const db = getDb();
      const file = await db.query.orderFiles.findFirst({
        where: eq(orderFiles.id, input.orderFileId),
      });
      if (!file) throw new Error("订单文件不存在");
      const taskId = file.taskId;
      await assertNoCreatedVoucherForTaskIds([taskId], "该条订单明细已有入账锁定记录，无法删除。");

      // 删除该任务下所有入账结果（订单明细变了，入账结果必然失效）
      await db.delete(matchResults).where(eq(matchResults.taskId, taskId));

      // 重置所有明细的匹配状态
      await db.update(billDetails).set({
        matchStatus: "unmatched", matchResultId: sql`NULL`, ruleItemId: null, ignoreReason: null,
      }).where(eq(billDetails.taskId, taskId));
      await syncManualOrderWorkItemsByTaskIds(db, [taskId]);

      await deleteManualOrderWorkItemsByOrderFileIds(db, [input.orderFileId]);
      await db.delete(billDetails).where(and(eq(billDetails.orderFileId, input.orderFileId), eq(billDetails.taskId, taskId)));
      await db.delete(orderFiles).where(eq(orderFiles.id, input.orderFileId));

      await refreshTaskDetailSummary(taskId);
      await db.update(recognitionTasks).set({
        status: "pending_details", updatedAt: new Date(),
      }).where(eq(recognitionTasks.id, taskId));
      await refreshRecognitionDateSummariesByTaskIds([taskId]);

      return { success: true };
    }),

  execute: authedQuery
    .input(z.object({ taskId: z.number() }))
    .mutation(async ({ input }) => {
      const taskIds = await getDateTaskIdsByTaskId(input.taskId);
      if (taskIds.length === 0) throw new Error("任务不存在");

      const db = getDb();
      let tasks = await db
        .select({
          id: recognitionTasks.id,
          billDate: recognitionTasks.billDate,
          ruleId: recognitionTasks.ruleId,
        })
        .from(recognitionTasks)
        .where(inArray(recognitionTasks.id, taskIds));
      const boundAggregateTaskIds = await bindAggregateDetailCandidateTasks(tasks);
      if (boundAggregateTaskIds.length > 0) {
        tasks = await db
          .select({
            id: recognitionTasks.id,
            billDate: recognitionTasks.billDate,
            ruleId: recognitionTasks.ruleId,
            bankFlowCount: recognitionTasks.bankFlowCount,
            status: recognitionTasks.status,
          })
          .from(recognitionTasks)
          .where(inArray(recognitionTasks.id, taskIds));
      }
      const executableTaskIds: number[] = [];
      for (const task of tasks) {
        const detailCount = await getActiveDetailCountForTask(task);
        const [incomeFlowSummary] = await db.select({ count: count() })
          .from(bankFlows)
          .where(and(eq(bankFlows.taskId, Number(task.id)), gt(bankFlows.income, "0")));
        if (detailCount > 0 && Number(incomeFlowSummary?.count || 0) > 0) executableTaskIds.push(task.id);
      }

      // 加入队列前先置为处理中，前端轮询可立即看到“认账执行中”
      for (const taskId of executableTaskIds) {
        await db.update(recognitionTasks).set({
          status: "processing",
          completedAt: null,
          updatedAt: new Date(),
        }).where(eq(recognitionTasks.id, taskId));
        await refreshRecognitionDateSummariesByTaskIds([taskId]);
        await enqueueRecognition(taskId, { refreshUnmatchedMatches: true });
      }
      return {
        success: true,
        affectedTasks: executableTaskIds.length,
        message: executableTaskIds.length > 0
          ? `明细认账已加入队列，共 ${executableTaskIds.length} 个流水任务`
          : "没有可认账的有效订单明细",
      };
    }),

  startRecognition: authedQuery
    .input(z.object({ taskId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [selectedTask] = await db
        .select({ billDate: recognitionTasks.billDate })
        .from(recognitionTasks)
        .where(eq(recognitionTasks.id, input.taskId));
      if (!selectedTask?.billDate) throw new Error("任务不存在");
      await retryPendingMultiDayGroupsForBillDate(selectedTask.billDate);
      const taskIds = await getDateTaskIdsByTaskId(input.taskId);
      if (taskIds.length === 0) throw new Error("任务不存在");

      let tasks = await db
        .select({
          id: recognitionTasks.id,
          billDate: recognitionTasks.billDate,
          ruleId: recognitionTasks.ruleId,
          bankFlowCount: recognitionTasks.bankFlowCount,
          status: recognitionTasks.status,
        })
        .from(recognitionTasks)
        .where(inArray(recognitionTasks.id, taskIds));

      const flowRows = await db
        .select({
          taskId: bankFlows.taskId,
          allTotal: count(),
          total: sql<number>`SUM(CASE WHEN CAST(${bankFlows.income} AS DECIMAL(18,2)) > 0 THEN 1 ELSE 0 END)`,
          recognized: sql<number>`SUM(CASE WHEN CAST(${bankFlows.income} AS DECIMAL(18,2)) > 0 AND ${bankFlows.recognitionStatus} = 'recognized' THEN 1 ELSE 0 END)`,
          unrecognized: sql<number>`SUM(CASE WHEN CAST(${bankFlows.income} AS DECIMAL(18,2)) > 0 AND ${bankFlows.recognitionStatus} = 'unrecognized' THEN 1 ELSE 0 END)`,
          partialMatched: sql<number>`SUM(CASE WHEN CAST(${bankFlows.income} AS DECIMAL(18,2)) > 0 AND ${bankFlows.recognitionStatus} = 'partial_matched' THEN 1 ELSE 0 END)`,
          largeVariance: sql<number>`SUM(CASE WHEN CAST(${bankFlows.income} AS DECIMAL(18,2)) > 0 AND ${bankFlows.recognitionStatus} = 'large_variance' THEN 1 ELSE 0 END)`,
        })
        .from(bankFlows)
        .where(inArray(bankFlows.taskId, taskIds))
        .groupBy(bankFlows.taskId);
      let flowSummaryByTaskId = new Map(flowRows.map((row) => [Number(row.taskId), {
        allTotal: Number(row.allTotal || 0),
        total: Number(row.total || 0),
        recognized: Number(row.recognized || 0),
        unrecognized: Number(row.unrecognized || 0),
        partialMatched: Number(row.partialMatched || 0),
        largeVariance: Number(row.largeVariance || 0),
      }]));

      let skippedTaskCount = 0;
      const candidateTasks = tasks.filter((task) => {
        if (task.status === "processing") {
          skippedTaskCount += 1;
          return false;
        }
        const taskId = Number(task.id);
        const flowSummary = flowSummaryByTaskId.get(taskId);
        const totalFlowCount = flowSummary ? flowSummary.total : Number(task.bankFlowCount || 0);
        if (totalFlowCount <= 0) {
          skippedTaskCount += 1;
          return false;
        }
        if ((flowSummary?.recognized || 0) >= totalFlowCount) {
          skippedTaskCount += 1;
          return false;
        }
        return true;
      });
      if (candidateTasks.length === 0) {
        return {
          success: true,
          incomeTaskCount: 0,
          incomeMatchedCount: 0,
          detailTaskCount: 0,
          skippedTaskCount,
          message: skippedTaskCount > 0 ? `开始认账：跳过 ${skippedTaskCount} 个无需处理任务` : "没有需要认账的任务",
        };
      }

      const boundAggregateTaskIds = await bindAggregateDetailCandidateTasks(candidateTasks);
      if (boundAggregateTaskIds.length > 0) {
        const refreshedTaskIds = Array.from(new Set([
          ...candidateTasks.map((task) => Number(task.id)),
          ...boundAggregateTaskIds,
        ]));
        tasks = await db
          .select({
            id: recognitionTasks.id,
            billDate: recognitionTasks.billDate,
            ruleId: recognitionTasks.ruleId,
            bankFlowCount: recognitionTasks.bankFlowCount,
            status: recognitionTasks.status,
          })
          .from(recognitionTasks)
          .where(inArray(recognitionTasks.id, refreshedTaskIds));
        const refreshedFlowRows = await db
          .select({
            taskId: bankFlows.taskId,
            allTotal: count(),
            total: sql<number>`SUM(CASE WHEN CAST(${bankFlows.income} AS DECIMAL(18,2)) > 0 THEN 1 ELSE 0 END)`,
            recognized: sql<number>`SUM(CASE WHEN CAST(${bankFlows.income} AS DECIMAL(18,2)) > 0 AND ${bankFlows.recognitionStatus} = 'recognized' THEN 1 ELSE 0 END)`,
            unrecognized: sql<number>`SUM(CASE WHEN CAST(${bankFlows.income} AS DECIMAL(18,2)) > 0 AND ${bankFlows.recognitionStatus} = 'unrecognized' THEN 1 ELSE 0 END)`,
            partialMatched: sql<number>`SUM(CASE WHEN CAST(${bankFlows.income} AS DECIMAL(18,2)) > 0 AND ${bankFlows.recognitionStatus} = 'partial_matched' THEN 1 ELSE 0 END)`,
            largeVariance: sql<number>`SUM(CASE WHEN CAST(${bankFlows.income} AS DECIMAL(18,2)) > 0 AND ${bankFlows.recognitionStatus} = 'large_variance' THEN 1 ELSE 0 END)`,
          })
          .from(bankFlows)
          .where(inArray(bankFlows.taskId, refreshedTaskIds))
          .groupBy(bankFlows.taskId);
        flowSummaryByTaskId = new Map(refreshedFlowRows.map((row) => [Number(row.taskId), {
          allTotal: Number(row.allTotal || 0),
          total: Number(row.total || 0),
          recognized: Number(row.recognized || 0),
          unrecognized: Number(row.unrecognized || 0),
          partialMatched: Number(row.partialMatched || 0),
          largeVariance: Number(row.largeVariance || 0),
        }]));
      } else {
        tasks = candidateTasks;
      }

      let incomeMatchedCount = 0;
      let incomePendingAmountCount = 0;
      let incomeTaskCount = 0;
      let detailTaskCount = 0;
      const detailQueueTaskIds: number[] = [];
      const sameDayAggregateTaskIds = new Set(boundAggregateTaskIds.map(Number));

      for (const task of tasks) {
        const flowSummary = flowSummaryByTaskId.get(Number(task.id));
        const hasUnrecognizedFlow = Number(flowSummary?.unrecognized || 0) > 0;
        const hasPartialOrVarianceFlow = Number(flowSummary?.partialMatched || 0) > 0
          || Number(flowSummary?.largeVariance || 0) > 0
          || task.status === "partial_matched"
          || task.status === "large_variance";

        if (hasUnrecognizedFlow && !sameDayAggregateTaskIds.has(Number(task.id))) {
          const result = await executeIncomeRecognition(task.id);
          incomeMatchedCount += Number(result.matchedCount || 0);
          incomePendingAmountCount += Number(result.pendingAmountCount || 0);
          incomeTaskCount += 1;
        }

        const detailCount = await getActiveDetailCountForTask(task);
        if (detailCount > 0 && (hasUnrecognizedFlow || hasPartialOrVarianceFlow)) {
          detailQueueTaskIds.push(Number(task.id));
        } else if (!hasUnrecognizedFlow) {
          skippedTaskCount += 1;
        }
      }

      for (const taskId of detailQueueTaskIds) {
        await resetStaleAggregateDetailRecognitionForRerun(taskId);
        detailTaskCount += 1;
        await db.update(recognitionTasks).set({
          status: "processing",
          completedAt: null,
          updatedAt: new Date(),
        }).where(eq(recognitionTasks.id, taskId));
        await refreshRecognitionDateSummariesByTaskIds([taskId]);
        void enqueueRecognition(taskId, { refreshUnmatchedMatches: true }).catch((err) => {
          console.error(`[startRecognition] 明细认账队列任务 ${taskId} 执行失败:`, err);
        });
      }

      const parts = [];
      if (incomeTaskCount > 0) parts.push(`到账认账 ${incomeTaskCount} 个任务，匹配 ${incomeMatchedCount} 条流水`);
      if (incomePendingAmountCount > 0) parts.push(`待填写认账金额 ${incomePendingAmountCount} 条流水`);
      if (detailTaskCount > 0) parts.push(`明细认账 ${detailTaskCount} 个任务已加入队列`);
      if (skippedTaskCount > 0) parts.push(`跳过 ${skippedTaskCount} 个无需处理任务`);

      return {
        success: true,
        incomeTaskCount,
        incomeMatchedCount,
        incomePendingAmountCount,
        detailTaskCount,
        skippedTaskCount,
        message: parts.length > 0 ? `开始认账：${parts.join("；")}` : "没有需要认账的任务",
      };
    }),

  startDeleteTask: authedQuery
    .input(z.object({ taskId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "recognition_task_delete"))) throw new Error("权限不足");
      const db = getDb();
      const [task] = await db
        .select({ billDate: recognitionTasks.billDate })
        .from(recognitionTasks)
        .where(eq(recognitionTasks.id, input.taskId));
      if (!task) throw new Error("任务不存在");
      const session = createDeleteTaskSession(input.taskId, task.billDate);
      void runDeleteTaskSession(session.deleteId, input.taskId);
      return session;
    }),

  getDeleteTaskStatus: authedQuery
    .input(z.object({ deleteId: z.string().min(1) }))
    .query(({ input }) => {
      const session = deleteTaskSessions.get(input.deleteId);
      if (!session) {
        return {
          deleteId: input.deleteId,
          taskId: 0,
          billDate: "",
          status: "failed" as const,
          step: DELETE_TASK_STEPS.length,
          totalSteps: DELETE_TASK_STEPS.length,
          message: "删除状态已过期",
          error: "删除状态已过期，请刷新列表确认结果",
          startedAt: Date.now(),
          completedAt: Date.now(),
        };
      }
      return session;
    }),

  deleteTask: authedQuery
    .input(z.object({ taskId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "recognition_task_delete"))) throw new Error("权限不足");
      await deleteDateTasksWithSteps(input.taskId, () => {});
      return { success: true };
    }),

  deleteBankFlow: authedQuery
    .input(z.object({ flowId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "bank_flow_delete"))) throw new Error("权限不足");
      const db = getDb();
      const deletion = await db.transaction(async (tx) => {
        const [initialFlow] = await tx.select({ taskId: bankFlows.taskId })
          .from(bankFlows)
          .where(eq(bankFlows.id, input.flowId));
        const taskId = Number(initialFlow?.taskId || 0);
        if (!taskId) throw new Error("银行流水不存在或已被删除");

        // Lock the task and flow before rechecking their latest state so recognition
        // cannot start between validation and deletion.
        await tx.update(recognitionTasks)
          .set({ status: sql`${recognitionTasks.status}` })
          .where(eq(recognitionTasks.id, taskId));
        await tx.update(bankFlows)
          .set({ recognitionStatus: sql`${bankFlows.recognitionStatus}` })
          .where(eq(bankFlows.id, input.flowId));

        const [context] = await tx
          .select({
            flowStatus: bankFlows.recognitionStatus,
            taskStatus: recognitionTasks.status,
            taskRuleId: recognitionTasks.ruleId,
            billDate: recognitionTasks.billDate,
            recognitionType: counterpartyRecords.recognitionType,
            detailMatchingMode: counterpartyRecords.detailMatchingMode,
          })
          .from(bankFlows)
          .innerJoin(recognitionTasks, eq(recognitionTasks.id, bankFlows.taskId))
          .leftJoin(recognitionRules, eq(recognitionRules.id, recognitionTasks.ruleId))
          .leftJoin(counterpartyRecords, eq(counterpartyRecords.alias, recognitionRules.matchedCounterpartyAlias))
          .where(eq(bankFlows.id, input.flowId));
        if (!context) throw new Error("银行流水不存在或已被删除");
        if (context.taskStatus === "processing") throw new Error("该流水正在执行认账，暂不能删除");
        if (context.flowStatus !== "unrecognized") throw new Error("只能删除未认账的银行流水");

        const [multiDayLink] = await tx
          .select({ groupId: multiDayMatchGroupFlows.groupId })
          .from(multiDayMatchGroupFlows)
          .where(eq(multiDayMatchGroupFlows.bankFlowId, input.flowId))
          .limit(1);
        if (multiDayLink) {
          throw new Error("该流水已关联多日汇总订单包，不能单独删除，请先处理关联订单包");
        }

        const [boundOrderFileSummary] = await tx.select({ count: count() })
          .from(orderFiles)
          .where(eq(orderFiles.taskId, taskId));
        const [boundDetailSummary] = await tx.select({ count: count() })
          .from(billDetails)
          .where(eq(billDetails.taskId, taskId));
        if (Number(boundOrderFileSummary?.count || 0) > 0 || Number(boundDetailSummary?.count || 0) > 0) {
          throw new Error("该流水已绑定订单明细包，不能单独删除，请先处理关联订单包");
        }

        const [resultSummary] = await tx.select({ count: count() })
          .from(matchResults)
          .where(eq(matchResults.bankFlowId, input.flowId));
        if (Number(resultSummary?.count || 0) > 0) throw new Error("该流水已有入账结果，不能删除");

        const [voucherSummary] = await tx.select({ count: count() })
          .from(voucherResultFlows)
          .where(eq(voucherResultFlows.bankFlowId, input.flowId));
        if (Number(voucherSummary?.count || 0) > 0) throw new Error("该流水已关联凭证，不能删除");

        const isSameDayAggregate = context.recognitionType === "明细认账"
          && context.detailMatchingMode === "同日汇总匹配";
        const deleteResult: any = await tx.delete(bankFlows).where(and(
          eq(bankFlows.id, input.flowId),
          eq(bankFlows.recognitionStatus, "unrecognized"),
        ));
        const deletedCount = Number(deleteResult?.[0]?.affectedRows ?? deleteResult?.affectedRows ?? 0);
        if (deletedCount !== 1) throw new Error("流水状态已变化，请刷新后重试");

        const [remainingFlowSummary] = await tx.select({
          count: count(),
          total: sql<string>`COALESCE(SUM(CAST(${bankFlows.income} AS DECIMAL(18,2))), 0.00)`,
        }).from(bankFlows).where(eq(bankFlows.taskId, taskId));
        await tx.update(recognitionTasks).set({
          bankFlowCount: Number(remainingFlowSummary?.count || 0),
          bankFlowTotal: Number(remainingFlowSummary?.total || 0).toFixed(2),
          completedAt: null,
          updatedAt: new Date(),
        }).where(eq(recognitionTasks.id, taskId));

        const [splitFileSummary] = await tx.select({ count: count() })
          .from(detailSplitFiles)
          .where(eq(detailSplitFiles.taskId, taskId));
        const [taskResultSummary] = await tx.select({ count: count() })
          .from(matchResults)
          .where(eq(matchResults.taskId, taskId));
        const [anchorGroupSummary] = await tx.select({ count: count() })
          .from(multiDayMatchGroups)
          .where(eq(multiDayMatchGroups.anchorTaskId, taskId));
        const taskIsEmpty = Number(remainingFlowSummary?.count || 0) === 0
          && Number(boundOrderFileSummary?.count || 0) === 0
          && Number(boundDetailSummary?.count || 0) === 0
          && Number(splitFileSummary?.count || 0) === 0
          && Number(taskResultSummary?.count || 0) === 0
          && Number(anchorGroupSummary?.count || 0) === 0;
        if (taskIsEmpty) {
          await tx.delete(recognitionTasks).where(eq(recognitionTasks.id, taskId));
        }

        const remainingDateTasks = await tx.select({ id: recognitionTasks.id })
          .from(recognitionTasks)
          .where(eq(recognitionTasks.billDate, context.billDate))
          .orderBy(recognitionTasks.id);
        const affectedTaskIds = Array.from(new Set([
          taskId,
        ])).filter((id) => id > 0 && (!taskIsEmpty || id !== taskId));
        return {
          billDate: String(context.billDate),
          deletedTaskId: taskIsEmpty ? taskId : 0,
          nextTaskId: Number(remainingDateTasks[0]?.id || 0),
          affectedTaskIds,
          sameDayAggregate: isSameDayAggregate,
        };
      });

      let summaryRefreshFailed = false;
      for (const affectedTaskId of deletion.affectedTaskIds) {
        try {
          await refreshTaskStatusByFlows(affectedTaskId);
        } catch (error) {
          summaryRefreshFailed = true;
          console.error(`[deleteBankFlow] failed to refresh task ${affectedTaskId}:`, error);
        }
      }
      try {
        await refreshRecognitionDateSummary(deletion.billDate);
      } catch (error) {
        summaryRefreshFailed = true;
        console.error(`[deleteBankFlow] failed to refresh date ${deletion.billDate}:`, error);
      }
      return { success: true, summaryRefreshFailed, ...deletion };
    }),

  cancelBankFlowArrivalMatch: authedQuery
    .input(z.object({ flowId: z.number().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "bank_flow_match_manage"))) throw new Error("权限不足");
      const db = getDb();
      const result = await db.transaction(async (tx) => {
        const [initialFlow] = await tx.select({ taskId: bankFlows.taskId })
          .from(bankFlows)
          .where(eq(bankFlows.id, input.flowId));
        const taskId = Number(initialFlow?.taskId || 0);
        if (!taskId) throw new Error("银行流水不存在");

        await tx.update(recognitionTasks)
          .set({ status: sql`${recognitionTasks.status}` })
          .where(eq(recognitionTasks.id, taskId));
        await tx.update(bankFlows)
          .set({ arrivalMatchStatus: sql`${bankFlows.arrivalMatchStatus}` })
          .where(eq(bankFlows.id, input.flowId));

        const [context] = await tx.select({
          taskStatus: recognitionTasks.status,
          billDate: recognitionTasks.billDate,
          creatorId: recognitionTasks.creatorId,
          sameDayCounterpartyId: recognitionTasks.sameDayCounterpartyId,
          recognitionStatus: bankFlows.recognitionStatus,
          arrivalMatchStatus: bankFlows.arrivalMatchStatus,
          income: bankFlows.income,
        }).from(bankFlows)
          .innerJoin(recognitionTasks, eq(recognitionTasks.id, bankFlows.taskId))
          .where(eq(bankFlows.id, input.flowId));
        if (!context) throw new Error("银行流水不存在");
        if (context.taskStatus === "processing") throw new Error("该流水正在执行认账，暂不能取消匹配");
        if (context.recognitionStatus !== "unrecognized") throw new Error("只能取消待认账流水的匹配");
        if (context.arrivalMatchStatus !== "matched") throw new Error("该流水当前不是待认账状态");

        const [[resultSummary], [voucherSummary], [multiDayLink], [orderFileSummary], [detailSummary], [splitFileSummary]] = await Promise.all([
          tx.select({ count: count() }).from(matchResults).where(eq(matchResults.bankFlowId, input.flowId)),
          tx.select({ count: count() }).from(voucherResultFlows).where(eq(voucherResultFlows.bankFlowId, input.flowId)),
          tx.select({ count: count() }).from(multiDayMatchGroupFlows).where(eq(multiDayMatchGroupFlows.bankFlowId, input.flowId)),
          tx.select({ count: count() }).from(orderFiles).where(eq(orderFiles.taskId, taskId)),
          tx.select({ count: count() }).from(billDetails).where(eq(billDetails.taskId, taskId)),
          tx.select({ count: count() }).from(detailSplitFiles).where(eq(detailSplitFiles.taskId, taskId)),
        ]);
        if (Number(resultSummary?.count || 0) > 0) throw new Error("该流水已有认账结果，不能取消匹配");
        if (Number(voucherSummary?.count || 0) > 0) throw new Error("该流水已关联凭证，不能取消匹配");
        if (Number(multiDayLink?.count || 0) > 0) throw new Error("该流水已关联多日汇总订单包，不能取消匹配");
        if (Number(orderFileSummary?.count || 0) > 0 || Number(detailSummary?.count || 0) > 0 || Number(splitFileSummary?.count || 0) > 0) {
          throw new Error("该流水所在任务已绑定订单明细包，不能取消匹配");
        }

        let targetTaskId = taskId;
        const affectedTaskIds = new Set<number>([taskId]);
        if (context.sameDayCounterpartyId) {
          const createdTask = await tx.insert(recognitionTasks).values({
            ruleId: 0,
            billDate: context.billDate,
            creatorId: Number(context.creatorId),
            status: "pending_details",
            bankFlowTotal: String(context.income || "0.00"),
            bankFlowCount: 1,
          }).$returningId();
          targetTaskId = Number(createdTask[0]?.id || 0);
          if (!targetTaskId) throw new Error("创建未认账流水任务失败");
          affectedTaskIds.add(targetTaskId);
        }

        const updateResult: any = await tx.update(bankFlows).set({
          taskId: targetTaskId,
          matchedCounterpartyId: null,
          arrivalMatchStatus: "cancelled",
          incomeRuleId: null,
        }).where(and(
          eq(bankFlows.id, input.flowId),
          eq(bankFlows.recognitionStatus, "unrecognized"),
          eq(bankFlows.arrivalMatchStatus, "matched"),
        ));
        const updatedCount = Number(updateResult?.[0]?.affectedRows ?? updateResult?.affectedRows ?? 0);
        if (updatedCount !== 1) throw new Error("流水状态已变化，请刷新后重试");

        if (targetTaskId !== taskId) {
          const [remaining] = await tx.select({
            count: count(),
            total: sql<string>`COALESCE(SUM(CAST(${bankFlows.income} AS DECIMAL(18,2))), 0.00)`,
          }).from(bankFlows).where(eq(bankFlows.taskId, taskId));
          await tx.update(recognitionTasks).set({
            bankFlowCount: Number(remaining?.count || 0),
            bankFlowTotal: Number(remaining?.total || 0).toFixed(2),
            completedAt: null,
            updatedAt: new Date(),
          }).where(eq(recognitionTasks.id, taskId));
        }
        return {
          billDate: String(context.billDate),
          taskId: targetTaskId,
          affectedTaskIds: Array.from(affectedTaskIds),
        };
      });

      for (const affectedTaskId of result.affectedTaskIds) {
        await refreshTaskStatusByFlows(affectedTaskId);
      }
      await refreshRecognitionDateSummary(result.billDate);
      return { success: true, ...result };
    }),

  rematchBankFlowArrival: authedQuery
    .input(z.object({ flowId: z.number().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "bank_flow_match_manage"))) throw new Error("权限不足");
      const db = getDb();
      const result = await db.transaction(async (tx) => {
        const [initialFlow] = await tx.select({ taskId: bankFlows.taskId })
          .from(bankFlows)
          .where(eq(bankFlows.id, input.flowId));
        const taskId = Number(initialFlow?.taskId || 0);
        if (!taskId) throw new Error("银行流水不存在");

        await tx.update(recognitionTasks)
          .set({ status: sql`${recognitionTasks.status}` })
          .where(eq(recognitionTasks.id, taskId));
        await tx.update(bankFlows)
          .set({ arrivalMatchStatus: sql`${bankFlows.arrivalMatchStatus}` })
          .where(eq(bankFlows.id, input.flowId));

        const [context] = await tx.select({
          flow: bankFlows,
          taskStatus: recognitionTasks.status,
          billDate: recognitionTasks.billDate,
          creatorId: recognitionTasks.creatorId,
        }).from(bankFlows)
          .innerJoin(recognitionTasks, eq(recognitionTasks.id, bankFlows.taskId))
          .where(eq(bankFlows.id, input.flowId));
        if (!context) throw new Error("银行流水不存在");
        if (context.taskStatus === "processing") throw new Error("该流水正在执行认账，暂不能重新匹配");
        if (context.flow.recognitionStatus !== "unrecognized") throw new Error("只能重新匹配未认账流水");
        if (context.flow.arrivalMatchStatus === "matched") throw new Error("该流水已经匹配到账信息");
        assertBankFlowRecognitionEligible(context.flow.income);

        const [[resultSummary], [voucherSummary], [multiDayLink], [orderFileSummary], [detailSummary], [splitFileSummary]] = await Promise.all([
          tx.select({ count: count() }).from(matchResults).where(eq(matchResults.bankFlowId, input.flowId)),
          tx.select({ count: count() }).from(voucherResultFlows).where(eq(voucherResultFlows.bankFlowId, input.flowId)),
          tx.select({ count: count() }).from(multiDayMatchGroupFlows).where(eq(multiDayMatchGroupFlows.bankFlowId, input.flowId)),
          tx.select({ count: count() }).from(orderFiles).where(eq(orderFiles.taskId, taskId)),
          tx.select({ count: count() }).from(billDetails).where(eq(billDetails.taskId, taskId)),
          tx.select({ count: count() }).from(detailSplitFiles).where(eq(detailSplitFiles.taskId, taskId)),
        ]);
        if (Number(resultSummary?.count || 0) > 0 || Number(voucherSummary?.count || 0) > 0) {
          throw new Error("该流水已有认账结果或凭证，不能重新匹配");
        }
        if (Number(multiDayLink?.count || 0) > 0) throw new Error("该流水已关联多日汇总订单包，不能重新匹配");
        if (Number(orderFileSummary?.count || 0) > 0 || Number(detailSummary?.count || 0) > 0 || Number(splitFileSummary?.count || 0) > 0) {
          throw new Error("该流水所在任务已绑定订单明细包，不能重新匹配");
        }

        const counterparties = await loadBankFlowCounterparties(tx);
        const resolution = resolveBankFlowCounterparty(context.flow, counterparties);
        if (resolution.kind !== "matched") {
          await tx.update(bankFlows).set({
            matchedCounterpartyId: null,
            arrivalMatchStatus: "unmatched",
            incomeRuleId: null,
          }).where(eq(bankFlows.id, input.flowId));
          return {
            kind: resolution.kind,
            aliases: resolution.kind === "ambiguous" ? resolution.aliases : [],
            billDate: String(context.billDate),
            taskId,
            affectedTaskIds: [taskId],
            counterparty: null,
          };
        }

        const counterparty = resolution.counterparty;
        await tx.update(bankFlows).set({
          matchedCounterpartyId: Number(counterparty.id),
          arrivalMatchStatus: "matched",
          incomeRuleId: null,
        }).where(eq(bankFlows.id, input.flowId));

        let targetTaskId = taskId;
        let mergedTaskIds: number[] = [];
        if (counterparty.recognitionType === "明细认账" && counterparty.detailMatchingMode === "同日汇总匹配") {
          const resolved = await ensureSameDayAggregateTask({
            billDate: String(context.billDate),
            counterparty,
            creatorId: Number(context.creatorId),
            preferredTaskId: taskId,
            database: tx,
          });
          targetTaskId = resolved.taskId;
          mergedTaskIds = resolved.mergedTaskIds;
        }
        return {
          kind: "matched" as const,
          aliases: [String(counterparty.alias)],
          billDate: String(context.billDate),
          taskId: targetTaskId,
          affectedTaskIds: Array.from(new Set([targetTaskId, ...mergedTaskIds])),
          counterparty,
        };
      });

      if (result.kind === "matched" && result.counterparty?.recognitionType === "到账认账") {
        await executeIncomeRecognition(result.taskId);
      } else if (result.kind === "matched" && result.counterparty?.recognitionType === "明细认账") {
        await retryPendingMultiDayGroupsForFlowIds([input.flowId]);
        if (result.counterparty.detailMatchingMode === "同日汇总匹配") {
          const [fileSummary] = await db.select({ count: count() }).from(orderFiles).where(and(
            eq(orderFiles.taskId, result.taskId),
            sql`COALESCE(${orderFiles.uploadStatus}, 'completed') <> 'abnormal'`,
          ));
          if (Number(fileSummary?.count || 0) > 0) {
            await db.update(recognitionTasks).set({ status: "processing", completedAt: null, updatedAt: new Date() })
              .where(eq(recognitionTasks.id, result.taskId));
            void enqueueRecognition(result.taskId, { refreshUnmatchedMatches: true }).catch((error) => {
              console.error(`[rematch-bank-flow] 同日汇总任务 ${result.taskId} 自动认账失败:`, error);
            });
          }
        }
      }
      for (const affectedTaskId of result.affectedTaskIds) {
        if (affectedTaskId === result.taskId && result.kind === "matched" && result.counterparty?.recognitionType === "到账认账") continue;
        await refreshTaskStatusByFlows(affectedTaskId);
      }
      await refreshRecognitionDateSummary(result.billDate);
      return { success: true, kind: result.kind, aliases: result.aliases, taskId: result.taskId };
    }),

  markIgnore: authedQuery
    .input(z.object({ detailId: z.number(), reason: z.string().optional() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      let affectedTaskId = 0;
      await db.transaction(async (tx) => {
        const detail = await getDetailSummarySnapshot(input.detailId, tx);
        if (!detail) throw new Error("订单明细不存在");
        if (detail.matchResultId) throw new Error("已认账明细不能忽略");
        if (String(detail.operationStatus || "active") !== "active") {
          throw new Error("订单明细已被处理，请刷新后重试");
        }
        await tx.update(billDetails)
          .set({ operationStatus: "ignored", ignoreReason: input.reason || "暂时忽略" })
          .where(and(
            eq(billDetails.id, input.detailId),
            eq(billDetails.operationStatus, "active"),
            isNull(billDetails.matchResultId),
          ));
        await syncManualOrderWorkItemsByDetailIds(tx, [input.detailId]);
        await applyDetailSummaryDelta(detail, -1, {
          db: tx,
          refreshDateSummary: false,
          recognitionSummaryMode: "delta",
        });
        affectedTaskId = Number(detail.taskId || 0);
      });
      if (affectedTaskId) await refreshRecognitionDateSummariesByTaskIds([affectedTaskId]);
      return { success: true };
    }),

  findVarianceIgnoreCandidates: authedQuery
    .input(z.object({ flowId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [flowRow] = await db
        .select({
          flowId: bankFlows.id,
          taskId: bankFlows.taskId,
          referenceNo: bankFlows.referenceNo,
          taskRuleId: recognitionTasks.ruleId,
          taskDiffAmount: recognitionTasks.diffAmount,
          taskBillDate: recognitionTasks.billDate,
        })
        .from(bankFlows)
        .leftJoin(recognitionTasks, eq(recognitionTasks.id, bankFlows.taskId))
        .where(eq(bankFlows.id, input.flowId));
      if (!flowRow) throw new Error("银行流水不存在");
      const candidateTaskRows = flowRow.taskBillDate && flowRow.taskRuleId
        ? await db
          .select({ id: recognitionTasks.id })
          .from(recognitionTasks)
          .where(and(
            eq(recognitionTasks.billDate, flowRow.taskBillDate),
            eq(recognitionTasks.ruleId, Number(flowRow.taskRuleId)),
          ))
        : [];
      const candidateTaskIds = candidateTaskRows.map((row) => Number(row.id)).filter(Boolean);
      if (candidateTaskIds.length === 0) candidateTaskIds.push(Number(flowRow.taskId));

      const targetCents = amountToCents(flowRow.taskDiffAmount);
      if (targetCents <= 0) {
        return {
          flowId: Number(flowRow.flowId),
          referenceNo: flowRow.referenceNo,
          taskId: Number(flowRow.taskId),
          diffAmount: "0.00",
          mode: "none" as const,
          items: [],
          transferItems: [],
          selectedIds: [],
          selectedTransferIds: [],
          message: "该流水没有可查找的差额金额",
        };
      }

      const baseConditions = [
        inArray(billDetails.taskId, candidateTaskIds),
        sql`${billDetails.matchResultId} IS NULL`,
        sql`COALESCE(${billDetails.operationStatus}, 'active') = 'active'`,
        isNull(billDetails.detailSplitFileId),
        sql`COALESCE(${orderFiles.uploadStatus}, 'completed') <> 'abnormal'`,
      ];
      const selectFields = {
        id: billDetails.id,
        billNo: billDetails.billNo,
        ruleName: recognitionRules.ruleName,
        description: billDetails.description,
        amount: billDetails.totalAmount,
        totalAmount: billDetails.totalAmount,
        billDate: billDetails.billDate,
        detailPackageType: orderFiles.detailPackageType,
        uploadDate: orderFiles.uploadDate,
        matchStatus: billDetails.matchStatus,
      };

      const targetAmount = (targetCents / 100).toFixed(2);
      const exactRows = await db
        .select(selectFields)
        .from(billDetails)
        .leftJoin(orderFiles, eq(billDetails.orderFileId, orderFiles.id))
        .leftJoin(recognitionRules, eq(recognitionRules.id, sql`COALESCE(${billDetails.ruleId}, ${orderFiles.ruleId})`))
        .where(and(
          ...baseConditions,
          eq(billDetails.totalAmount, targetAmount),
        ))
        .orderBy(billDetails.id)
        .limit(100);

      const candidateRows = exactRows.length > 0
        ? exactRows
        : await db
          .select(selectFields)
          .from(billDetails)
          .leftJoin(orderFiles, eq(billDetails.orderFileId, orderFiles.id))
          .leftJoin(recognitionRules, eq(recognitionRules.id, sql`COALESCE(${billDetails.ruleId}, ${orderFiles.ruleId})`))
          .where(and(
            ...baseConditions,
            sql`CAST(${billDetails.totalAmount} AS DECIMAL(18,2)) > 0`,
          ))
          .orderBy(billDetails.id)
          .limit(500);
      const ignoreOnlyItems = exactRows.length > 0
        ? exactRows
        : findFirstAmountCombination(candidateRows, targetCents);
      let transferCandidateRows: Array<{
        id: number;
        summaryDate: string | null;
        billNo: string | null;
        ruleName: string | null;
        description: string | null;
        amount: string | null;
        totalAmount: string | null;
        billDate: string | null;
        ignoreReason: string | null;
        matchStatus: string | null;
      }> = [];
      if (exactRows.length === 0 && ignoreOnlyItems.length === 0 && flowRow.taskRuleId) {
        const detailPackageType = await getDetailPackageTypeForRule(Number(flowRow.taskRuleId));
        if (detailPackageType === "T+1") {
          transferCandidateRows = await db
            .select({
              id: billDetails.id,
              summaryDate: recognitionTasks.billDate,
              billNo: billDetails.billNo,
              ruleName: recognitionRules.ruleName,
              description: billDetails.description,
              amount: billDetails.totalAmount,
              totalAmount: billDetails.totalAmount,
              billDate: billDetails.billDate,
              ignoreReason: billDetails.ignoreReason,
              matchStatus: billDetails.matchStatus,
            })
            .from(billDetails)
            .leftJoin(orderFiles, eq(billDetails.orderFileId, orderFiles.id))
            .leftJoin(recognitionTasks, eq(recognitionTasks.id, billDetails.taskId))
            .leftJoin(recognitionRules, eq(recognitionRules.id, sql`COALESCE(${billDetails.ruleId}, ${orderFiles.ruleId}, ${recognitionTasks.ruleId})`))
            .where(and(
              ...ignoredT1TransferCandidateConditions(Number(flowRow.taskRuleId), Number(flowRow.taskId)),
              sql`CAST(${billDetails.totalAmount} AS DECIMAL(18,2)) > 0`,
            ))
            .orderBy(billDetails.id)
            .limit(500);
        }
      }

      const netSuggestion = exactRows.length > 0 || ignoreOnlyItems.length > 0
        ? { ignoreItems: ignoreOnlyItems, transferItems: [] as typeof transferCandidateRows }
        : findVarianceAdjustmentSuggestion(candidateRows, transferCandidateRows, targetCents);
      const items = netSuggestion.ignoreItems;
      const transferItems = netSuggestion.transferItems;
      const mode = exactRows.length > 0
        ? "single" as const
        : transferItems.length > 0
          ? "net_combination" as const
          : items.length > 0
            ? "combination" as const
            : "none" as const;

      return {
        flowId: Number(flowRow.flowId),
        referenceNo: flowRow.referenceNo,
        taskId: Number(flowRow.taskId),
        taskBillDate: flowRow.taskBillDate,
        diffAmount: (targetCents / 100).toFixed(2),
        mode,
        items,
        transferItems,
        selectedIds: mode === "single" && items.length > 1 ? [] : items.map((item: any) => Number(item.id)),
        selectedTransferIds: transferItems.map((item: any) => Number(item.id)),
        message: items.length > 0
          ? mode === "single"
            ? "请确认需要忽略的单条订单明细"
            : mode === "net_combination"
              ? "已找到一组可按“忽略金额 - 转移金额 = 差额”抹平异常的订单，请确认"
              : "已找到一组金额合计等于差额的订单明细，请确认"
          : transferCandidateRows.length > 0
            ? "已查找同规则的 T+1 已忽略订单，但未找到可抹平差额的组合"
            : "未在当前明细包或同规则的 T+1 已忽略订单中找到可抹平差额的组合",
      };
    }),

  findPartialTransferCandidates: authedQuery
    .input(z.object({ flowId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const context = await getPartialRecognitionFlowContext(input.flowId);
      const transferAmount = calculatePartialTransferAmount(
        amountToCents(context.recognitionAvailableAmount),
        amountToCents(context.pendingSplitAmount),
      );
      const targetCents = transferAmount.transferTargetCents;
      const amountFields = {
        recognitionAvailableAmount: (transferAmount.recognitionAvailableCents / 100).toFixed(2),
        pendingSplitAmount: (transferAmount.pendingSplitCents / 100).toFixed(2),
        transferTargetAmount: (targetCents / 100).toFixed(2),
        availableAmount: (targetCents / 100).toFixed(2),
      };
      if (context.detailPackageType !== "T+1") {
        return {
          flowId: Number(context.flow.id),
          referenceNo: context.flow.referenceNo,
          taskId: context.taskId,
          targetDate: context.billDate,
          ...amountFields,
          items: [],
          suggestedIds: [],
          message: "打包明细不支持转移，转移补认账只支持 T+1 订单",
        };
      }
      if (context.status !== "partial_matched"
        || amountToCents(context.recognizedAmount) <= 0
        || transferAmount.recognitionAvailableCents <= 0) {
        return {
          flowId: Number(context.flow.id),
          referenceNo: context.flow.referenceNo,
          taskId: context.taskId,
          targetDate: context.billDate,
          ...amountFields,
          items: [],
          suggestedIds: [],
          message: "该流水当前不是可补认账的部分认账状态",
        };
      }
      if (transferAmount.pendingSplitMatchesAvailable) {
        return {
          flowId: Number(context.flow.id),
          referenceNo: context.flow.referenceNo,
          taskId: context.taskId,
          targetDate: context.billDate,
          ...amountFields,
          items: [],
          suggestedIds: [],
          message: "无推荐转移订单，请进行明细分账完成认账",
        };
      }
      if (transferAmount.pendingSplitExceedsAvailable) {
        return {
          flowId: Number(context.flow.id),
          referenceNo: context.flow.referenceNo,
          taskId: context.taskId,
          targetDate: context.billDate,
          ...amountFields,
          items: [],
          suggestedIds: [],
          message: "待拆分订单金额大于待认账金额，请先完成明细分账",
        };
      }

      const targetAmount = (targetCents / 100).toFixed(2);
      const items = await db
        .select({
          id: billDetails.id,
          summaryDate: recognitionTasks.billDate,
          billNo: billDetails.billNo,
          ruleName: recognitionRules.ruleName,
          description: billDetails.description,
          amount: billDetails.totalAmount,
          billDate: billDetails.billDate,
          ignoreReason: billDetails.ignoreReason,
          matchStatus: billDetails.matchStatus,
        })
        .from(billDetails)
        .leftJoin(orderFiles, eq(billDetails.orderFileId, orderFiles.id))
        .leftJoin(recognitionTasks, eq(recognitionTasks.id, billDetails.taskId))
        .leftJoin(recognitionRules, eq(recognitionRules.id, sql`COALESCE(${billDetails.ruleId}, ${orderFiles.ruleId}, ${recognitionTasks.ruleId})`))
        .where(and(
          ...ignoredT1TransferCandidateConditions(context.ruleId, context.taskId),
          sql`CAST(${billDetails.totalAmount} AS DECIMAL(18,2)) > 0`,
          sql`CAST(${billDetails.totalAmount} AS DECIMAL(18,2)) <= ${targetAmount}`,
        ))
        .orderBy(sql`CASE WHEN CAST(${billDetails.totalAmount} AS DECIMAL(18,2)) = ${targetAmount} THEN 0 ELSE 1 END`, billDetails.id)
        .limit(500);

      const exactItem = items.find((item) => amountToCents(item.amount) === targetCents);
      const suggestedItems = exactItem
        ? [exactItem]
        : findFirstAmountCombination(items, targetCents);
      const suggestedIds = suggestedItems.map((item) => Number(item.id));
      return {
        flowId: Number(context.flow.id),
        referenceNo: context.flow.referenceNo,
        taskId: context.taskId,
        targetDate: context.billDate,
        ...amountFields,
        items,
        suggestedIds,
        message: suggestedIds.length > 0
          ? suggestedIds.length === 1
            ? "已找到一条金额等于推荐转移金额的 T+1 已忽略订单"
            : `已找到 ${suggestedIds.length} 条金额合计等于推荐转移金额的 T+1 已忽略订单`
          : items.length > 0
            ? "未自动找到等额组合，请手动选择金额合计等于推荐转移金额的订单"
            : "未找到同规则且可转移的 T+1 已忽略订单",
      };
    }),

  transferIgnoredDetailsAndRecognize: authedQuery
    .input(z.object({
      flowId: z.number(),
      detailIds: z.array(z.number()).min(1, "请选择订单明细"),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const uniqueIds = Array.from(new Set(input.detailIds.map(Number).filter(Boolean)));
      if (uniqueIds.length === 0) throw new Error("请选择订单明细");

      const context = await getPartialRecognitionFlowContext(input.flowId);
      const transferAmount = calculatePartialTransferAmount(
        amountToCents(context.recognitionAvailableAmount),
        amountToCents(context.pendingSplitAmount),
      );
      const targetCents = transferAmount.transferTargetCents;
      if (context.detailPackageType !== "T+1") {
        throw new Error("打包明细不支持转移，转移补认账只支持 T+1 订单");
      }
      if (context.status !== "partial_matched"
        || amountToCents(context.recognizedAmount) <= 0
        || transferAmount.recognitionAvailableCents <= 0) {
        throw new Error("该流水的待认账金额已变化，请刷新后重试");
      }
      if (transferAmount.pendingSplitMatchesAvailable) {
        throw new Error("无推荐转移订单，请进行明细分账完成认账");
      }
      if (transferAmount.pendingSplitExceedsAvailable) {
        throw new Error("待拆分订单金额大于待认账金额，请先完成明细分账");
      }

      const rows = await db
        .select({
          id: billDetails.id,
          taskId: billDetails.taskId,
          ruleId: sql<number>`COALESCE(${billDetails.ruleId}, ${orderFiles.ruleId}, ${recognitionTasks.ruleId}, 0)`,
          ruleItemId: billDetails.ruleItemId,
          orderFileId: billDetails.orderFileId,
          detailSplitFileId: billDetails.detailSplitFileId,
          partitionDate: billDetails.partitionDate,
          operationStatus: billDetails.operationStatus,
          ignoreReason: billDetails.ignoreReason,
          matchResultId: billDetails.matchResultId,
          matchStatus: billDetails.matchStatus,
          totalAmount: billDetails.totalAmount,
          refundAmountSnapshot: billDetails.refundAmountSnapshot,
          orderFileUploadStatus: orderFiles.uploadStatus,
          detailPackageType: orderFiles.detailPackageType,
          recognitionSummaryValid: orderFiles.recognitionSummaryValid,
          sourceBillDate: recognitionTasks.billDate,
        })
        .from(billDetails)
        .leftJoin(orderFiles, eq(billDetails.orderFileId, orderFiles.id))
        .leftJoin(recognitionTasks, eq(recognitionTasks.id, billDetails.taskId))
        .where(and(
          inArray(billDetails.id, uniqueIds),
          ...ignoredT1TransferCandidateConditions(context.ruleId, context.taskId),
          sql`CAST(${billDetails.totalAmount} AS DECIMAL(18,2)) > 0`,
        ));
      if (rows.length !== uniqueIds.length) {
        throw new Error("所选明细中包含非同规则、非 T+1、已认账或不可转移的订单");
      }
      const selectedCents = rows.reduce((sum, row) => sum + amountToCents(row.totalAmount), 0);
      if (selectedCents !== targetCents) {
        throw new Error(
          `所选订单金额合计 ${(selectedCents / 100).toFixed(2)} 与当前推荐转移金额 ${(targetCents / 100).toFixed(2)} 不一致`,
        );
      }

      const affectedTaskIds = await db.transaction(async (tx) => {
        const taskIds = new Set<number>([context.taskId]);
        for (const row of rows) {
          const current = await getDetailSummarySnapshot(Number(row.id), tx);
          if (!current || current.operationStatus !== "ignored" || current.matchResultId) {
            throw new Error("所选订单状态已变化，请刷新后重试");
          }
          const sourceTaskId = Number(current.taskId || 0);
          const originalRecognitionDate = current.partitionDate || row.sourceBillDate || context.billDate;
          const transferReason = sourceTaskId && sourceTaskId !== context.taskId
            ? `由 ${row.sourceBillDate || originalRecognitionDate} 任务 ${sourceTaskId} 转移至 ${context.billDate} 任务 ${context.taskId}`
            : `由 ${row.sourceBillDate || originalRecognitionDate} 转移至 ${context.billDate}`;
          await tx.update(billDetails).set({
            taskId: context.taskId,
            partitionDate: context.billDate,
            operationStatus: "transferred",
            originalTaskId: sourceTaskId,
            originalRecognitionDate,
            lifecycleStatus: "normal",
            ignoreReason: transferReason,
          }).where(and(
            eq(billDetails.id, Number(row.id)),
            eq(billDetails.operationStatus, "ignored"),
            isNull(billDetails.matchResultId),
          ));
          await moveOrderFilePartitionDetail(tx, {
            orderFileId: Number(current.orderFileId || 0),
            detailId: Number(row.id),
            fromPartitionDate: current.partitionDate,
            toPartitionDate: context.billDate,
          });
          await syncManualOrderWorkItemsByDetailIds(tx, [Number(row.id)]);
          await applyDetailSummaryDelta({
            ...current,
            taskId: context.taskId,
            operationStatus: "transferred",
            originalTaskId: sourceTaskId,
            originalRecognitionDate,
            partitionDate: context.billDate,
            ignoreReason: transferReason,
          }, 1, {
            db: tx,
            refreshDateSummary: false,
            recognitionSummaryMode: "delta",
          });
          if (sourceTaskId) taskIds.add(sourceTaskId);
        }
        return Array.from(taskIds);
      });

      const processingTaskIds = await enqueueIncrementalRecognition(
        context.taskId,
        affectedTaskIds,
        "转移已忽略订单补认账",
      );
      return {
        success: true,
        transferredCount: rows.length,
        transferredAmount: (selectedCents / 100).toFixed(2),
        targetTaskId: context.taskId,
        targetDate: context.billDate,
        processingTaskCount: processingTaskIds.length,
        recognitionQueued: true,
      };
    }),

  batchMarkIgnore: authedQuery
    .input(z.object({
      flowId: z.number(),
      detailIds: z.array(z.number()).min(1, "请选择订单明细"),
      transferDetailIds: z.array(z.number()).default([]),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const uniqueIds = Array.from(new Set(input.detailIds.map(Number).filter(Boolean)));
      const uniqueTransferIds = Array.from(new Set(input.transferDetailIds.map(Number).filter(Boolean)));
      if (uniqueIds.length === 0) throw new Error("请选择订单明细");
      if (uniqueIds.some((id) => uniqueTransferIds.includes(id))) throw new Error("同一订单不能同时忽略和转移");
      const [flow] = await db.select().from(bankFlows).where(eq(bankFlows.id, input.flowId));
      if (!flow) throw new Error("银行流水不存在");
      const [flowTask] = await db
        .select({
          billDate: recognitionTasks.billDate,
          ruleId: recognitionTasks.ruleId,
          diffAmount: recognitionTasks.diffAmount,
        })
        .from(recognitionTasks)
        .where(eq(recognitionTasks.id, Number(flow.taskId)));
      if (!flowTask) throw new Error("认账任务不存在");
      const targetCents = amountToCents(flowTask.diffAmount);
      if (targetCents <= 0) throw new Error("当前任务已无可忽略的差额，请刷新后重试");
      const recognitionTaskId = Number(flow.taskId);
      const candidateTaskRows = flowTask?.billDate && flowTask?.ruleId
        ? await db
          .select({ id: recognitionTasks.id })
          .from(recognitionTasks)
          .where(and(
            eq(recognitionTasks.billDate, flowTask.billDate),
            eq(recognitionTasks.ruleId, Number(flowTask.ruleId)),
          ))
        : [];
      const candidateTaskIds = candidateTaskRows.map((row) => Number(row.id)).filter(Boolean);
      if (candidateTaskIds.length === 0) candidateTaskIds.push(Number(flow.taskId));

      const rows = await db
        .select({
          id: billDetails.id,
          amount: billDetails.totalAmount,
        })
        .from(billDetails)
        .leftJoin(orderFiles, eq(billDetails.orderFileId, orderFiles.id))
        .where(and(
          inArray(billDetails.id, uniqueIds),
          inArray(billDetails.taskId, candidateTaskIds),
          sql`${billDetails.matchResultId} IS NULL`,
          sql`COALESCE(${billDetails.operationStatus}, 'active') = 'active'`,
          isNull(billDetails.detailSplitFileId),
          sql`COALESCE(${orderFiles.uploadStatus}, 'completed') <> 'abnormal'`,
        ));
      if (rows.length !== uniqueIds.length) {
        throw new Error("所选明细中包含非当前流水匹配订单包、已认账或已处理的订单");
      }
      const selectedCents = rows.reduce((sum, row) => sum + amountToCents(row.amount), 0);
      let transferRows: Array<{
        id: number;
        taskId: number | null;
        ruleId: number | null;
        ruleItemId: number | null;
        orderFileId: number | null;
        detailSplitFileId: number | null;
        partitionDate: string | null;
        operationStatus: string | null;
        ignoreReason: string | null;
        matchResultId: number | null;
        matchStatus: string | null;
        totalAmount: string | null;
        refundAmountSnapshot: string | null;
        orderFileUploadStatus: string | null;
        detailPackageType: string | null;
        recognitionSummaryValid: boolean | null;
        sourceBillDate: string | null;
      }> = [];
      if (uniqueTransferIds.length > 0) {
        const targetPackageType = await getDetailPackageTypeForRule(Number(flowTask.ruleId));
        if (targetPackageType !== "T+1") {
          throw new Error("打包明细不支持转移，异常差额调整只允许转移 T+1 已忽略订单");
        }
        transferRows = await db
          .select({
            id: billDetails.id,
            taskId: billDetails.taskId,
            ruleId: sql<number>`COALESCE(${billDetails.ruleId}, ${orderFiles.ruleId}, ${recognitionTasks.ruleId}, 0)`,
            ruleItemId: billDetails.ruleItemId,
            orderFileId: billDetails.orderFileId,
            detailSplitFileId: billDetails.detailSplitFileId,
            partitionDate: billDetails.partitionDate,
            operationStatus: billDetails.operationStatus,
            ignoreReason: billDetails.ignoreReason,
            matchResultId: billDetails.matchResultId,
            matchStatus: billDetails.matchStatus,
            totalAmount: billDetails.totalAmount,
            refundAmountSnapshot: billDetails.refundAmountSnapshot,
            orderFileUploadStatus: orderFiles.uploadStatus,
            detailPackageType: orderFiles.detailPackageType,
            recognitionSummaryValid: orderFiles.recognitionSummaryValid,
            sourceBillDate: recognitionTasks.billDate,
          })
          .from(billDetails)
          .leftJoin(orderFiles, eq(billDetails.orderFileId, orderFiles.id))
          .leftJoin(recognitionTasks, eq(recognitionTasks.id, billDetails.taskId))
          .where(and(
            inArray(billDetails.id, uniqueTransferIds),
            ...ignoredT1TransferCandidateConditions(Number(flowTask.ruleId), recognitionTaskId),
            sql`CAST(${billDetails.totalAmount} AS DECIMAL(18,2)) > 0`,
          ));
        if (transferRows.length !== uniqueTransferIds.length) {
          throw new Error("所选转移明细中包含非同规则、非 T+1、已认账或不可转移的订单");
        }
      }
      const transferredCents = transferRows.reduce((sum, row) => sum + amountToCents(row.totalAmount), 0);
      if (selectedCents - transferredCents !== targetCents) {
        throw new Error(
          `建议忽略金额 ${(selectedCents / 100).toFixed(2)} 减建议转移金额 ${(transferredCents / 100).toFixed(2)} 与当前差额 ${(targetCents / 100).toFixed(2)} 不一致，请重新选择`,
        );
      }

      const affectedTaskIds = await db.transaction(async (tx) => {
        const taskIds = new Set<number>();
        for (const detailId of uniqueIds) {
          const detail = await getDetailSummarySnapshot(detailId, tx);
          if (!detail) throw new Error("订单明细不存在");
          if (String(detail.operationStatus || "active") !== "active" || detail.matchResultId) {
            throw new Error("所选订单状态已变化，请刷新后重试");
          }
          await tx.update(billDetails)
            .set({ operationStatus: "ignored", ignoreReason: input.reason || "异常金额人工忽略" })
            .where(and(
              eq(billDetails.id, detailId),
              eq(billDetails.operationStatus, "active"),
              isNull(billDetails.matchResultId),
            ));
          await syncManualOrderWorkItemsByDetailIds(tx, [detailId]);
          await applyDetailSummaryDelta(detail, -1, {
            db: tx,
            refreshDateSummary: false,
            recognitionSummaryMode: "delta",
          });
          if (detail.taskId) taskIds.add(Number(detail.taskId));
        }
        for (const row of transferRows) {
          const current = await getDetailSummarySnapshot(Number(row.id), tx);
          if (!current || current.operationStatus !== "ignored" || current.matchResultId) {
            throw new Error("所选转移订单状态已变化，请刷新后重试");
          }
          const sourceTaskId = Number(current.taskId || 0);
          const originalRecognitionDate = current.partitionDate || row.sourceBillDate || flowTask.billDate;
          const transferReason = sourceTaskId && sourceTaskId !== recognitionTaskId
            ? `异常差额调整：由 ${row.sourceBillDate || originalRecognitionDate} 任务 ${sourceTaskId} 转移至 ${flowTask.billDate} 任务 ${recognitionTaskId}`
            : `异常差额调整：由 ${row.sourceBillDate || originalRecognitionDate} 转移至 ${flowTask.billDate}`;
          await tx.update(billDetails).set({
            taskId: recognitionTaskId,
            partitionDate: flowTask.billDate,
            operationStatus: "transferred",
            originalTaskId: sourceTaskId,
            originalRecognitionDate,
            lifecycleStatus: "normal",
            ignoreReason: transferReason,
          }).where(and(
            eq(billDetails.id, Number(row.id)),
            eq(billDetails.operationStatus, "ignored"),
            isNull(billDetails.matchResultId),
          ));
          await moveOrderFilePartitionDetail(tx, {
            orderFileId: Number(current.orderFileId || 0),
            detailId: Number(row.id),
            fromPartitionDate: current.partitionDate,
            toPartitionDate: flowTask.billDate,
          });
          await syncManualOrderWorkItemsByDetailIds(tx, [Number(row.id)]);
          await applyDetailSummaryDelta({
            ...current,
            taskId: recognitionTaskId,
            operationStatus: "transferred",
            originalTaskId: sourceTaskId,
            originalRecognitionDate,
            partitionDate: flowTask.billDate,
            ignoreReason: transferReason,
          }, 1, {
            db: tx,
            refreshDateSummary: false,
            recognitionSummaryMode: "delta",
          });
          if (sourceTaskId) taskIds.add(sourceTaskId);
        }
        return Array.from(taskIds);
      });
      const processingTaskIds = await enqueueIncrementalRecognition(
        recognitionTaskId,
        affectedTaskIds,
        transferRows.length > 0 ? "异常差额忽略并转移" : "批量忽略差额",
      );
      return {
        success: true,
        ignoredCount: uniqueIds.length,
        ignoredAmount: (selectedCents / 100).toFixed(2),
        transferredCount: transferRows.length,
        transferredAmount: (transferredCents / 100).toFixed(2),
        recognitionTaskId,
        processingTaskCount: processingTaskIds.length,
        recognitionQueued: true,
      };
    }),

  unmarkIgnore: authedQuery
    .input(z.object({ detailId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await ensureManualOrderDetailsInHotTable([input.detailId]);
      let affectedTaskId = 0;
      await db.transaction(async (tx) => {
        const detail = await getDetailSummarySnapshot(input.detailId, tx);
        if (!detail) throw new Error("订单明细不存在");
        if (detail.operationStatus !== "ignored") throw new Error("订单明细状态已变化，请刷新后重试");
        await tx.update(billDetails).set({
          operationStatus: "active", ignoreReason: null,
        }).where(and(
          eq(billDetails.id, input.detailId),
          eq(billDetails.operationStatus, "ignored"),
        ));
        await syncManualOrderWorkItemsByDetailIds(tx, [input.detailId]);
        if (!detailIsIncludedInSummary(detail)) {
          await applyDetailSummaryDelta(
            { ...detail, operationStatus: "active", ignoreReason: null },
            1,
            { db: tx, refreshDateSummary: false, recognitionSummaryMode: "delta" },
          );
        }
        affectedTaskId = Number(detail.taskId || 0);
      });
      if (affectedTaskId) await refreshRecognitionDateSummariesByTaskIds([affectedTaskId]);
      return { success: true };
    }),

  transferDetail: authedQuery
    .input(z.object({ detailId: z.number(), targetDate: z.string().min(1, "请选择转移日期") }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await ensureManualOrderDetailsInHotTable([input.detailId]);
      const { sourceTaskId, targetTaskId } = await db.transaction(async (tx) => {
        const detail = await getDetailSummarySnapshot(input.detailId, tx);
        if (!detail) throw new Error("订单明细不存在");
        const transfer = await transferBillDetailToDate(
          input.detailId,
          input.targetDate,
          ctx.user.id,
          tx,
        );
        await applyDetailSummaryDelta(detail, -1, {
          db: tx,
          refreshDateSummary: false,
          recognitionSummaryMode: "delta",
        });
        const transferredDetail = await getDetailSummarySnapshot(input.detailId, tx);
        if (!transferredDetail) throw new Error("转移后的订单明细不存在");
        await applyDetailSummaryDelta(transferredDetail, 1, {
          db: tx,
          refreshDateSummary: false,
          recognitionSummaryMode: "delta",
        });
        return transfer;
      });
      await refreshRecognitionDateSummariesByTaskIds([sourceTaskId, targetTaskId]);
      return { success: true, targetTaskId };
    }),

  transferIgnoredDetails: authedQuery
    .input(z.object({
      detailIds: z.array(z.number()).min(1, "请选择订单明细"),
      targetDate: z.string().min(1, "请选择转移日期"),
    }))
    .mutation(async ({ ctx, input }) => {
      const uniqueIds = Array.from(new Set(input.detailIds.map(Number).filter(Boolean)));
      if (uniqueIds.length === 0) throw new Error("请选择订单明细");

      const db = getDb();
      await ensureManualOrderDetailsInHotTable(uniqueIds);
      const affectedTaskIds = await db.transaction(async (tx) => {
        const ignoredRows = await tx
          .select({ id: billDetails.id })
          .from(billDetails)
          .leftJoin(orderFiles, eq(billDetails.orderFileId, orderFiles.id))
          .where(and(
            inArray(billDetails.id, uniqueIds),
            eq(billDetails.operationStatus, "ignored"),
            sql`${billDetails.matchResultId} IS NULL`,
            isNull(billDetails.detailSplitFileId),
            sql`COALESCE(${billDetails.ignoreReason}, '') NOT LIKE '已拆分%'`,
            sql`COALESCE(${billDetails.ignoreReason}, '') NOT LIKE '已按明细分账拆分认账%'`,
            sql`COALESCE(${orderFiles.detailPackageType}, 'T+1') = 'T+1'`,
          ));
        if (ignoredRows.length !== uniqueIds.length) {
          throw new Error("所选明细中包含非已忽略、打包明细或其他不可转移的订单；转移只支持 T+1 订单");
        }

        const taskIds = new Set<number>();
        for (const detailId of uniqueIds) {
          const { sourceTaskId, targetTaskId } = await transferBillDetailToDate(
            detailId,
            input.targetDate,
            ctx.user.id,
            tx,
          );
          const transferredDetail = await getDetailSummarySnapshot(detailId, tx);
          if (!transferredDetail) throw new Error("转移后的订单明细不存在");
          await applyDetailSummaryDelta(transferredDetail, 1, {
            db: tx,
            refreshDateSummary: false,
            recognitionSummaryMode: "delta",
          });
          taskIds.add(sourceTaskId);
          taskIds.add(targetTaskId);
        }
        return Array.from(taskIds);
      });

      await refreshRecognitionDateSummariesByTaskIds(affectedTaskIds);
      return { success: true, transferredCount: uniqueIds.length, affectedTaskCount: affectedTaskIds.length };
    }),

  cancelDetailOperation: authedQuery
    .input(z.object({
      detailId: z.number(),
      confirmCancelRecognition: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await ensureManualOrderDetailsInHotTable([input.detailId]);
      let detail = await getDetailSummarySnapshot(input.detailId);
      if (!detail) throw new Error("订单明细不存在");
      if (detail.operationStatus === "transferred" && detail.matchResultId) {
        throw new Error("已转移/已认账订单请先从日期汇总银行流水取消认账");
      }
      const cancellationPlan = await getDetailOperationCancellationPlan(detail);
      const hasCancelPermission = cancellationPlan.resultIds.length === 0
        || await userHasPermission(ctx.user, "manual_recognition_cancel");
      const cancellationDecision = deriveDetailOperationCancellationDecision({
        resultCount: cancellationPlan.resultIds.length,
        hasCancelPermission,
        hasLockedResult: cancellationPlan.hasLockedResult,
        hasGeneratedVoucher: cancellationPlan.hasGeneratedVoucher,
        hasArchivedDetails: cancellationPlan.hasArchivedDetails,
        operationLabel: cancellationPlan.operationLabel,
        originalDate: cancellationPlan.originalDate,
        scopeLabel: cancellationPlan.scopeLabel,
      });

      if (cancellationDecision.requiresConfirmation && !input.confirmCancelRecognition) {
        return {
          success: false as const,
          requiresConfirmation: true as const,
          canContinue: cancellationDecision.canContinue,
          operationStatus: cancellationPlan.operationStatus,
          operationLabel: cancellationPlan.operationLabel,
          originalDate: cancellationPlan.originalDate,
          scopeType: cancellationPlan.scopeType,
          scopeLabel: cancellationPlan.scopeLabel,
          bankFlowCount: cancellationPlan.flowIds.length,
          resultCount: cancellationPlan.resultIds.length,
          recognizedAmount: cancellationPlan.recognizedAmount,
          hasLockedResult: cancellationPlan.hasLockedResult,
          hasGeneratedVoucher: cancellationPlan.hasGeneratedVoucher,
          hasArchivedDetails: cancellationPlan.hasArchivedDetails,
          hasCancelPermission,
          message: cancellationDecision.message,
        };
      }

      let cancelledRecognitionCount = 0;
      if (cancellationPlan.resultIds.length > 0) {
        if (!cancellationDecision.canContinue) throw new Error(cancellationDecision.message);
        const cancellationResult = await cancelRecognitionResults({
          resultIds: cancellationPlan.resultIds,
          affectedFlowIds: cancellationPlan.flowIds,
          requestedTaskIds: cancellationPlan.taskIds,
        });
        cancelledRecognitionCount = cancellationResult.cancelledResultCount;
        detail = await getDetailSummarySnapshot(input.detailId);
        if (!detail || detail.operationStatus !== cancellationPlan.operationStatus) {
          throw new Error("订单明细操作状态已变化，请刷新后重试");
        }
      }

      const currentTaskId = Number(detail.taskId);
      if (detail.operationStatus === "ignored") {
        await db.transaction(async (tx) => {
          await tx.update(billDetails)
            .set({ operationStatus: "active", ignoreReason: null })
            .where(and(
              eq(billDetails.id, input.detailId),
              eq(billDetails.operationStatus, "ignored"),
            ));
          await syncManualOrderWorkItemsByDetailIds(tx, [input.detailId]);
          if (!detailIsIncludedInSummary(detail)) {
            await applyDetailSummaryDelta(
              { ...detail, operationStatus: "active", ignoreReason: null },
              1,
              { db: tx, refreshDateSummary: false, recognitionSummaryMode: "delta" },
            );
          }
        });
        if (currentTaskId) await refreshRecognitionDateSummariesByTaskIds([currentTaskId]);
        return {
          success: true as const,
          requiresConfirmation: false as const,
          operationStatus: cancellationPlan.operationStatus,
          operationLabel: cancellationPlan.operationLabel,
          cancelledRecognitionCount,
        };
      }
      if (detail.operationStatus === "transferred") {
        const originalTaskId = Number(detail.originalTaskId || 0);
        if (!originalTaskId) throw new Error("缺少原数据包，无法取消转移");
        await db.transaction(async (tx) => {
          await applyDetailSummaryDelta(detail, -1, {
            db: tx,
            refreshDateSummary: false,
            recognitionSummaryMode: "delta",
          });
          await tx.update(billDetails).set({
            taskId: originalTaskId,
            partitionDate: detail.originalRecognitionDate || detail.partitionDate || "1970-01-01",
            operationStatus: "active",
            originalTaskId: null,
            originalRecognitionDate: null,
            matchResultId: sql`NULL`,
            ignoreReason: null,
          }).where(and(
            eq(billDetails.id, input.detailId),
            eq(billDetails.operationStatus, "transferred"),
          ));
          await moveOrderFilePartitionDetail(tx, {
            orderFileId: Number(detail.orderFileId || 0),
            detailId: input.detailId,
            fromPartitionDate: detail.partitionDate,
            toPartitionDate: detail.originalRecognitionDate || detail.partitionDate || "1970-01-01",
          });
          await syncManualOrderWorkItemsByDetailIds(tx, [input.detailId]);
          await applyDetailSummaryDelta({
            ...detail,
            taskId: originalTaskId,
            partitionDate: detail.originalRecognitionDate || detail.partitionDate,
            operationStatus: "active",
            originalTaskId: null,
            matchResultId: null,
            ignoreReason: null,
          }, 1, {
            db: tx,
            refreshDateSummary: false,
            recognitionSummaryMode: "delta",
          });
        });
        await refreshRecognitionDateSummariesByTaskIds([originalTaskId, currentTaskId]);
        return {
          success: true as const,
          requiresConfirmation: false as const,
          operationStatus: cancellationPlan.operationStatus,
          operationLabel: cancellationPlan.operationLabel,
          cancelledRecognitionCount,
        };
      }
      throw new Error("订单明细操作状态已变化，请刷新后重试");
    }),

  getDetails: authedQuery
    .input(z.object({
      taskId: z.number(),
      summaryDate: z.string().optional(),
      detailPackageType: z.enum(["T+1", "打包明细"]).default("T+1"),
      status: z.enum(["recognized", "unrecognized", "unrecognized_all", "pending_split", "transferred_in"]).optional(),
      amountSearch: z.string().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(500).default(100),
    }))
    .query(async ({ input }) => {
      const db = getDb();
      const [task] = await db
        .select({ billDate: recognitionTasks.billDate })
        .from(recognitionTasks)
        .where(eq(recognitionTasks.id, input.taskId));
      if (!task) return { items: [], total: 0, page: input.page, pageSize: input.pageSize };
      const summaryDate = input.summaryDate ? normalizeDate(input.summaryDate) : task.billDate;
      const orderDate = addDays(summaryDate, -1);
      const targetTaskIds = await getTaskIdsForBillDate(summaryDate);
      const targetTasks = targetTaskIds.length > 0
        ? await db
          .select({ ruleId: recognitionTasks.ruleId })
          .from(recognitionTasks)
          .where(inArray(recognitionTasks.id, targetTaskIds))
        : [];
      const targetRuleIds = Array.from(new Set(
        targetTasks.map((item) => Number(item.ruleId || 0)).filter((ruleId) => ruleId > 0)
      ));
      return listTaskDateBillDetails(db, {
        summaryDate,
        orderDate,
        detailPackageType: input.detailPackageType,
        targetRuleIds,
        status: input.status,
        amountSearch: input.amountSearch,
        page: input.page,
        pageSize: input.pageSize,
      });
    }),

  getDetailForManualRecognition: authedQuery
    .input(z.object({
      detailId: z.number(),
      partitionDate: z.string(),
    }))
    .query(async ({ input }) => {
      const db = getDb();
      const detail = await getBillDetailForManualRecognition(db, input);
      if (!detail) throw new Error("订单明细不存在");
      const matchedFlows = await getManualDetailMatchedFlowsForReference(db, {
        taskId: Number(detail.taskId || 0),
        ruleId: Number(detail.ruleId || 0),
      });
      return {
        ...detail,
        matchedFlows,
        matchedFlowIds: matchedFlows.map((flow: any) => flow.id),
        matchedFlowReferenceNos: matchedFlows.map((flow: any) => flow.referenceNo),
      };
    }),

  listIgnoredDetails: authedQuery
    .input(z.object({
      ruleId: z.number().positive().optional(),
      status: z.enum(["ignored", "transferred", "transferred_recognized"]).optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(20),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const page = input?.page || 1;
      const pageSize = input?.pageSize || 20;
      return listManualOrderWorkItems(db, {
        ruleId: input?.ruleId,
        status: input?.status,
        page,
        pageSize,
      });
    }),

  getFlows: authedQuery
    .input(z.object({
      taskId: z.number(),
      bankName: z.enum(["广发银行", "工商银行", "中国银行"]).default("广发银行"),
      direction: z.enum(["income", "expense"]).default("income"),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(500).default(100),
    }))
    .query(async ({ input }) => {
      const db = getDb();
      const taskIds = await getDateTaskIdsByTaskId(input.taskId);
      if (taskIds.length === 0) {
        return {
          items: [],
          total: 0,
          bankName: input.bankName,
          direction: input.direction,
          page: input.page,
          pageSize: input.pageSize,
        };
      }
      // recognition_status 由认账和取消等写路径维护；该列表保持只读。
      if (input.direction === "expense") {
        const expenseWhere = and(
          inArray(bankFlows.taskId, taskIds),
          eq(bankFlows.bankName, input.bankName),
          lt(bankFlows.income, "0"),
        );
        const [expenseFlows, countResult] = await Promise.all([
          db.select()
            .from(bankFlows)
            .where(expenseWhere)
            .orderBy(bankFlows.id)
            .limit(input.pageSize)
            .offset((input.page - 1) * input.pageSize),
          db.select({ count: count() }).from(bankFlows).where(expenseWhere),
        ]);
        const pageTaskIds = Array.from(new Set(
          expenseFlows.map((flow) => Number(flow.taskId)).filter(Boolean),
        ));
        let packageBoundTaskIds = new Set<number>();
        if (pageTaskIds.length > 0) {
          const [packageBoundTaskRows, detailBoundTaskRows] = await Promise.all([
            db.select({ taskId: orderFiles.taskId })
              .from(orderFiles)
              .where(inArray(orderFiles.taskId, pageTaskIds))
              .groupBy(orderFiles.taskId),
            db.select({ taskId: billDetails.taskId })
              .from(billDetails)
              .where(inArray(billDetails.taskId, pageTaskIds))
              .groupBy(billDetails.taskId),
          ]);
          packageBoundTaskIds = new Set([
            ...packageBoundTaskRows.map((row) => Number(row.taskId)),
            ...detailBoundTaskRows.map((row) => Number(row.taskId)),
          ]);
        }

        return {
          items: expenseFlows.map((flow) => ({
            ...flow,
            flowDirection: "expense" as const,
            recognitionEligible: false,
            historicalRecognitionStatus: flow.recognitionStatus,
            status: "view_only" as const,
            recognizedAmount: "0.00",
            recognitionAvailableAmount: "0.00",
            recognitionDiffAmount: "0.00",
            canCancelManualRecognition: false,
            canCancelRecognition: false,
            hasVoucher: false,
            hasGeneratedVoucher: false,
            hasManualVoucher: false,
            pendingMatchedRecognition: false,
            pendingIncomeRuleRecognition: false,
            deleteLocked: packageBoundTaskIds.has(Number(flow.taskId)),
          })),
          total: Number(countResult[0]?.count || 0),
          bankName: input.bankName,
          direction: input.direction,
          page: input.page,
          pageSize: input.pageSize,
        };
      }

      const flowWhere = and(
        inArray(bankFlows.taskId, taskIds),
        eq(bankFlows.bankName, input.bankName),
        gt(bankFlows.income, "0"),
      );
      const items = await db
        .select({
          flow: bankFlows,
          taskStatus: recognitionTasks.status,
          taskBankFlowCount: recognitionTasks.bankFlowCount,
          taskDiffAmount: recognitionTasks.diffAmount,
          matchedCounterpartyAlias: counterpartyRecords.alias,
        })
        .from(bankFlows)
        .leftJoin(recognitionTasks, eq(recognitionTasks.id, bankFlows.taskId))
        .leftJoin(counterpartyRecords, eq(counterpartyRecords.id, bankFlows.matchedCounterpartyId))
        .where(flowWhere)
        .orderBy(bankFlows.id).limit(input.pageSize).offset((input.page - 1) * input.pageSize);
      const countResult = await db.select({ count: count() }).from(bankFlows).where(flowWhere);
      const incomeRuleIds = Array.from(new Set(items
        .map((item) => Number(item.flow.incomeRuleId || 0))
        .filter(Boolean)));
      const splitFormRows = incomeRuleIds.length > 0
        ? await db.select({
          incomeRuleId: incomeRuleSplits.incomeRuleId,
          splitForm: incomeRuleSplits.splitForm,
        }).from(incomeRuleSplits).where(inArray(incomeRuleSplits.incomeRuleId, incomeRuleIds))
        : [];
      const splitFormsByRuleId = new Map<number, Set<string>>();
      for (const row of splitFormRows) {
        const ruleId = Number(row.incomeRuleId);
        const forms = splitFormsByRuleId.get(ruleId) || new Set<string>();
        forms.add(row.splitForm || "百分比");
        splitFormsByRuleId.set(ruleId, forms);
      }
      const pendingAmountRuleIds = new Set(Array.from(splitFormsByRuleId.entries())
        .filter(([, forms]) => forms.size === 1 && forms.has("认账时填写"))
        .map(([ruleId]) => ruleId));
      const [packageBoundTaskRows, detailBoundTaskRows, archivedLegacyTaskRows] = await Promise.all([
        db.select({ taskId: orderFiles.taskId })
          .from(orderFiles)
          .where(inArray(orderFiles.taskId, taskIds))
          .groupBy(orderFiles.taskId),
        db.select({ taskId: billDetails.taskId })
          .from(billDetails)
          .where(inArray(billDetails.taskId, taskIds))
          .groupBy(billDetails.taskId),
        db.select({ taskId: matchResults.taskId })
          .from(matchResults)
          .where(and(
            inArray(matchResults.taskId, taskIds),
            isNull(matchResults.bankFlowId),
            eq(matchResults.hasArchivedDetails, true),
          ))
          .groupBy(matchResults.taskId),
      ]);
      const packageBoundTaskIds = new Set([
        ...packageBoundTaskRows.map((row) => Number(row.taskId)),
        ...detailBoundTaskRows.map((row) => Number(row.taskId)),
      ]);
      const archivedLegacyTaskIds = new Set(
        archivedLegacyTaskRows.map((row) => Number(row.taskId)),
      );
      const recognizedAmountRows = items.length > 0
        ? await db
          .select({
            bankFlowId: matchResults.bankFlowId,
            total: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
            incomeResultCount: sql<number>`SUM(CASE WHEN ${matchResults.incomeRuleId} IS NOT NULL THEN 1 ELSE 0 END)`,
            detailResultCount: sql<number>`SUM(CASE WHEN ${matchResults.ruleItemId} IS NOT NULL THEN 1 ELSE 0 END)`,
            manualResultCount: sql<number>`SUM(CASE WHEN ${matchResults.ruleItemId} IS NULL AND ${matchResults.incomeRuleId} IS NULL AND ${matchResults.detailCount} = 0 THEN 1 ELSE 0 END)`,
            manualPendingCount: sql<number>`SUM(CASE WHEN ${matchResults.ruleItemId} IS NULL AND ${matchResults.incomeRuleId} IS NULL AND ${matchResults.detailCount} = 0 AND ${matchResults.voucherStatus} = 'pending' THEN 1 ELSE 0 END)`,
            resultCount: sql<number>`COUNT(*)`,
            pendingVoucherCount: sql<number>`SUM(CASE WHEN ${matchResults.voucherStatus} = 'pending' THEN 1 ELSE 0 END)`,
            createdVoucherCount: sql<number>`SUM(CASE WHEN ${matchResults.voucherStatus} = 'created' THEN 1 ELSE 0 END)`,
            archivedDetailResultCount: sql<number>`SUM(CASE WHEN ${matchResults.hasArchivedDetails} = 1 THEN 1 ELSE 0 END)`,
          })
          .from(matchResults)
          .where(inArray(matchResults.bankFlowId, items.map((item) => Number(item.flow.id))))
          .groupBy(matchResults.bankFlowId)
        : [];
      const recognizedAmountByFlowId = new Map(
        recognizedAmountRows.map((row) => [Number(row.bankFlowId), {
          total: Number(row.total || 0),
          incomeResultCount: Number(row.incomeResultCount || 0),
          detailResultCount: Number(row.detailResultCount || 0),
          manualResultCount: Number(row.manualResultCount || 0),
          manualPendingCount: Number(row.manualPendingCount || 0),
          resultCount: Number(row.resultCount || 0),
          pendingVoucherCount: Number(row.pendingVoucherCount || 0),
          createdVoucherCount: Number(row.createdVoucherCount || 0),
          hasArchivedDetails: Number(row.archivedDetailResultCount || 0) > 0,
        }]),
      );
      const voucherFlowRows = items.length > 0
        ? await db
          .select({
            bankFlowId: voucherResultFlows.bankFlowId,
            voucherKind: voucherResults.voucherKind,
          })
          .from(voucherResultFlows)
          .innerJoin(voucherResults, eq(voucherResults.id, voucherResultFlows.voucherResultId))
          .where(inArray(voucherResultFlows.bankFlowId, items.map((item) => Number(item.flow.id))))
        : [];
      const voucherFlowIds = new Set(voucherFlowRows.map((row) => Number(row.bankFlowId)));
      const generatedVoucherFlowIds = new Set(
        voucherFlowRows
          .filter((row) => row.voucherKind === "generated")
          .map((row) => Number(row.bankFlowId)),
      );
      const manualVoucherFlowIds = new Set(
        voucherFlowRows
          .filter((row) => row.voucherKind === "manual")
          .map((row) => Number(row.bankFlowId)),
      );
      const aggregateFlowStatusById = await getAggregateFlowStatusByIdForTaskIds(taskIds);

      const itemsWithStatus = items.map((item) => {
        const recognizedSummary = recognizedAmountByFlowId.get(Number(item.flow.id));
        const aggregateFlowStatus = aggregateFlowStatusById.get(Number(item.flow.id));
        const recognizedAmount = aggregateFlowStatus?.recognizedAmount ?? recognizedSummary?.total ?? 0;
        const hasRecognizedProgress = hasRecognitionProgress(item.flow.income, recognizedAmount);
        const status = deriveBankFlowDisplayStatus({
          recognitionStatus: item.flow.recognitionStatus,
          taskStatus: item.taskStatus,
          hasRecognitionProgress: hasRecognizedProgress,
        });
        const recognitionAvailableAmount = aggregateFlowStatus?.recognitionAvailableAmount
          ?? getSignedRecognitionAvailableCents(item.flow.income, recognizedAmount) / 100;
        const hasVoucherRecord = voucherFlowIds.has(Number(item.flow.id));
        const hasGeneratedVoucher = generatedVoucherFlowIds.has(Number(item.flow.id));
        const hasManualVoucher = manualVoucherFlowIds.has(Number(item.flow.id));
        const hasVoucher = hasVoucherRecord
          && (aggregateFlowStatus?.allResultsVouchered
            ?? isVoucherScopeFullyCreated([recognizedSummary]));
        const canCancelManualRecognition = !!recognizedSummary && recognizedSummary.manualPendingCount > 0;
        const hasArchivedDetails = Boolean(
          aggregateFlowStatus?.hasArchivedDetails
          || recognizedSummary?.hasArchivedDetails
          || (
            Number(item.taskBankFlowCount || 0) === 1
            && archivedLegacyTaskIds.has(Number(item.flow.taskId))
          ),
        );
        const canCancelRecognition = canCancelFlowRecognition({
          hasRecognition: hasRecognizedProgress
          || item.flow.recognitionStatus === "recognized"
          || aggregateFlowStatus?.status === "recognized",
          hasArchivedDetails,
        });
        return {
          ...item.flow,
          matchedCounterpartyAlias: item.matchedCounterpartyAlias,
          status,
          recognizedAmount: recognizedAmount.toFixed(2),
          recognitionAvailableAmount: status === "recognized"
            ? "0.00"
            : recognitionAvailableAmount.toFixed(2),
          recognitionDiffAmount: status === "variance_partial_matched" || status === "variance_unrecognized"
            ? item.taskDiffAmount || "0.00"
            : "0.00",
          canCancelManualRecognition,
          canCancelRecognition,
          hasVoucher,
          hasGeneratedVoucher,
          hasManualVoucher,
        };
      });

      return {
        items: itemsWithStatus.map((item) => ({
          ...item,
          flowDirection: getBankFlowDirection(item.income),
          recognitionEligible: isBankFlowRecognitionEligible(item.income),
          historicalRecognitionStatus: isBankFlowRecognitionEligible(item.income) ? null : item.status,
          status: isBankFlowRecognitionEligible(item.income) ? item.status : "view_only" as const,
          pendingMatchedRecognition: isBankFlowRecognitionEligible(item.income)
            && item.status === "unrecognized"
            && item.arrivalMatchStatus === "matched",
          pendingIncomeRuleRecognition: isBankFlowRecognitionEligible(item.income)
            && item.status === "unrecognized"
            && pendingAmountRuleIds.has(Number(item.incomeRuleId || 0)),
          deleteLocked: packageBoundTaskIds.has(Number(item.taskId)),
        })),
        total: Number(countResult[0]?.count || 0),
        bankName: input.bankName,
        direction: input.direction,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  getFlowRecognitionCancellation: authedQuery
    .input(z.object({ flowId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const scope = await getFlowRecognitionCancellationScope(input.flowId);
      const recognitionEligible = isBankFlowRecognitionEligible(scope.clickedFlow.income);
      const resultIds = scope.results.map((result) => Number(result.id)).filter(Boolean);
      const resultPartitions = partitionRecognitionResultIds(scope.results);
      const detailResultIds = Array.from(new Set([
        ...resultPartitions.detail,
        ...resultPartitions.manual_detail,
      ]));
      const detailResultIdSet = new Set(detailResultIds);
      const expectedDetailCount = scope.results.reduce(
        (total, result) => detailResultIdSet.has(Number(result.id))
          ? total + Number(result.detailCount || 0)
          : total,
        0,
      );
      const [hotDetailSummary] = detailResultIds.length > 0
        ? await db
          .select({ detailCount: count() })
          .from(billDetails)
          .where(inArray(billDetails.matchResultId, detailResultIds))
        : [{ detailCount: 0 }];
      const hotDetailCount = Number(hotDetailSummary?.detailCount || 0);
      const [voucherLine] = resultIds.length > 0
        ? await db
          .select({ id: voucherResultLines.id })
          .from(voucherResultLines)
          .where(inArray(voucherResultLines.matchResultId, resultIds))
          .limit(1)
        : [];
      const hasLockedResult = scope.results.some((result) => result.voucherStatus === "created");
      const hasGeneratedVoucher = Boolean(voucherLine);
      const storedHasArchivedDetails = hasArchivedRecognitionDetails(scope.results);
      const recognitionDates = scope.results
        .filter((result) => detailResultIdSet.has(Number(result.id)))
        .map((result) => String(result.entryTime || ""));
      const hasMissingDetailCoverage = hotDetailCount < expectedDetailCount;
      const hasCompletedArchiveRun = hasMissingDetailCoverage && !storedHasArchivedDetails
        ? await hasCompletedArchiveRunForDates(db, recognitionDates)
        : false;
      const detailCoverage = classifyRecognitionCancellationDetailCoverage({
        expectedDetailCount,
        hotDetailCount,
        hasArchivedDetails: storedHasArchivedDetails,
        hasCompletedArchiveRun,
      });
      const hasArchivedDetails = detailCoverage.status === "archived";
      const hasOrphanedDetails = detailCoverage.status === "orphaned";
      const recognizedAmount = scope.results.reduce(
        (sum, result) => sum + Number(result.splitAmount || 0),
        0,
      );
      const dates = Array.from(new Set(scope.flows
        .map((flow) => normalizeDate(flow.transactionTime))
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))))
        .sort();
      const scopeLabel = getFlowRecognitionCancellationScopeLabel(scope.type);
      const canCancel = recognitionEligible
        && scope.results.length > 0
        && !hasArchivedDetails
        && !hasLockedResult
        && !hasGeneratedVoucher;
      const message = !recognitionEligible
        ? "支出流水仅供查看，不支持取消认账"
        : scope.results.length === 0
        ? `${scopeLabel}没有可取消的认账结果`
        : hasArchivedDetails
          ? `${scopeLabel}包含已归档订单明细，只能取消热区订单明细的认账`
          : hasLockedResult || hasGeneratedVoucher
          ? `${scopeLabel}存在已锁定或已生成凭证的入账结果，请先取消凭证或锁定`
          : hasOrphanedDetails
            ? `检测到订单明细已删除但残留 ${scope.results.length} 条入账结果；继续将清理残留并恢复银行流水状态`
            : `将取消${scopeLabel}的全部认账结果`;

      return {
        flowId: Number(scope.clickedFlow.id),
        referenceNo: scope.clickedFlow.referenceNo,
        scopeType: scope.type,
        scopeLabel,
        scopeFlowCount: scope.flows.length,
        scopeTaskCount: scope.taskIds.length,
        referenceNos: scope.flows.map((flow) => flow.referenceNo),
        startDate: dates[0] || "",
        endDate: dates[dates.length - 1] || "",
        recognizedAmount: recognizedAmount.toFixed(2),
        resultCount: scope.results.length,
        detailResultCount: resultPartitions.detail.length + resultPartitions.manual_detail.length,
        incomeResultCount: resultPartitions.income.length,
        manualResultCount: resultPartitions.manual_flow.length,
        hasLockedResult,
        hasGeneratedVoucher,
        hasArchivedDetails,
        hasOrphanedDetails,
        expectedDetailCount,
        hotDetailCount,
        missingDetailCount: detailCoverage.missingDetailCount,
        canCancel,
        message,
      };
    }),

  cancelFlowRecognition: authedQuery
    .input(z.object({ flowId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "manual_recognition_cancel"))) throw new Error("权限不足");
      const scope = await getFlowRecognitionCancellationScope(input.flowId);
      assertBankFlowRecognitionEligible(scope.clickedFlow.income);
      const targetResultIds = scope.results.map((result) => Number(result.id)).filter(Boolean);
      if (targetResultIds.length === 0) {
        throw new Error(`${getFlowRecognitionCancellationScopeLabel(scope.type)}没有可取消的认账结果`);
      }
      const result = await cancelRecognitionResults({
        resultIds: targetResultIds,
        affectedFlowIds: scope.flows.map((flow) => Number(flow.id)).filter(Boolean),
        requestedTaskIds: scope.taskIds,
        deferDerivedStateRefresh: true,
      });

      return {
        success: true,
        scopeType: scope.type,
        cancelledFlowCount: scope.flows.length,
        cancelledResultCount: result.cancelledResultCount,
        orphanedDetailCount: result.orphanedDetailCount,
      };
    }),

  cancelRecognitionResult: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "manual_recognition_cancel"))) throw new Error("权限不足");
      const db = getDb();
      const [selectedResult] = await db.select().from(matchResults).where(eq(matchResults.id, input.id));
      if (!selectedResult) throw new Error("入账结果不存在");
      if (selectedResult.bankFlowId) {
        const [selectedFlow] = await db.select({ income: bankFlows.income })
          .from(bankFlows)
          .where(eq(bankFlows.id, Number(selectedResult.bankFlowId)));
        if (!selectedFlow) throw new Error("银行流水不存在");
        assertBankFlowRecognitionEligible(selectedFlow.income);
      }

      const candidateResults = await db.select().from(matchResults).where(and(
        eq(matchResults.taskId, Number(selectedResult.taskId)),
        selectedResult.bankFlowId
          ? eq(matchResults.bankFlowId, Number(selectedResult.bankFlowId))
          : isNull(matchResults.bankFlowId),
      )).orderBy(asc(matchResults.id));
      const targetResults = selectRecognitionResultGroup(candidateResults, selectedResult);
      const targetResultIds = targetResults.map((result) => Number(result.id)).filter(Boolean);
      if (targetResultIds.length === 0) throw new Error("未找到可取消的认账结果");

      const kind = getRecognitionResultKind(selectedResult);
      const cancellationResult = await cancelRecognitionResults({
        resultIds: targetResultIds,
        affectedFlowIds: selectedResult.bankFlowId ? [Number(selectedResult.bankFlowId)] : [],
        requestedTaskIds: [Number(selectedResult.taskId)],
        deferDerivedStateRefresh: true,
      });

      return {
        success: true,
        cancelledResultCount: cancellationResult.cancelledResultCount,
        orphanedDetailCount: cancellationResult.orphanedDetailCount,
        recognitionKind: kind,
      };
    }),

  manualRecognizeDetail: authedQuery
    .input(z.object({
      detailId: z.number(),
      partitionDate: z.string(),
      flowId: z.number(),
      recognitionType: z.enum(["银行直捐", "渠道捐赠"]).default("渠道捐赠"),
      splits: z.array(manualRecognitionSplitInput),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const detail = await getBillDetailForManualRecognition(db, input);
      if (!detail) throw new Error("订单明细不存在");
      if (detail.matchResultId) throw new Error("该订单明细已认账");
      if (detail.detailSplitFileId) throw new Error("分账明细不能在此处手动认账");
      if (String(detail.operationStatus || "active") !== "active") throw new Error("该订单明细当前状态不能认账");
      if (String(detail.matchStatus || "") === "pending_split") throw new Error("待拆分明细请先完成拆分后再认账");

      const [flow] = await db.select().from(bankFlows).where(eq(bankFlows.id, input.flowId));
      if (!flow) throw new Error("流水不存在");
      assertBankFlowRecognitionEligible(flow.income);
      const dateTaskIds = await getDateTaskIdsByTaskId(Number(detail.taskId));
      if (!dateTaskIds.includes(Number(flow.taskId))) {
        throw new Error("请选择同一日期汇总下的银行流水");
      }
      const matchedFlows = await getManualDetailMatchedFlowsForReference(db, {
        taskId: Number(detail.taskId || 0),
        ruleId: Number(detail.ruleId || 0),
      });
      const matchedFlowIds = new Set(matchedFlows.map((item: any) => Number(item.id)));
      if (matchedFlowIds.size === 0 || !matchedFlowIds.has(Number(flow.id))) {
        throw new Error("请选择该订单明细规则匹配的银行流水");
      }

      const detailAmount = Number(detail.totalAmount || 0);
      if (!Number.isFinite(detailAmount) || toCents(detailAmount) <= 0) {
        throw new Error("该订单明细金额不能手动认账");
      }
      const [recognizedAmountResult] = await db.select({
        total: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
      }).from(matchResults).where(eq(matchResults.bankFlowId, input.flowId));
      const recognizedAmount = Number(recognizedAmountResult?.total || 0);
      const recognitionAvailableCents = Math.max(0, toCents(flow.income || 0) - toCents(recognizedAmount));
      const recognitionAvailableAmount = recognitionAvailableCents / 100;
      if (toCents(detailAmount) > recognitionAvailableCents) {
        throw new Error(`订单明细金额不能大于可认账金额 ${recognitionAvailableAmount.toFixed(2)}`);
      }

      validateManualRecognitionRequiredFields(input.splits);
      const projectCenters = await normalizeProjectCenters(db, input.splits);
      const [detailRule] = await db
        .select({ voucherReceiptChannelCode: counterpartyRecords.voucherIncomeName })
        .from(recognitionRules)
        .leftJoin(counterpartyRecords, eq(counterpartyRecords.alias, recognitionRules.matchedCounterpartyAlias))
        .where(eq(recognitionRules.id, Number(detail.ruleId || 0)))
        .limit(1);
      const voucherReceiptChannelCode = await validateVoucherReceiptChannelCode(
        db,
        detailRule?.voucherReceiptChannelCode,
      );
      const splitAmounts = calculateManualSplitAmounts(detailAmount, input.splits);
      let firstMatchResultId = 0;
      let recognizedDetailBefore: any = detail;
      const partitionDate = normalizeDate(input.partitionDate);
      await withBillDetailArchiveDateLocks([partitionDate], async () => {
        await db.transaction(async (tx) => {
          const lockedDetail = await getBillDetailForManualRecognition(tx, {
            detailId: input.detailId,
            partitionDate,
          });
          if (!lockedDetail) throw new Error("订单明细不存在");
          if (lockedDetail.archived) {
            const restored = await restoreArchivedDetailToHotTable(tx, {
              detailId: input.detailId,
              partitionDate,
            });
            if (!restored) throw new Error("归档订单明细恢复失败，请稍后重试");
          }

          const [hotDetail] = await tx.select().from(billDetails).where(and(
            eq(billDetails.id, input.detailId),
            eq(billDetails.partitionDate, partitionDate),
          ));
          if (!hotDetail) throw new Error("订单明细恢复后不存在");
          if (hotDetail.matchResultId) throw new Error("该订单明细已认账");
          if (hotDetail.detailSplitFileId) throw new Error("分账明细不能在此处手动认账");
          if (String(hotDetail.operationStatus || "active") !== "active") {
            throw new Error("该订单明细当前状态不能认账");
          }
          if (String(hotDetail.matchStatus || "") === "pending_split") {
            throw new Error("待拆分明细归档后不支持单条认账");
          }

          recognizedDetailBefore = {
            ...detail,
            ...hotDetail,
            orderFileUploadStatus: detail.orderFileUploadStatus,
            detailPackageType: detail.detailPackageType,
          };

          for (const [index, split] of input.splits.entries()) {
            const splitMode = getManualSplitMode(split.incomeType, split.donationSource);
            const bankDirectDonation = isBankDirectDonation(split);
            const resultRecognitionType = deriveManualRecognitionType(split);
            const hasNoManagementFee = splitMode === "membership" || splitMode === "interest" || splitMode === "remarkOnly";
            const managementFeeType = hasNoManagementFee ? "比例" : normalizeManagementFeeType(split.managementFeeType);
            const managementFeeValue = hasNoManagementFee ? "0" : normalizeManagementFeeValue(split.managementFeeValue ?? split.managementFeeRatio);
            const managementFeeRatio = managementFeeType === "比例" ? normalizeManagementFeeRatio(managementFeeValue) : "0";
            const derivedSplitRatio = calculateManualDerivedSplitRatio(splitAmounts[index], detailAmount);
            const result = await tx.insert(matchResults).values({
              taskId: Number(flow.taskId),
              bankFlowId: input.flowId,
              recognitionType: resultRecognitionType as any,
              incomeType: split.incomeType || null,
              donationSource: normalizeManualDonationSource(split.donationSource, split.incomeType),
              incomeAttr: split.incomeAttr || null,
              incomeDept: splitMode === "remarkOnly" ? null : split.incomeDept || null,
              budgetCode: splitMode === "remarkOnly" ? null : split.budgetCode || null,
              incomeProject: splitMode === "remarkOnly" ? null : split.incomeProject || null,
              platformProjectName: splitMode === "platform" ? split.platformProjectName || null : null,
              ...buildMatchResultDisplaySnapshot(flow, splitMode === "platform" ? split.platformProjectName || null : null),
              platformProjectDetail: splitMode === "platform" ? split.platformProjectDetail || null : null,
              memberName: splitMode === "membership" || bankDirectDonation ? split.memberName?.trim() || null : null,
              projectCenter: bankDirectDonation ? projectCenters[index] : null,
              membershipPaymentYears: splitMode === "membership" ? normalizeMembershipPaymentYears(split.membershipPaymentYears) : null,
              region: splitMode === "platform" || splitMode === "interest" || splitMode === "remarkOnly" ? null : normalizeRegion(split.region) as any,
              isAnonymous: splitMode === "membership" && split.isAnonymous ? 1 : 0,
              managementFeeType: managementFeeType as any,
              managementFeeValue,
              managementFeeRatio,
              managementFeeAmount: hasNoManagementFee ? "0.00" : calculateManagementFeeAmountByType(splitAmounts[index], managementFeeType, managementFeeValue),
              expenseFundSource: split.incomeType === "利息"
                ? interestExpenseFundSource
                : splitMode === "interest" || splitMode === "remarkOnly"
                  ? null
                : renderManualExpenseFundSource(
                  splitMode === "membership" ? split.expenseFundSource || getManualMembershipExpenseFundSource(split.budgetCode) : split.expenseFundSource,
                  flow,
                ),
              remark: splitMode === "remarkOnly" ? split.remark?.trim() || null : null,
              voucherReceiptChannelCode,
              totalAmount: detailAmount.toFixed(2),
              splitAmount: splitAmounts[index],
              splitRatio: derivedSplitRatio,
              entryTime: normalizeDate(flow.transactionTime || new Date().toISOString().slice(0, 10)),
              detailCount: index === 0 ? 1 : 0,
              orderDetailCountSnapshot: 1,
            }).$returningId();
            const resultId = Number(result[0]?.id || 0);
            if (resultId && !firstMatchResultId) firstMatchResultId = resultId;
          }
          if (!firstMatchResultId) throw new Error("创建手动认账结果失败");
          await tx.update(billDetails).set({
            matchStatus: "matched",
            matchResultId: firstMatchResultId,
          }).where(and(
            eq(billDetails.id, input.detailId),
            eq(billDetails.partitionDate, partitionDate),
          ));

          if (lockedDetail.archived) {
            const archiveTableName = `bill_details_archive_${partitionDate.slice(0, 7).replace("-", "")}`;
            await refreshArchiveRunSnapshots(tx, [archiveTableName], [partitionDate]);
          }
        });
      });

      await applyDetailSummaryDelta(recognizedDetailBefore, -1, { refreshDateSummary: false });
      await applyDetailSummaryDelta({
        ...recognizedDetailBefore,
        matchStatus: "matched",
        matchResultId: firstMatchResultId,
      }, 1, { refreshDateSummary: false });
      await refreshTaskStatusByFlows(Number(flow.taskId));
      await refreshRecognitionDateSummariesByTaskIds(Array.from(new Set([Number(detail.taskId), Number(flow.taskId)])));

      return { success: true, matchResultId: firstMatchResultId };
    }),

  cancelManualDetailRecognition: authedQuery
    .input(z.object({ detailId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "manual_recognition_cancel"))) throw new Error("权限不足");
      const db = getDb();
      const [detail] = await db.select().from(billDetails).where(eq(billDetails.id, input.detailId));
      if (!detail) throw new Error("订单明细不存在");
      const matchResultId = Number(detail.matchResultId || 0);
      if (!matchResultId) throw new Error("该订单明细尚未认账");
      const [result] = await db.select().from(matchResults).where(eq(matchResults.id, matchResultId));
      if (!result || !isManualDetailRecognitionResult(result)) {
        throw new Error("该订单明细不是手动认账，无法在此取消");
      }
      if (result.voucherStatus === "created") {
        throw new Error("该订单明细手动认账已锁定，无法取消");
      }

      const candidateResults = await db.select().from(matchResults).where(and(
        eq(matchResults.taskId, Number(result.taskId)),
        eq(matchResults.bankFlowId, Number(result.bankFlowId)),
        sql`${matchResults.ruleItemId} IS NULL`,
        sql`${matchResults.incomeRuleId} IS NULL`,
        eq(matchResults.orderDetailCountSnapshot, 1),
        sql`${matchResults.id} >= ${matchResultId}`,
      )).orderBy(asc(matchResults.id));
      const targetResults: typeof candidateResults = [];
      let targetAmountCents = 0;
      const expectedAmountCents = toCents(result.totalAmount || 0);
      for (const item of candidateResults) {
        targetResults.push(item);
        targetAmountCents += toCents(item.splitAmount || 0);
        if (targetAmountCents >= expectedAmountCents) break;
      }
      if (targetAmountCents !== expectedAmountCents) {
        throw new Error("手动认账结果不完整，无法取消");
      }
      if (targetResults.some((item) => item.voucherStatus === "created")) {
        throw new Error("该订单明细手动认账已锁定，无法取消");
      }
      const targetIds = targetResults.map((item) => Number(item.id)).filter(Boolean);
      if (targetIds.length === 0) throw new Error("未找到可取消的手动认账结果");

      await db.transaction(async (tx) => {
        await tx.update(billDetails).set({
          matchStatus: "unmatched",
          ruleItemId: null,
          matchResultId: sql`NULL`,
        }).where(eq(billDetails.id, input.detailId));
        await tx.delete(matchResults).where(inArray(matchResults.id, targetIds));
      });

      const flowId = Number(result.bankFlowId || 0);
      const [remaining] = flowId
        ? await db.select({
          total: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
        }).from(matchResults).where(eq(matchResults.bankFlowId, flowId))
        : [];
      if (flowId) {
        const [flow] = await db.select().from(bankFlows).where(eq(bankFlows.id, flowId));
        if (flow) {
          await db.update(bankFlows).set({
            recognitionStatus: deriveFlowRecognitionStatus(Number(flow.income || 0), Number(remaining?.total || 0)),
          }).where(eq(bankFlows.id, flowId));
        }
      }

      await refreshTaskDetailSummary(Number(detail.taskId));
      await refreshTaskStatusByFlows(Number(result.taskId));
      await refreshRecognitionDateSummariesByTaskIds(Array.from(new Set([Number(detail.taskId), Number(result.taskId)])));

      return { success: true };
    }),

  // 手动认账单条银行流水
  manualRecognize: authedQuery
    .input(z.object({
      flowId: z.number(),
      taskId: z.number(),
      recognitionAmount: z.string().optional(),
      recognitionType: z.enum(["银行直捐", "渠道捐赠"]).default("渠道捐赠"),
      voucherReceiptChannelCode: z.string().max(100, "收款渠道编号最长100字").nullable().optional(),
      splits: z.array(manualRecognitionSplitInput),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();

      const [flow] = await db.select().from(bankFlows).where(eq(bankFlows.id, input.flowId));
      if (!flow) throw new Error("流水不存在");
      assertBankFlowRecognitionEligible(flow.income);

      const flowIncome = Number(flow.income);
      const flowTaskId = Number(flow.taskId);
      const recognizedAmountResult = await db.select({
        total: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
      }).from(matchResults).where(eq(matchResults.bankFlowId, input.flowId));
      const recognizedAmount = Number(recognizedAmountResult[0]?.total || 0);
      const recognitionAvailableCents = getSignedRecognitionAvailableCents(flowIncome, recognizedAmount);
      const recognitionAvailableAmount = recognitionAvailableCents / 100;
      if (input.recognitionAmount === undefined || input.recognitionAmount.trim() === "") {
        throw new Error("认账金额不能为空");
      }
      const recognitionAmount = Number(input.recognitionAmount);
      if (!Number.isFinite(recognitionAmount) || toCents(recognitionAmount) === 0) {
        throw new Error("认账金额不能为0");
      }
      if (!isSignedAmountWithinAvailable(recognitionAmount, recognitionAvailableAmount)) {
        throw new Error(`认账金额必须与可认账金额同方向，且绝对值不能超过 ${recognitionAvailableAmount.toFixed(2)}`);
      }

      validateManualRecognitionRequiredFields(input.splits);
      const projectCenters = await normalizeProjectCenters(db, input.splits);
      const voucherReceiptChannelCode = await validateVoucherReceiptChannelCode(db, input.voucherReceiptChannelCode);

      // 生成 match_results
      const splitAmounts = calculateManualSplitAmounts(recognitionAmount, input.splits);
      for (const [index, split] of input.splits.entries()) {
        const splitMode = getManualSplitMode(split.incomeType, split.donationSource);
        const bankDirectDonation = isBankDirectDonation(split);
        const resultRecognitionType = deriveManualRecognitionType(split);
        const hasNoManagementFee = splitMode === "membership" || splitMode === "interest" || splitMode === "remarkOnly";
        const managementFeeType = hasNoManagementFee ? "比例" : normalizeManagementFeeType(split.managementFeeType);
        const managementFeeValue = hasNoManagementFee ? "0" : normalizeManagementFeeValue(split.managementFeeValue ?? split.managementFeeRatio);
        const managementFeeRatio = managementFeeType === "比例" ? normalizeManagementFeeRatio(managementFeeValue) : "0";
        const derivedSplitRatio = calculateManualDerivedSplitRatio(splitAmounts[index], recognitionAmount);

        await db.insert(matchResults).values({
          taskId: flowTaskId,
          bankFlowId: input.flowId,
          recognitionType: resultRecognitionType as any,
          incomeType: split.incomeType || null,
          donationSource: normalizeManualDonationSource(split.donationSource, split.incomeType),
          incomeAttr: split.incomeAttr || null,
          incomeDept: splitMode === "remarkOnly" ? null : split.incomeDept || null,
          budgetCode: splitMode === "remarkOnly" ? null : split.budgetCode || null,
          incomeProject: splitMode === "remarkOnly" ? null : split.incomeProject || null,
          platformProjectName: splitMode === "platform" ? split.platformProjectName || null : null,
          ...buildMatchResultDisplaySnapshot(flow, splitMode === "platform" ? split.platformProjectName || null : null),
          platformProjectDetail: splitMode === "platform" ? split.platformProjectDetail || null : null,
          memberName: splitMode === "membership" || bankDirectDonation ? split.memberName?.trim() || null : null,
          projectCenter: bankDirectDonation ? projectCenters[index] : null,
          membershipPaymentYears: splitMode === "membership" ? normalizeMembershipPaymentYears(split.membershipPaymentYears) : null,
          region: splitMode === "platform" || splitMode === "interest" || splitMode === "remarkOnly" ? null : normalizeRegion(split.region) as any,
          isAnonymous: splitMode === "membership" && split.isAnonymous ? 1 : 0,
          managementFeeType: managementFeeType as any,
          managementFeeValue,
          managementFeeRatio,
          managementFeeAmount: hasNoManagementFee ? "0.00" : calculateManagementFeeAmountByType(splitAmounts[index], managementFeeType, managementFeeValue),
          expenseFundSource: split.incomeType === "利息"
            ? interestExpenseFundSource
            : splitMode === "interest" || splitMode === "remarkOnly"
              ? null
            : renderManualExpenseFundSource(
              splitMode === "membership" ? split.expenseFundSource || getManualMembershipExpenseFundSource(split.budgetCode) : split.expenseFundSource,
              flow,
            ),
          remark: splitMode === "remarkOnly" ? split.remark?.trim() || null : null,
          voucherReceiptChannelCode,
          totalAmount: recognitionAmount.toFixed(2),
          splitAmount: splitAmounts[index],
          splitRatio: derivedSplitRatio,
          entryTime: normalizeDate(flow.transactionTime || new Date().toISOString().slice(0, 10)),
          detailCount: 0,
          orderDetailCountSnapshot: 0,
        });
      }

      await db.update(bankFlows)
        .set({ recognitionStatus: deriveFlowRecognitionStatus(flowIncome, recognizedAmount + recognitionAmount) })
        .where(eq(bankFlows.id, input.flowId));

      await refreshTaskStatusByFlows(flowTaskId);

      return { success: true };
    }),
});

// ====== 认账引擎核心逻辑（已导出供队列使用）======
export type ExecuteRecognitionOptions = {
  refreshUnmatchedMatches?: boolean;
  useSummaryDeltas?: boolean;
  detailSplitFileId?: number;
};

type RecognitionResultAssignment = {
  phaseIndex: number;
  ruleItemId: number;
  isRefund: boolean;
  matchResultId: number;
  detailCount: number;
};

async function bulkAssignRecognitionResults(
  db: ReturnType<typeof getDb>,
  recognitionPhaseScopes: any[],
  assignments: RecognitionResultAssignment[],
  options: { forceDetailSplitIndex?: boolean } = {},
) {
  if (assignments.length === 0) return 0;

  const assignmentRows = sql.join(
    assignments.map((assignment) => sql`
      SELECT
        ${assignment.phaseIndex} AS phase_index,
        ${assignment.ruleItemId} AS rule_item_id,
        ${assignment.isRefund ? 1 : 0} AS is_refund,
        ${assignment.matchResultId} AS match_result_id
    `),
    sql` UNION ALL `,
  );
  const assignedPhaseIndexes = Array.from(new Set(assignments.map((assignment) => assignment.phaseIndex)));
  const phaseConditions = assignedPhaseIndexes.map((phaseIndex) => sql`
    (
      recognition_assignment.phase_index = ${phaseIndex}
      AND ${recognitionPhaseScopes[phaseIndex]}
    )
  `);
  const updateTarget = options.forceDetailSplitIndex
    ? sql.raw(
      `\`bill_details\` FORCE INDEX (\`${DETAIL_SPLIT_RECOGNITION_WRITE_INDEX}\`)`,
    )
    : billDetails;
  const result = await db.execute(sql`
    UPDATE ${updateTarget}
    JOIN (${assignmentRows}) AS recognition_assignment
      ON recognition_assignment.rule_item_id = ${billDetails.ruleItemId}
      AND recognition_assignment.is_refund = CASE
        WHEN CAST(${billDetails.refundAmountSnapshot} AS DECIMAL(18,2)) > 0 THEN 1
        ELSE 0
      END
    SET
      ${billDetails.matchStatus} = 'matched',
      ${billDetails.matchResultId} = recognition_assignment.match_result_id
    WHERE ${billDetails.matchResultId} IS NULL
      AND ${billDetails.matchStatus} = 'matched'
      AND (${sql.join(phaseConditions, sql` OR `)})
  `);
  return Number((result as any)?.[0]?.affectedRows ?? (result as any)?.affectedRows ?? 0);
}

async function rollbackIncompleteRecognitionWrites(
  db: ReturnType<typeof getDb>,
  createdResultIds: number[],
) {
  const uniqueResultIds = Array.from(new Set(createdResultIds.map(Number).filter(Boolean)));
  if (uniqueResultIds.length === 0) return;
  await db.transaction(async (tx) => {
    for (const resultIdChunk of chunkRecognitionCancellationDetailIds(uniqueResultIds)) {
      await tx
        .update(billDetails)
        .set({ matchResultId: sql`NULL` })
        .where(inArray(billDetails.matchResultId, resultIdChunk));
      await tx.delete(matchResults).where(inArray(matchResults.id, resultIdChunk));
    }
  });
}

export async function executeRecognition(taskId: number, options: ExecuteRecognitionOptions = {}) {
  const db = getDb();
  const recognitionStartedAt = Date.now();
  let recognitionStageStartedAt = recognitionStartedAt;
  const logRecognitionStage = (stage: string, extra: Record<string, unknown> = {}) => {
    const now = Date.now();
    console.log("[recognition-performance]", JSON.stringify({
      taskId,
      stage,
      stageMs: now - recognitionStageStartedAt,
      totalMs: now - recognitionStartedAt,
      ...extra,
    }));
    recognitionStageStartedAt = now;
  };
  const detailSplitFileId = Number(options.detailSplitFileId || 0);
  const isDetailSplitIncrementalRecognition = detailSplitFileId > 0;

  const task = await db.query.recognitionTasks.findFirst({
    where: eq(recognitionTasks.id, taskId),
    with: { rule: { with: { items: { with: { splits: true } } } } },
  });
  if (!task) throw new Error("任务不存在");
  if (!task.rule || !task.rule.items || task.rule.items.length === 0) {
    throw new Error("请先为此任务配置认账规则");
  }

  const flowSumResult = await db.select({
    total: sql`SUM(CAST(${bankFlows.income} AS DECIMAL(18,2)))`,
    count: count(),
  }).from(bankFlows).where(and(eq(bankFlows.taskId, taskId), gt(bankFlows.income, "0")));
  let bankTotal = Number(flowSumResult[0]?.total || 0);
  let bankFlowCount = Number(flowSumResult[0]?.count || 0);
  const detailRuleId = Number(task.ruleId || 0);
  const detailPackageType = await getDetailPackageTypeForRule(detailRuleId);
  const packageDetailScope = detailPackageScopeSql(task.billDate, detailPackageType);
  const ruleItemsList = task.rule.items;
  const [detailCounterpartyRow] = task.rule.matchedCounterpartyAlias
    ? await db.select({
      id: counterpartyRecords.id,
      arrivalRegion: counterpartyRecords.arrivalRegion,
      detailMatchingMode: counterpartyRecords.detailMatchingMode,
      recognitionType: counterpartyRecords.recognitionType,
    })
      .from(counterpartyRecords)
      .where(eq(counterpartyRecords.alias, task.rule.matchedCounterpartyAlias))
    : [];
  const detailCounterparty = await attachCounterpartyMatchers(db, detailCounterpartyRow);
  const isAggregateDetailMode = isAggregateDetailCounterparty(detailCounterparty);
  if (detailCounterparty && !isAggregateDetailMode) {
    const [matchedFlowSummary] = await db.select({
      total: sql<string>`COALESCE(SUM(CAST(${bankFlows.income} AS DECIMAL(18,2))), 0.00)`,
      count: count(),
    }).from(bankFlows).where(and(
      eq(bankFlows.taskId, taskId),
      gt(bankFlows.income, "0"),
      eq(bankFlows.arrivalMatchStatus, "matched"),
      eq(bankFlows.matchedCounterpartyId, Number(detailCounterparty.id)),
    ));
    bankTotal = Number(matchedFlowSummary?.total || 0);
    bankFlowCount = Number(matchedFlowSummary?.count || 0);
  }
  const aggregateContext = isAggregateDetailMode ? await getAggregateDetailTaskContext(taskId) : null;
  const isMultiDayAggregateDetailMode = Boolean(aggregateContext?.isMultiDay);
  const aggregateContextFlows = aggregateContext?.flows || [];
  if (isAggregateDetailMode) {
    bankTotal = aggregateContextFlows.reduce((sum, flow) => sum + Number(flow.income || 0), 0);
    bankFlowCount = aggregateContextFlows.length;
  }
  const aggregateTaskIds = isAggregateDetailMode
    ? Array.from(new Set(aggregateContextFlows.map((flow) => Number(flow.taskId)).filter(Boolean)))
    : [];
  const directOrderFiles = await getDirectRecognitionOrderFiles({
    taskId,
    ruleId: detailRuleId,
    packageType: detailPackageType,
    aggregateTaskIds,
  });
  const directOrderFileIds = directOrderFiles.map((file) => file.id);
  const [currentOrderFileRecognitionSummary, directRecognitionPartitionDates, transferredDetailCounts] = await Promise.all([
    loadOrderFileRecognitionSummary(
      directOrderFiles,
      !isDetailSplitIncrementalRecognition && !options.refreshUnmatchedMatches,
    ),
    getDirectRecognitionPartitionDates(directOrderFileIds),
    isDetailSplitIncrementalRecognition
      ? Promise.resolve({ totalCount: 0, openCount: 0 })
      : getTransferredT1TaskDetailCounts(taskId, detailRuleId),
  ]);
  const hasTransferredDetails = transferredDetailCounts.totalCount > 0;
  const transferredRecognitionSummary = await loadTaskTransferRecognitionSummary({
    taskId,
    ruleId: detailRuleId,
    partitionDate: task.billDate,
    expectedOpenCount: transferredDetailCounts.openCount,
    enabled: Boolean(options.useSummaryDeltas)
      && !isDetailSplitIncrementalRecognition
      && !options.refreshUnmatchedMatches,
  });
  const baseDetailScope = directOrderFileIds.length > 0
    ? and(
      inArray(billDetails.orderFileId, directOrderFileIds),
      directRecognitionPartitionDates.length > 0
        ? inArray(billDetails.partitionDate, directRecognitionPartitionDates)
        : undefined,
    )
    : packageDetailScope;
  const transferredDetailWhere = and(
    transferredT1TaskScopeSql(taskId),
    eq(billDetails.ruleId, detailRuleId),
    excludeAbnormalOrderFilesSql(),
  );
  const detailScope = hasTransferredDetails
    ? or(baseDetailScope, transferredT1TaskScopeSql(taskId))
    : baseDetailScope;
  const currentDetailWhere = and(
    baseDetailScope,
    eq(billDetails.ruleId, detailRuleId),
    sql`COALESCE(${billDetails.operationStatus}, 'active') = 'active'`,
    directOrderFileIds.length > 0 ? undefined : excludeAbnormalOrderFilesSql(),
  );
  const activeDetailWhere = isDetailSplitIncrementalRecognition
    ? and(
      eq(billDetails.detailSplitFileId, detailSplitFileId),
      eq(billDetails.taskId, taskId),
      eq(billDetails.ruleId, detailRuleId),
      eq(billDetails.partitionDate, task.billDate),
      recognizableDetailOperationSql(),
    )
    : hasTransferredDetails
      ? or(currentDetailWhere, transferredDetailWhere)
      : currentDetailWhere;
  const recognitionPhaseScopes = isDetailSplitIncrementalRecognition
    ? [activeDetailWhere]
    : [
      currentDetailWhere,
      ...(hasTransferredDetails ? [transferredDetailWhere] : []),
    ];
  let recognitionStatsPhaseScopes = isDetailSplitIncrementalRecognition
    ? [activeDetailWhere]
    : [
      currentOrderFileRecognitionSummary.cachedOrderFileIds.length === 0
        ? currentDetailWhere
        : currentOrderFileRecognitionSummary.fallbackOrderFileIds.length > 0
          ? and(
            currentDetailWhere,
            inArray(billDetails.orderFileId, currentOrderFileRecognitionSummary.fallbackOrderFileIds),
          )
          : null,
      ...(hasTransferredDetails ? [transferredDetailWhere] : []),
    ];
  const combineRecognitionPhaseSummaries = (phases: OrderRecognitionPhaseSummary[]) => {
    const totalCents = phases.reduce((sum, phase) => sum + phase.totalCents, 0);
    return {
      phases,
      totalCents,
      total: totalCents / 100,
      count: phases.reduce((sum, phase) => sum + phase.count, 0),
    };
  };
  const summarizeRecognitionPhases = async (
    extraCondition?: any,
    currentPhaseOverride?: OrderRecognitionPhaseSummary,
  ) => {
    const phases: OrderRecognitionPhaseSummary[] = [];
    for (const [phaseIndex, phaseScope] of recognitionPhaseScopes.entries()) {
      if (phaseIndex === 0 && currentPhaseOverride && !isDetailSplitIncrementalRecognition) {
        phases.push(currentPhaseOverride);
        continue;
      }
      const [summary] = await db.select({
        total: sql<string>`COALESCE(SUM(CAST(${billDetails.totalAmount} AS DECIMAL(18,2))), 0.00)`,
        count: count(),
      }).from(billDetails).where(and(phaseScope, extraCondition));
      phases.push({
        totalCents: toCents(summary?.total || 0),
        count: Number(summary?.count || 0),
      });
    }
    return combineRecognitionPhaseSummaries(phases);
  };
  const currentRuleItemIds = new Set(ruleItemsList.map((item) => Number(item.id)));
  const hasCompleteCurrentUploadSummary = directOrderFiles.length > 0
    && !isMultiDayAggregateDetailMode
    && aggregateTaskIds.every((aggregateTaskId) => aggregateTaskId === taskId)
    && currentOrderFileRecognitionSummary.cachedFiles.length === directOrderFiles.length
    && currentOrderFileRecognitionSummary.fallbackOrderFileIds.length === 0
    && currentOrderFileRecognitionSummary.cachedFiles.every((file) => file.taskId === taskId)
    && Array.from(currentOrderFileRecognitionSummary.groups.values())
      .every((group) => currentRuleItemIds.has(group.ruleItemId));
  const hasCompleteUploadSummary = hasCompleteCurrentUploadSummary
    && !hasTransferredDetails;
  const freshOrderRecognitionPhases = deriveFreshOrderRecognitionPhaseSummaries(
    currentOrderFileRecognitionSummary.cachedFiles,
    currentOrderFileRecognitionSummary.groups.values(),
  );
  const fastPackageVariance = isDetailSplitIncrementalRecognition
    ? null
    : await tryFastPackageVarianceCheck(
      task as typeof recognitionTasks.$inferSelect & { rule?: any },
      ruleItemsList,
      isAggregateDetailMode,
    );
  if (fastPackageVariance) return fastPackageVariance;

  let detailTotal = isDetailSplitIncrementalRecognition ? 0 : Number(task.billDetailTotal || 0);
  let detailCount = isDetailSplitIncrementalRecognition ? 0 : Number(task.billDetailCount || 0);
  if (isDetailSplitIncrementalRecognition || (detailCount <= 0 && toCents(detailTotal) === 0)) {
    const detailSummary = hasCompleteUploadSummary
      ? combineRecognitionPhaseSummaries([{
        totalCents: currentOrderFileRecognitionSummary.fileSummary.totalCents,
        count: currentOrderFileRecognitionSummary.fileSummary.count,
      }])
      : await summarizeRecognitionPhases();
    detailTotal = detailSummary.total;
    detailCount = detailSummary.count;
  }
  const freshCurrentDetailPhase: OrderRecognitionPhaseSummary = {
    totalCents: toCents(detailTotal),
    count: detailCount,
  };
  const freshOpenDetailPhase: OrderRecognitionPhaseSummary = {
    totalCents: freshCurrentDetailPhase.totalCents - freshOrderRecognitionPhases.recognized.totalCents,
    count: Math.max(0, freshCurrentDetailPhase.count - freshOrderRecognitionPhases.recognized.count),
  };

  if (detailCount === 0) {
    const finalStatus = await refreshTaskStatusByFlows(taskId);
    return { success: true, status: finalStatus, matchedCount: 0, unmatchedCount: 0, ignoredCount: 0, hasVariance: false };
  }

  if (bankFlowCount === 0) {
    await db.update(recognitionTasks).set({
      status: "pending_details",
      billDetailTotal: detailTotal.toFixed(2),
      billDetailCount: detailCount,
      diffAmount: "0.00",
      matchedCount: Number(task.matchedCount || 0),
      unmatchedCount: Number(task.unmatchedCount || 0),
      pendingSplitCount: Number(task.pendingSplitCount || 0),
      completedAt: null,
      updatedAt: new Date(),
    }).where(eq(recognitionTasks.id, taskId));
    await refreshTaskDetailSummary(taskId);
    return {
      success: true,
      status: "pending_details",
      matchedCount: Number(task.matchedCount || 0),
      unmatchedCount: Number(task.unmatchedCount || 0),
      ignoredCount: 0,
      hasVariance: false,
      skipped: true,
      reason: "该任务暂无银行流水，保持待认账",
    };
  }

  const aggregateCandidateFlows = isAggregateDetailMode
    ? aggregateContextFlows
    : [];
  const [currentTaskRecognizedResult] = await db.select({
    total: sql`SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2)))`,
    detailResultCount: sql<number>`SUM(CASE WHEN ${matchResults.ruleItemId} IS NOT NULL THEN 1 ELSE 0 END)`,
    detailCount: sql<number>`SUM(CASE WHEN ${matchResults.ruleItemId} IS NOT NULL THEN COALESCE(${matchResults.detailCount}, 0) ELSE 0 END)`,
  }).from(matchResults).where(and(
    eq(matchResults.taskId, taskId),
    recognitionEligibleMatchResultWhere(),
  ));
  const currentTaskRecognizedTotalBefore = Number(currentTaskRecognizedResult?.total || 0);
  const currentTaskRecognizedDetailCountBefore = Number(currentTaskRecognizedResult?.detailCount || 0);
  const transferSummaryRuleItemsValid = Array.from(transferredRecognitionSummary.groups.values())
    .every((group) => currentRuleItemIds.has(group.ruleItemId));
  const canAttemptTransferDeltaSummary = Boolean(options.useSummaryDeltas)
    && !isAggregateDetailMode
    && !isDetailSplitIncrementalRecognition
    && !options.refreshUnmatchedMatches
    && transferredDetailCounts.openCount > 0
    && transferredRecognitionSummary.valid
    && transferSummaryRuleItemsValid;
  const [openCurrentMatchedDetail] = canAttemptTransferDeltaSummary
    && Number(currentTaskRecognizedResult?.detailResultCount || 0) > 0
    ? await db.select({ id: billDetails.id })
      .from(billDetails)
      .where(and(
        currentDetailWhere,
        isNull(billDetails.matchResultId),
        eq(billDetails.matchStatus, "matched"),
        sql`${billDetails.ruleItemId} IS NOT NULL`,
      ))
      .limit(1)
    : [null];
  const canUseTransferDeltaSummary = canAttemptTransferDeltaSummary
    && (
      Number(currentTaskRecognizedResult?.detailResultCount || 0) === 0
        ? hasCompleteCurrentUploadSummary || directOrderFiles.length === 0
        : !openCurrentMatchedDetail
    );
  const canUseFreshUploadSummary = hasCompleteUploadSummary
    && !isDetailSplitIncrementalRecognition
    && !options.refreshUnmatchedMatches
    && Number(currentTaskRecognizedResult?.detailResultCount || 0) === 0;
  const emptyRecognitionPhases = () => combineRecognitionPhaseSummaries(
    recognitionPhaseScopes.map(() => ({ totalCents: 0, count: 0 })),
  );
  const recognizedDetailSummaryBefore = isAggregateDetailMode || isDetailSplitIncrementalRecognition
    ? emptyRecognitionPhases()
    : canUseFreshUploadSummary
      ? combineRecognitionPhaseSummaries([{ totalCents: 0, count: 0 }])
      : canUseTransferDeltaSummary
        ? combineRecognitionPhaseSummaries(recognitionPhaseScopes.map((_, phaseIndex) => (
          phaseIndex === 0
            ? {
              totalCents: toCents(currentTaskRecognizedTotalBefore),
              count: currentTaskRecognizedDetailCountBefore,
            }
            : { totalCents: 0, count: 0 }
        )))
      : await summarizeRecognitionPhases(sql`${billDetails.matchResultId} IS NOT NULL`);
  const recognizedBaselineCents = isAggregateDetailMode || isDetailSplitIncrementalRecognition
    ? toCents(currentTaskRecognizedTotalBefore)
    : recognizedDetailSummaryBefore.totalCents;
  const remainingBankCents = Math.max(0, toCents(bankTotal) - recognizedBaselineCents);
  const cachedTaskOpenPhase = {
    totalCents: Math.max(0, freshCurrentDetailPhase.totalCents - recognizedBaselineCents),
    count: Math.max(0, freshCurrentDetailPhase.count - currentTaskRecognizedDetailCountBefore),
  };
  const transferOpenPhase = {
    totalCents: transferredRecognitionSummary.totalCents,
    count: transferredRecognitionSummary.count,
  };
  const currentOpenPhase = {
    totalCents: cachedTaskOpenPhase.totalCents - transferOpenPhase.totalCents,
    count: cachedTaskOpenPhase.count - transferOpenPhase.count,
  };
  const transferDeltaPhasesValid = currentOpenPhase.count >= 0;
  const currentPhaseMatchesUploadSummary = Number(currentTaskRecognizedResult?.detailResultCount || 0) > 0
    || !hasCompleteCurrentUploadSummary
    || (
      currentOpenPhase.count === currentOrderFileRecognitionSummary.fileSummary.count
      && currentOpenPhase.totalCents === currentOrderFileRecognitionSummary.fileSummary.totalCents
    );
  const useTransferDeltaSummary = canUseTransferDeltaSummary
    && transferDeltaPhasesValid
    && currentPhaseMatchesUploadSummary;
  const shouldRefreshUnmatchedMatches = Boolean(options.refreshUnmatchedMatches)
    || (
      Boolean(options.useSummaryDeltas)
      && transferredDetailCounts.openCount > 0
      && !useTransferDeltaSummary
    );
  if (useTransferDeltaSummary) {
    recognitionStatsPhaseScopes = recognitionPhaseScopes.map(() => null);
  }
  const openRecognitionSummary = canUseFreshUploadSummary
    ? combineRecognitionPhaseSummaries([freshCurrentDetailPhase])
    : useTransferDeltaSummary
      ? combineRecognitionPhaseSummaries([currentOpenPhase, transferOpenPhase])
      : await summarizeRecognitionPhases(sql`${billDetails.matchResultId} IS NULL`);
  const aggregateRecognizedRows = isAggregateDetailMode && aggregateCandidateFlows.length > 0
    ? await db
      .select({
        bankFlowId: matchResults.bankFlowId,
        total: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
      })
      .from(matchResults)
      .where(inArray(matchResults.bankFlowId, aggregateCandidateFlows.map((flow) => Number(flow.id))))
      .groupBy(matchResults.bankFlowId)
    : [];
  const aggregateRecognizedCents = aggregateRecognizedRows.reduce((sum, row) => sum + toCents(row.total || 0), 0);
  const aggregateBankCents = isAggregateDetailMode
    ? aggregateCandidateFlows.reduce((sum, flow) => sum + toCents(flow.income || 0), 0)
    : 0;
  const aggregateAvailableCents = isAggregateDetailMode
    ? Math.max(0, aggregateBankCents - aggregateRecognizedCents)
    : 0;
  const availableRecognitionCents = isAggregateDetailMode ? aggregateAvailableCents : remainingBankCents;
  const requiredRecognitionCents = openRecognitionSummary.totalCents;
  if (requiredRecognitionCents > availableRecognitionCents) {
    if (isAggregateDetailMode && aggregateCandidateFlows.length > 0) {
      await db.update(bankFlows)
        .set({ recognitionStatus: "large_variance" })
        .where(inArray(bankFlows.id, aggregateCandidateFlows.map((flow) => Number(flow.id)).filter(Boolean)));
    }
    if (isDetailSplitIncrementalRecognition) {
      const diffAmount = Math.max(0, requiredRecognitionCents - availableRecognitionCents) / 100;
      await db.update(recognitionTasks).set({
        status: "large_variance",
        diffAmount: diffAmount.toFixed(2),
        completedAt: null,
        updatedAt: new Date(),
      }).where(eq(recognitionTasks.id, taskId));
      if (!isAggregateDetailMode) {
        await db.update(bankFlows)
          .set({ recognitionStatus: "large_variance" })
          .where(and(eq(bankFlows.taskId, taskId), gt(bankFlows.income, "0")));
      }
      await refreshRecognitionDateSummariesByTaskIds([taskId]);
    } else {
      await markTaskLargeVariance(taskId, detailTotal, detailCount, (requiredRecognitionCents - availableRecognitionCents) / 100);
    }
    return {
      success: true,
      status: "large_variance",
      matchedCount: Number(task.matchedCount || 0),
      unmatchedCount: Number(task.unmatchedCount || 0),
      ignoredCount: 0,
      hasVariance: true,
      skipped: true,
      reason: "未认账订单明细金额大于剩余未认账银行流水金额，未执行明细认账",
    };
  }
  logRecognitionStage("precheck", {
    fastUploadSummary: canUseFreshUploadSummary,
    fastSummaryDeltas: useTransferDeltaSummary || (
      currentOrderFileRecognitionSummary.cachedOrderFileIds.length > 0
      && Boolean(options.useSummaryDeltas)
    ),
    directOrderFileCount: directOrderFileIds.length,
    partitionDateCount: directRecognitionPartitionDates.length,
    recognitionPhaseCount: recognitionPhaseScopes.length,
  });

  if (shouldRefreshUnmatchedMatches) {
    if (directOrderFileIds.length > 0) {
      await db.update(orderFiles)
        .set({ recognitionSummaryValid: false })
        .where(inArray(orderFiles.id, directOrderFileIds));
      await deleteSourceRecognitionSummaryDeltas(db, directOrderFileIds);
    }
    if (transferredDetailCounts.openCount > 0) {
      await deleteTargetRecognitionSummaryDeltas(db, taskId, detailRuleId, task.billDate);
    }
    await refreshPendingDetailMatches(activeDetailWhere, detailRuleId, ruleItemsList, {
      conditionRecognitionEnabled: task.rule.conditionRecognitionEnabled,
      enabled: task.rule.detailSplitEnabled,
      keywordField: task.rule.multiSplitKeywordField,
      keyword: task.rule.multiSplitKeyword,
    });
  } else {
    if (currentOrderFileRecognitionSummary.cachedOrderFileIds.length > 0) {
      // Invalidate before creating results. If recognition stops midway, retries
      // must fall back to the detail table instead of reusing the upload snapshot.
      await db.update(orderFiles)
        .set({ recognitionSummaryValid: false })
        .where(inArray(orderFiles.id, currentOrderFileRecognitionSummary.cachedOrderFileIds));
      await deleteSourceRecognitionSummaryDeltas(
        db,
        currentOrderFileRecognitionSummary.cachedOrderFileIds,
      );
    }
    if (useTransferDeltaSummary) {
      await deleteTargetRecognitionSummaryDeltas(db, taskId, detailRuleId, task.billDate);
    }
  }

  await db.update(recognitionTasks).set({ status: "processing", updatedAt: new Date() }).where(eq(recognitionTasks.id, taskId));
  await refreshRecognitionDateSummariesByTaskIds([taskId]);

  const taskBankFlows = await db.select().from(bankFlows)
    .where(and(eq(bankFlows.taskId, taskId), gt(bankFlows.income, "0")));
  const firstBankFlowId = Number(taskBankFlows[0]?.id || 0) || null;
  const firstBankFlow = taskBankFlows[0] || null;
  const bankFlowSnapshot = {
    ...buildMatchResultDisplaySnapshot(firstBankFlow, null),
    bankIncome: bankTotal.toFixed(2),
  };
  const entryTime = normalizeDate(taskBankFlows[0]?.transactionTime || task.billDate);
  const detailRegion = normalizeRegion(detailCounterparty?.arrivalRegion) as any;
  let aggregateCoveredCents = aggregateRecognizedCents;
  const aggregateTargetFlow = isMultiDayAggregateDetailMode
    ? aggregateCandidateFlows[aggregateCandidateFlows.length - 1] || firstBankFlow
    : isAggregateDetailMode
    ? aggregateCandidateFlows.find((flow) => {
      const incomeCents = toCents(flow.income || 0);
      if (aggregateCoveredCents >= incomeCents) {
        aggregateCoveredCents = Math.max(0, aggregateCoveredCents - incomeCents);
        return false;
      }
      return true;
    }) || aggregateCandidateFlows[0] || firstBankFlow
    : firstBankFlow;
  const aggregateTargetFlowId = aggregateTargetFlow ? Number(aggregateTargetFlow.id) : firstBankFlowId;
  const aggregateTargetTaskId = aggregateTargetFlow ? Number(aggregateTargetFlow.taskId) : taskId;
  const aggregateBankFlowSnapshot = aggregateTargetFlow
    ? {
      ...buildMatchResultDisplaySnapshot(aggregateTargetFlow, null),
      bankIncome: (isMultiDayAggregateDetailMode ? bankTotal : Number(aggregateTargetFlow.income || 0)).toFixed(2),
    }
    : bankFlowSnapshot;
  const aggregateEntryTime = normalizeDate(aggregateTargetFlow?.transactionTime || task.billDate);
  const recognitionResultAssignments: RecognitionResultAssignment[] = [];
  const createdRecognitionResultIds: number[] = [];
  const canUseRecognitionSummaryCache = canUseFreshUploadSummary || useTransferDeltaSummary;
  const useCurrentCachedGroups = canUseFreshUploadSummary
    || (
      useTransferDeltaSummary
      && Number(currentTaskRecognizedResult?.detailResultCount || 0) === 0
      && hasCompleteCurrentUploadSummary
    );

  // 上传摘要不可用时，每个明细来源阶段只做一次分组查询，同时取回收入和退款，
  // 不再按规则条件、退款类型分别重复扫描 bill_details。
  const fallbackRecognitionGroupsByPhase = new Map<number, Map<string, {
    totalCents: number;
    detailCount: number;
  }>>();
  for (const [phaseIndex, statsPhaseScope] of recognitionStatsPhaseScopes.entries()) {
    if (!statsPhaseScope) continue;
    const refundGroupSql = sql<number>`CASE
      WHEN CAST(${billDetails.refundAmountSnapshot} AS DECIMAL(18,2)) > 0 THEN 1
      ELSE 0
    END`;
    const rows = await db.select({
      ruleItemId: billDetails.ruleItemId,
      isRefund: refundGroupSql,
      total: sql<string>`COALESCE(SUM(CAST(${billDetails.totalAmount} AS DECIMAL(18,2))), 0.00)`,
      detailCount: count(),
    }).from(billDetails).where(and(
      statsPhaseScope,
      sql`${billDetails.matchResultId} IS NULL`,
      eq(billDetails.matchStatus, "matched"),
      sql`${billDetails.ruleItemId} IS NOT NULL`,
    )).groupBy(billDetails.ruleItemId, refundGroupSql);
    const groups = new Map<string, { totalCents: number; detailCount: number }>();
    for (const row of rows) {
      const ruleItemId = Number(row.ruleItemId || 0);
      if (!ruleItemId) continue;
      groups.set(orderRecognitionSummaryKey(ruleItemId, Number(row.isRefund || 0) === 1), {
        totalCents: toCents(row.total || 0),
        detailCount: Number(row.detailCount || 0),
      });
    }
    fallbackRecognitionGroupsByPhase.set(phaseIndex, groups);
  }

  // 5. 金额检查通过后顺序执行：先认当前订单明细，再认转移订单；两阶段复用同一金额基准与目标流水。
  for (const [phaseIndex] of recognitionPhaseScopes.entries()) {
    if ((openRecognitionSummary.phases[phaseIndex]?.count || 0) === 0) continue;
    for (const item of ruleItemsList) {
      const splits = item.splits || [];

      for (const isRefundGroup of [false, true]) {
        const cachedGroup = phaseIndex === 0 && useCurrentCachedGroups
          ? currentOrderFileRecognitionSummary.groups.get(orderRecognitionSummaryKey(item.id, isRefundGroup))
          : phaseIndex === 1 && useTransferDeltaSummary
            ? transferredRecognitionSummary.groups.get(orderRecognitionSummaryKey(item.id, isRefundGroup))
            : undefined;
        let recognitionGroupCents = cachedGroup?.totalCents || 0;
        let matchedCount = cachedGroup?.detailCount || 0;
        const fallbackGroup = fallbackRecognitionGroupsByPhase.get(phaseIndex)
          ?.get(orderRecognitionSummaryKey(item.id, isRefundGroup));
        if (fallbackGroup) {
          recognitionGroupCents += fallbackGroup.totalCents;
          matchedCount += fallbackGroup.detailCount;
        }
        const recognitionGroupTotal = recognitionGroupCents / 100;
        if (matchedCount === 0 || recognitionGroupCents === 0) continue;

        let firstMatchResultId: number | null = null;
        const resultIncomeType = () => isRefundGroup ? "订单退款" : "捐赠收入";
        const resultDonationSource = () => isRefundGroup ? null : "互联网募捐平台";

      if (isAggregateDetailMode && splits.length === 0) {
        const result = await db.insert(matchResults).values({
          taskId: aggregateTargetTaskId,
          ruleItemId: item.id,
          bankFlowId: aggregateTargetFlowId,
          recognitionType: "渠道捐赠",
          incomeType: resultIncomeType(),
          donationSource: resultDonationSource(),
          ...aggregateBankFlowSnapshot,
          region: detailRegion,
          totalAmount: recognitionGroupTotal.toFixed(2),
          splitAmount: recognitionGroupTotal.toFixed(2),
          splitRatio: "100",
          detailCount: matchedCount,
          orderDetailCountSnapshot: matchedCount,
          entryTime: aggregateEntryTime,
        }).$returningId();
        firstMatchResultId = Number(result[0]?.id) || null;
        if (firstMatchResultId) createdRecognitionResultIds.push(firstMatchResultId);
      } else if (isAggregateDetailMode) {
        const splitAmounts = splitAmountByRatios(recognitionGroupTotal, splits.map((split) => normalizeSplitRatio(split.splitRatio || "100")));
        for (const [index, split] of splits.entries()) {
          const managementFeeRatio = normalizeManagementFeeRatio(split.managementFeeRatio);
          const result = await db.insert(matchResults).values({
            taskId: aggregateTargetTaskId,
            ruleItemId: item.id,
            bankFlowId: aggregateTargetFlowId,
            recognitionType: "渠道捐赠",
            incomeType: resultIncomeType(),
            donationSource: resultDonationSource(),
            incomeAttr: split.incomeAttr,
            incomeDept: split.incomeDept,
            budgetCode: split.budgetCode,
            incomeProject: split.incomeProject,
            platformProjectName: split.platformProjectName,
            ...aggregateBankFlowSnapshot,
            platformProjectDisplayName: split.platformProjectName || null,
            platformProjectDetail: split.platformProjectDetail,
            region: detailRegion,
            managementFeeRatio,
            managementFeeAmount: calculateManagementFeeAmount(splitAmounts[index], managementFeeRatio),
            expenseFundSource: split.expenseFundSource,
            totalAmount: recognitionGroupTotal.toFixed(2),
            splitAmount: splitAmounts[index],
            splitRatio: normalizeSplitRatio(split.splitRatio),
            detailCount: index === 0 ? matchedCount : 0,
            orderDetailCountSnapshot: matchedCount,
            entryTime: aggregateEntryTime,
          }).$returningId();
          const mrId = Number(result[0]?.id) || null;
          if (mrId) createdRecognitionResultIds.push(mrId);
          if (mrId && !firstMatchResultId) firstMatchResultId = mrId;
        }
      } else if (splits.length === 0) {
        const result = await db.insert(matchResults).values({
          taskId, ruleItemId: item.id,
          bankFlowId: firstBankFlowId,
          recognitionType: "渠道捐赠",
          incomeType: resultIncomeType(),
          donationSource: resultDonationSource(),
          ...bankFlowSnapshot,
          region: detailRegion,
          totalAmount: recognitionGroupTotal.toFixed(2),
          splitAmount: recognitionGroupTotal.toFixed(2),
          splitRatio: "100",
          detailCount: matchedCount,
          orderDetailCountSnapshot: matchedCount,
          entryTime,
        }).$returningId();
        firstMatchResultId = Number(result[0]?.id) || null;
        if (firstMatchResultId) createdRecognitionResultIds.push(firstMatchResultId);
      } else {
        const splitAmounts = splitAmountByRatios(recognitionGroupTotal, splits.map((split) => normalizeSplitRatio(split.splitRatio || "100")));
        for (const [index, split] of splits.entries()) {
          const managementFeeRatio = normalizeManagementFeeRatio(split.managementFeeRatio);
          const result = await db.insert(matchResults).values({
            taskId, ruleItemId: item.id,
            bankFlowId: firstBankFlowId,
            recognitionType: "渠道捐赠",
            incomeType: resultIncomeType(),
            donationSource: resultDonationSource(),
            incomeAttr: split.incomeAttr,
            incomeDept: split.incomeDept,
            budgetCode: split.budgetCode,
            incomeProject: split.incomeProject,
            platformProjectName: split.platformProjectName,
            ...bankFlowSnapshot,
            platformProjectDisplayName: split.platformProjectName || null,
            platformProjectDetail: split.platformProjectDetail,
            region: detailRegion,
            managementFeeRatio,
            managementFeeAmount: calculateManagementFeeAmount(splitAmounts[index], managementFeeRatio),
            expenseFundSource: split.expenseFundSource,
            totalAmount: recognitionGroupTotal.toFixed(2),
            splitAmount: splitAmounts[index],
            splitRatio: normalizeSplitRatio(split.splitRatio),
            detailCount: index === 0 ? matchedCount : 0,
            orderDetailCountSnapshot: matchedCount,
            entryTime,
          }).$returningId();
          const mrId = Number(result[0]?.id) || null;
          if (mrId) createdRecognitionResultIds.push(mrId);
          if (mrId && !firstMatchResultId) firstMatchResultId = mrId;
        }
      }

      if (!firstMatchResultId) continue;
      recognitionResultAssignments.push({
        phaseIndex,
        ruleItemId: Number(item.id),
        isRefund: isRefundGroup,
        matchResultId: firstMatchResultId,
        detailCount: matchedCount,
      });
      }
    }
  }
  const bulkUpdatedDetailCount = await bulkAssignRecognitionResults(
    db,
    recognitionPhaseScopes,
    recognitionResultAssignments,
    { forceDetailSplitIndex: isDetailSplitIncrementalRecognition },
  );
  const recognitionWriteCoverage = summarizeRecognitionWriteCoverage(
    recognitionResultAssignments,
    bulkUpdatedDetailCount,
  );
  logRecognitionStage("result-writes", {
    fastUploadSummary: canUseFreshUploadSummary,
    resultAssignmentCount: recognitionResultAssignments.length,
    bulkUpdateStatementCount: recognitionResultAssignments.length > 0 ? 1 : 0,
    expectedBulkUpdateDetailCount: recognitionWriteCoverage.expectedDetailCount,
    bulkUpdatedDetailCount,
    cachedRecognizedDetailCount: canUseFreshUploadSummary
      ? freshOrderRecognitionPhases.recognized.count
      : undefined,
  });
  if (!recognitionWriteCoverage.isComplete) {
    try {
      await rollbackIncompleteRecognitionWrites(db, createdRecognitionResultIds);
    } catch (rollbackError) {
      console.error("[recognition-performance] 入账明细数量变化后的自动回滚失败", {
        taskId,
        createdRecognitionResultIds,
        expectedDetailCount: recognitionWriteCoverage.expectedDetailCount,
        updatedDetailCount: recognitionWriteCoverage.updatedDetailCount,
        rollbackError,
      });
      throw new Error("订单明细在认账期间发生变化，自动回滚失败，请联系管理员处理");
    }
    logRecognitionStage("result-write-rollback", {
      createdResultCount: createdRecognitionResultIds.length,
      expectedDetailCount: recognitionWriteCoverage.expectedDetailCount,
      updatedDetailCount: recognitionWriteCoverage.updatedDetailCount,
    });
    throw new Error(RECOGNITION_DETAILS_CHANGED_MESSAGE);
  }

  if (
    !isDetailSplitIncrementalRecognition
    &&
    task.rule.conditionRecognitionEnabled === false
    && detailPackageType === "打包明细"
    && String(task.rule.matchedCounterpartyAlias || "").trim()
  ) {
    await recognizeRemainingFastPackageRuleDetails(
      taskId,
      task.billDate,
      String(task.rule.matchedCounterpartyAlias || "").trim(),
      isMultiDayAggregateDetailMode ? aggregateTargetFlowId : firstBankFlowId,
      isMultiDayAggregateDetailMode ? aggregateBankFlowSnapshot : bankFlowSnapshot,
      detailRegion,
      isMultiDayAggregateDetailMode ? aggregateEntryTime : entryTime,
    );
  }

  if (!canUseRecognitionSummaryCache) {
    await db.execute(sql`
      UPDATE bill_details source_detail
      JOIN (
        SELECT split_source_detail_id, MIN(match_result_id) AS match_result_id
        FROM bill_details
        WHERE rule_id = ${detailRuleId}
          ${isDetailSplitIncrementalRecognition ? sql`AND detail_split_file_id = ${detailSplitFileId} AND task_id = ${taskId}` : sql``}
          AND split_source_detail_id IS NOT NULL
          AND match_result_id IS NOT NULL
        GROUP BY split_source_detail_id
      ) recognized_split ON recognized_split.split_source_detail_id = source_detail.id
      SET source_detail.match_result_id = recognized_split.match_result_id
      WHERE source_detail.rule_id = ${detailRuleId}
        ${isDetailSplitIncrementalRecognition ? sql`AND source_detail.task_id = ${taskId}` : sql``}
        AND (
          source_detail.operation_status = 'split_replaced'
          OR (
            source_detail.operation_status = 'ignored'
            AND source_detail.ignore_reason LIKE '已按明细分账拆分认账%'
          )
        )
        AND source_detail.match_result_id IS NULL
    `);
  }
  await syncManualOrderWorkItemsByTaskIds(db, [taskId]);

  const [cachedRecognizedTaskSummary] = useTransferDeltaSummary
    ? await db.select({
      total: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
      detailCount: sql<number>`COALESCE(SUM(CASE WHEN ${matchResults.ruleItemId} IS NOT NULL THEN ${matchResults.detailCount} ELSE 0 END), 0)`,
    }).from(matchResults).where(and(
      eq(matchResults.taskId, taskId),
      recognitionEligibleMatchResultWhere(),
    ))
    : [null as any];
  const recognizedDetailSummary = canUseFreshUploadSummary
    ? combineRecognitionPhaseSummaries([freshOrderRecognitionPhases.recognized])
    : useTransferDeltaSummary
      ? combineRecognitionPhaseSummaries([{
        totalCents: toCents(cachedRecognizedTaskSummary?.total || 0),
        count: Number(cachedRecognizedTaskSummary?.detailCount || 0),
      }])
      : await summarizeRecognitionPhases(sql`${billDetails.matchResultId} IS NOT NULL`);
  const recognizedDetailTotal = recognizedDetailSummary.total;
  const recognizedDetailCount = recognizedDetailSummary.count;
  const openDetailSummary = canUseFreshUploadSummary
    ? combineRecognitionPhaseSummaries([freshOpenDetailPhase])
    : useTransferDeltaSummary
      ? combineRecognitionPhaseSummaries([{
        totalCents: Math.max(0, toCents(detailTotal) - recognizedDetailSummary.totalCents),
        count: Math.max(0, detailCount - recognizedDetailSummary.count),
      }])
      : await summarizeRecognitionPhases(sql`${billDetails.matchResultId} IS NULL`);
  const openDetailCount = openDetailSummary.count;
  const currentTaskDetailSummary = canUseFreshUploadSummary
    ? combineRecognitionPhaseSummaries([
      aggregateTargetTaskId === taskId
        ? freshOrderRecognitionPhases.recognized
        : { totalCents: 0, count: 0 },
    ])
    : useTransferDeltaSummary
      ? recognizedDetailSummary
    : await summarizeRecognitionPhases(and(
      sql`${billDetails.matchResultId} IS NOT NULL`,
      sql`EXISTS (SELECT 1 FROM match_results mr_task WHERE mr_task.id = ${billDetails.matchResultId} AND mr_task.task_id = ${taskId})`,
    ));
  const currentTaskDetailCount = currentTaskDetailSummary.count;
  if (isDetailSplitIncrementalRecognition) {
    await syncTaskFlowRecognitionStatus(taskId);
    return {
      success: true,
      status: recognizedDetailCount > 0 ? "partial_matched" as const : "pending_details" as const,
      matchedCount: recognizedDetailCount,
      unmatchedCount: openDetailCount,
      ignoredCount: 0,
      hasVariance: false,
    };
  }
  const isFastPackageTask = task.rule.conditionRecognitionEnabled === false
    && detailPackageType === "打包明细"
    && Boolean(String(task.rule.matchedCounterpartyAlias || "").trim());
  const [fastPackageDetailSummary] = isFastPackageTask
    ? await db.select({
      total: sql<string>`COALESCE(SUM(CAST(${orderFiles.orderTotalAmount} AS DECIMAL(18,2)) - CAST(${orderFiles.refundAmount} AS DECIMAL(18,2))), 0.00)`,
      count: sql<number>`COALESCE(SUM(${orderFiles.entryCount}), 0)`,
      pendingSplitCount: sql<number>`COALESCE(SUM(${orderFiles.pendingSplitCount}), 0)`,
    }).from(orderFiles)
      .leftJoin(recognitionRules, eq(recognitionRules.id, orderFiles.ruleId))
      .where(and(
        eq(recognitionRules.matchedCounterpartyAlias, String(task.rule.matchedCounterpartyAlias || "").trim()),
        eq(orderFiles.detailPackageType, "打包明细"),
        eq(orderFiles.uploadDate, task.billDate),
        sql`${orderFiles.uploadStatus} <> 'abnormal'`,
      ))
    : [null as any];
  const [fastPackageRecognizedSummary] = isFastPackageTask
    ? await db.select({
      total: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
      detailCount: sql<number>`COALESCE(SUM(${matchResults.detailCount}), 0)`,
    }).from(matchResults).where(and(
      eq(matchResults.taskId, taskId),
      recognitionEligibleMatchResultWhere(),
    ))
    : [null as any];
  const fastPackageDetailTotal = Number(fastPackageDetailSummary?.total || 0);
  const fastPackageDetailCount = Number(fastPackageDetailSummary?.count || 0);
  const fastPackageRecognizedTotal = Number(fastPackageRecognizedSummary?.total || 0);
  const fastPackageRecognizedCount = Number(fastPackageRecognizedSummary?.detailCount || 0);
  const isExactCompletePackage = isFastPackageTask
    ? toCents(fastPackageRecognizedTotal) === toCents(bankTotal)
      && toCents(fastPackageRecognizedTotal) === toCents(fastPackageDetailTotal)
      && fastPackageDetailCount > 0
    : isAggregateDetailMode
    ? toCents(recognizedDetailTotal) === toCents(detailTotal) && openDetailCount === 0
    : toCents(recognizedDetailTotal) >= toCents(bankTotal) && openDetailCount === 0;

  if (isAggregateDetailMode && aggregateCandidateFlows.length > 0) {
    await syncAggregateDetailTaskFlowRecognitionStatus(taskId);
  } else if (isExactCompletePackage) {
    await db.update(bankFlows)
      .set({ recognitionStatus: "recognized" })
      .where(and(eq(bankFlows.taskId, taskId), gt(bankFlows.income, "0")));
  }

  const [ignoredResult] = canUseRecognitionSummaryCache
    ? [{ count: 0 }]
    : await db.select({ count: count() }).from(billDetails).where(
      and(
        eq(billDetails.ruleId, detailRuleId),
        detailScope,
        sql`(${billDetails.operationStatus} = 'ignored' OR ${billDetails.operationStatus} = 'split_replaced')`,
      )
    );
  const ignoredCount = Number(ignoredResult?.count || 0);
  const finalStatus: "pending_details" | "partial_matched" | "completed" = isExactCompletePackage
    ? "completed"
    : (isAggregateDetailMode ? currentTaskDetailCount : recognizedDetailCount) > 0
      ? "partial_matched"
      : "pending_details";
  const sourceDetailWhere = and(
    eq(billDetails.taskId, taskId),
    detailScope,
    eq(billDetails.ruleId, detailRuleId),
    isNull(billDetails.detailSplitFileId),
    sql`(
      ${recognizableDetailOperationSql()}
      OR ${billDetails.operationStatus} = 'split_replaced'
      OR ${billDetails.ignoreReason} LIKE '已按明细分账拆分认账%'
    )`,
    excludeAbnormalOrderFilesSql(),
  );
  const [sourceDetailSummary] = canUseRecognitionSummaryCache
    ? [{
      total: detailTotal.toFixed(2),
      count: detailCount,
      matchedCount: recognizedDetailCount,
      unmatchedCount: Number(task.unmatchedCount || 0),
      pendingSplitCount: Number(task.pendingSplitCount || 0),
    }]
    : await db.select({
      total: sql<string>`COALESCE(SUM(CAST(${billDetails.totalAmount} AS DECIMAL(18,2))), 0.00)`,
      count: count(),
      matchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchResultId} IS NOT NULL THEN 1 ELSE 0 END)`,
      unmatchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'unmatched' AND ${recognizableDetailOperationSql()} THEN 1 ELSE 0 END)`,
      pendingSplitCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'pending_split' AND ${billDetails.matchResultId} IS NULL AND ${recognizableDetailOperationSql()} THEN 1 ELSE 0 END)`,
    }).from(billDetails).where(sourceDetailWhere);
  const sourceDetailTotal = Number(sourceDetailSummary?.total || 0);
  const sourceDetailCount = Number(sourceDetailSummary?.count || 0);
  const sourceMatchedCount = Number(sourceDetailSummary?.matchedCount || 0);
  const sourceUnmatchedCount = Number(sourceDetailSummary?.unmatchedCount || 0);
  const sourcePendingSplitCount = Number(sourceDetailSummary?.pendingSplitCount || 0);
  const taskBillDetailTotal = isFastPackageTask
    ? fastPackageDetailTotal
    : sourceDetailTotal;
  const taskBillDetailCount = isFastPackageTask
    ? fastPackageDetailCount
    : sourceDetailCount;
  const taskMatchedCount = isFastPackageTask
    ? fastPackageRecognizedCount
    : sourceMatchedCount;
  const taskUnmatchedCount = isFastPackageTask
    ? Math.max(0, fastPackageDetailCount - fastPackageRecognizedCount)
    : sourceUnmatchedCount;
  const taskPendingSplitCount = isFastPackageTask
    ? Number(fastPackageDetailSummary?.pendingSplitCount || 0)
    : sourcePendingSplitCount;
  const diffAmount = isFastPackageTask
    ? Math.max(0, toCents(bankTotal) - toCents(fastPackageDetailTotal)) / 100
    : isAggregateDetailMode
    ? Math.max(0, toCents(detailTotal) - aggregateAvailableCents) / 100
    : toCents(bankTotal) > toCents(detailTotal) ? (toCents(bankTotal) - toCents(detailTotal)) / 100 : 0;

  await syncTaskFlowRecognitionStatus(taskId);

  await db.update(recognitionTasks).set({
    status: finalStatus,
    billDetailTotal: taskBillDetailTotal.toFixed(2),
    billDetailCount: taskBillDetailCount,
    diffAmount: diffAmount.toFixed(2),
    matchedCount: taskMatchedCount,
    unmatchedCount: taskUnmatchedCount,
    pendingSplitCount: taskPendingSplitCount,
    updatedAt: new Date(),
    completedAt: finalStatus === "completed" ? new Date() : null,
  }).where(eq(recognitionTasks.id, taskId));
  if (isAggregateDetailMode && aggregateCandidateFlows.length > 0) {
    const statusTaskIds = Array.from(new Set(aggregateCandidateFlows.map((flow) => Number(flow.taskId)).filter(Boolean)));
    if (!canUseRecognitionSummaryCache) {
      const sourceTaskRows = await db
        .select({ taskId: billDetails.taskId })
        .from(billDetails)
        .where(and(
          detailScope,
          eq(billDetails.ruleId, detailRuleId),
          isNull(billDetails.detailSplitFileId),
          excludeAbnormalOrderFilesSql(),
        ))
        .groupBy(billDetails.taskId);
      for (const sourceTaskId of sourceTaskRows.map((row) => Number(row.taskId)).filter(Boolean)) {
        await refreshTaskDetailSummary(sourceTaskId);
      }
    }
    for (const statusTaskId of statusTaskIds) {
      await refreshTaskStatusByFlows(statusTaskId);
    }
  } else {
    await refreshRecognitionDateSummariesByTaskIds([taskId]);
  }

  logRecognitionStage("finalize", {
    fastUploadSummary: canUseFreshUploadSummary,
    fastSummaryDeltas: useTransferDeltaSummary
      || (canUseFreshUploadSummary && Boolean(options.useSummaryDeltas)),
    finalStatus,
    matchedCount: taskMatchedCount,
    unmatchedCount: taskUnmatchedCount,
  });
  return { success: true, status: finalStatus, matchedCount: taskMatchedCount, unmatchedCount: taskUnmatchedCount, ignoredCount, hasVariance: false };
}
