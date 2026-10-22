import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { incomeRecognitionRules, incomeRuleSplits, bankFlows, matchResults, recognitionTasks, counterpartyRecords, voucherReceiptChannels } from "@db/schema";
import { eq, and, or, asc, desc, count, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { assertBankFlowRecognitionEligible } from "./lib/bankFlowRecognitionEligibility";
import {
  calculateManagementFeeAmountByType,
  deriveFlowRecognitionStatus,
  formatCents,
  getSignedRecognitionAvailableCents,
  splitAmountByRatios,
  toCents,
} from "./lib/splitAmounts";
import { buildMatchResultDisplaySnapshot } from "./lib/matchResultSnapshot";
import { refreshRecognitionDateSummariesByTaskIds } from "./lib/recognitionDateSummary";
import { userHasPermission } from "./lib/permissions";
import {
  isBankDirectDonation,
  normalizeProjectCenters,
  validateMemberProjectCenterRequirement,
} from "./lib/projectCenter";
import {
  incomeRuleSplitFormValues,
  normalizeIncomeRuleSplitForm,
  resolveIncomeRuleSplitForm,
  validateIncomeRuleRecognitionAmounts,
} from "./lib/incomeRuleSplitForm";
import { resolveIncomeRuleRecognitionRegion } from "./lib/incomeRuleRegion";
import { attachCounterpartyMatchers, getPrimaryCounterpartyMatcher } from "./lib/counterpartyMatchers";
import {
  buildUploadedIncomeRecognitionRuleLookups,
  chunkUploadedIncomeRecognitionCandidates,
  type UploadedIncomeRecognitionCandidate,
} from "./lib/uploadedIncomeRecognition";

const donationSourceValues = ["互联网募捐平台", "银行直捐", "拍卖"] as const;
const simpleIncomeTypes = ["政府补助", "利息", "个税返还", "本金", "投资收益"];
const remarkOnlyIncomeTypes = ["其他收入", "其他"];
const interestExpenseFundSource = "非限定性-利息收入";
type IncomeRuleSplitMode = "platform" | "direct" | "membership" | "interest" | "remarkOnly";

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

function normalizeSplitRatio(value?: string | null) {
  const parsed = parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : "0";
}

function normalizeRecognitionType(value?: string | null) {
  return value === "银行直捐" ? "银行直捐" : "渠道捐赠";
}

function normalizeDonationSource(value?: string | null, incomeType?: string | null) {
  if (incomeType !== "捐赠收入") return null;
  return donationSourceValues.includes(value as (typeof donationSourceValues)[number]) ? value : null;
}

function getIncomeRuleSplitMode(incomeType?: string | null, donationSource?: string | null): IncomeRuleSplitMode {
  if (remarkOnlyIncomeTypes.includes(String(incomeType || ""))) return "remarkOnly";
  if (simpleIncomeTypes.includes(String(incomeType || ""))) return "interest";
  if (incomeType === "会费收入") return "membership";
  const normalizedDonationSource = normalizeDonationSource(donationSource, incomeType);
  if (normalizedDonationSource === "互联网募捐平台") return "platform";
  return "direct";
}

function hasManagementFeeInput(split: { managementFeeValue?: string | null; managementFeeRatio?: string | null }) {
  return String(split.managementFeeValue ?? split.managementFeeRatio ?? "").trim() !== "";
}

function renderIncomeExpenseFundSource(template: string | null | undefined, flow: any) {
  return String(template || "").replace(/\[到账户名\]/g, flow.counterpartyName || "");
}

function getMembershipExpenseFundSource(budgetCode?: string | null) {
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

function calculateDerivedSplitRatio(splitAmount: number | string, totalAmount: number | string) {
  const totalCents = toCents(totalAmount);
  if (totalCents === 0) return "0";
  return ((toCents(splitAmount) * 100) / totalCents).toFixed(2);
}

function validateIncomeRuleSplits(
  splits: Array<{
    splitForm?: string | null;
    splitRatio: string;
    incomeType?: string | null;
    donationSource?: string | null;
    incomeAttr?: string | null;
    remark?: string | null;
    incomeDept?: string | null;
    budgetCode?: string | null;
    incomeProject?: string | null;
    platformProjectName?: string | null;
    platformProjectDetail?: string | null;
    feedbackType?: string | null;
    region?: string | null;
    memberName?: string | null;
    projectCenter?: string | null;
    managementFeeValue?: string | null;
    managementFeeRatio?: string | null;
    expenseFundSource?: string | null;
  }>,
) {
  const splitForm = resolveIncomeRuleSplitForm(splits);
  if (splitForm === "百分比") {
    const totalRatio = splits.reduce((sum, s) => sum + Number(normalizeSplitRatio(s.splitRatio)), 0);
    if (totalRatio !== 100) {
      throw new Error(`分账比例总和必须等于100%，当前为${totalRatio}%`);
    }
  }

  splits.forEach((split, index) => {
    const mode = getIncomeRuleSplitMode(split.incomeType, split.donationSource);
    if (split.incomeType === "捐赠收入" && !normalizeDonationSource(split.donationSource, split.incomeType)) {
      throw new Error(`分账 ${index + 1} 捐赠来源不能为空`);
    }
    if (!split.incomeAttr?.trim()) {
      throw new Error(`分账 ${index + 1} 收入属性不能为空`);
    }
    if (mode !== "remarkOnly" && !split.incomeDept?.trim()) {
      throw new Error(`分账 ${index + 1} 收入部门不能为空`);
    }
    if (mode !== "remarkOnly" && !split.budgetCode?.trim()) {
      throw new Error(`分账 ${index + 1} 预算编码不能为空`);
    }
    if (mode !== "remarkOnly" && !split.incomeProject?.trim()) {
      throw new Error(`分账 ${index + 1} NC项目名称不能为空`);
    }
    if (mode === "platform" && !split.platformProjectName?.trim()) {
      throw new Error(`分账 ${index + 1} 平台项目名称不能为空`);
    }
    if (mode === "platform" && !split.platformProjectDetail?.trim()) {
      throw new Error(`分账 ${index + 1} 平台项目详情不能为空`);
    }
    if (mode !== "platform" && mode !== "interest" && mode !== "remarkOnly" && !split.feedbackType) {
      throw new Error(`分账 ${index + 1} 反馈类型不能为空`);
    }
    if (mode !== "platform" && mode !== "interest" && mode !== "remarkOnly" && !isBankDirectDonation(split) && !split.region) {
      throw new Error(`分账 ${index + 1} 地区不能为空`);
    }
    if (mode === "membership" && !split.memberName?.trim()) {
      throw new Error(`分账 ${index + 1} 会员姓名不能为空`);
    }
    validateMemberProjectCenterRequirement(split, `分账 ${index + 1} `);
    if (mode !== "membership" && mode !== "interest" && mode !== "remarkOnly" && !hasManagementFeeInput(split)) {
      throw new Error(`分账 ${index + 1} 管理费不能为空`);
    }
    if (mode !== "membership" && mode !== "interest" && mode !== "remarkOnly" && !split.expenseFundSource?.trim()) {
      throw new Error(`分账 ${index + 1} 支出资金来源不能为空`);
    }
  });
}

const incomeRuleSplitSchema = z.object({
  splitForm: z.enum(incomeRuleSplitFormValues).optional().default("百分比"),
  splitRatio: z.string(),
  incomeType: z.string().nullable().optional(),
  donationSource: z.enum(donationSourceValues).nullable().optional(),
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
  region: z.enum(["北京市", "外省市", "港澳台", "境外", "内部客商"]).nullable().optional(),
  isAnonymous: z.boolean().optional().default(false),
  managementFeeType: z.enum(["比例", "金额"]).nullable().optional(),
  managementFeeValue: z.string().nullable().optional(),
  managementFeeRatio: z.string().nullable().optional(),
  expenseFundSource: z.string().nullable().optional(),
});

const incomeRuleImportSchema = z.object({
  ruleName: z.string().min(1, "规则名称不能为空").max(200),
  matchedCounterpartyAlias: z.string().nullable().optional(),
  recognitionType: z.enum(["银行直捐", "渠道捐赠"]).optional().default("渠道捐赠"),
  accountName: z.string().nullable().optional(),
  purpose: z.string().nullable().optional(),
  postScript: z.string().nullable().optional(),
  isActive: z.boolean().optional().default(true),
  splits: z.array(incomeRuleSplitSchema),
});

type IncomeRuleSplitFieldInput = {
  incomeType?: string | null;
  donationSource?: string | null;
  incomeAttr?: string | null;
  remark?: string | null;
  incomeDept?: string | null;
  budgetCode?: string | null;
  incomeProject?: string | null;
  platformProjectName?: string | null;
  platformProjectDetail?: string | null;
  feedbackType?: string | null;
  memberName?: string | null;
  projectCenter?: string | null;
  region?: string | null;
  isAnonymous?: boolean | number | null;
  managementFeeType?: string | null;
  managementFeeValue?: string | null;
  managementFeeRatio?: string | null;
  expenseFundSource?: string | null;
};

function buildIncomeRuleSplitFields(split: IncomeRuleSplitFieldInput) {
  const mode = getIncomeRuleSplitMode(split.incomeType, split.donationSource);
  const bankDirectDonation = isBankDirectDonation(split);
  const hasNoManagementFee = mode === "membership" || mode === "interest" || mode === "remarkOnly";
  const managementFeeType = hasNoManagementFee ? "比例" : normalizeManagementFeeType(split.managementFeeType);
  const managementFeeValue = hasNoManagementFee ? "0.00" : normalizeManagementFeeValue(split.managementFeeValue ?? split.managementFeeRatio);
  return {
    incomeType: (split.incomeType || null) as any,
    donationSource: normalizeDonationSource(split.donationSource, split.incomeType),
    incomeAttr: (split.incomeAttr || null) as any,
    remark: mode === "remarkOnly" ? split.remark?.trim() || null : null,
    incomeDept: mode === "remarkOnly" ? null : split.incomeDept || null,
    budgetCode: mode === "remarkOnly" ? null : split.budgetCode || null,
    incomeProject: mode === "remarkOnly" ? null : split.incomeProject || null,
    platformProjectName: mode === "platform" ? split.platformProjectName || null : null,
    platformProjectDetail: mode === "platform" ? split.platformProjectDetail || null : null,
    feedbackType: (mode === "platform" || mode === "interest" || mode === "remarkOnly" ? null : split.feedbackType || null) as any,
    memberName: mode === "membership" || bankDirectDonation ? split.memberName?.trim() || null : null,
    projectCenter: bankDirectDonation ? split.projectCenter?.trim() || null : null,
    region: mode === "platform" || mode === "interest" || mode === "remarkOnly" || bankDirectDonation ? null : normalizeRegion(split.region) as any,
    isAnonymous: mode === "membership" && Boolean(split.isAnonymous) ? 1 : 0,
    managementFeeType: managementFeeType as any,
    managementFeeValue,
    managementFeeRatio: managementFeeType === "比例" ? normalizeManagementFeeRatio(managementFeeValue) : "0",
    expenseFundSource: split.incomeType === "利息"
      ? interestExpenseFundSource
      : mode === "interest" || mode === "remarkOnly"
        ? null
      : mode === "membership"
        ? split.expenseFundSource || getMembershipExpenseFundSource(split.budgetCode)
        : split.expenseFundSource || null,
  };
}

function isSameIncomeRuleMatch(a: { accountName?: string | null; purpose?: string | null; postScript?: string | null }, b: { accountName?: string | null; purpose?: string | null; postScript?: string | null }) {
  return (a.accountName || null) === (b.accountName || null) &&
    (a.purpose || null) === (b.purpose || null) &&
    (a.postScript || null) === (b.postScript || null);
}

async function resolveIncomeCounterpartyMatch(
  db: ReturnType<typeof getDb>,
  alias?: string | null,
) {
  const normalizedAlias = alias?.trim() || null;
  if (!normalizedAlias) return null;

  const [recordRow] = await db.select({
    id: counterpartyRecords.id,
    alias: counterpartyRecords.alias,
    arrivalRegion: counterpartyRecords.arrivalRegion,
  }).from(counterpartyRecords).where(and(
    eq(counterpartyRecords.alias, normalizedAlias),
    eq(counterpartyRecords.recognitionType, "到账认账"),
  ));

  if (!recordRow) {
    throw new Error("匹配到账信息必须选择认账类型为到账认账的已记录到账信息");
  }
  const record = await attachCounterpartyMatchers(db, recordRow);
  const primaryMatcher = getPrimaryCounterpartyMatcher(record);
  if (!primaryMatcher) throw new Error("匹配到账信息缺少有效匹配条件，请先维护到账信息");
  return {
    matchedCounterpartyAlias: record.alias,
    accountName: primaryMatcher.accountName?.trim() || null,
    purpose: primaryMatcher.purpose?.trim() || null,
    postScript: primaryMatcher.postScript?.trim() || null,
    arrivalRegion: normalizeRegion(record.arrivalRegion),
  };
}

function validateBankDirectDonationArrivalRegion(
  counterpartyMatch: Awaited<ReturnType<typeof resolveIncomeCounterpartyMatch>>,
  splits: Array<{ incomeType?: string | null; donationSource?: string | null }>,
) {
  if (splits.some(isBankDirectDonation) && !counterpartyMatch?.arrivalRegion) {
    throw new Error("银行直捐使用匹配到账信息的地区，请先在到账信息汇总中维护渠道认账地区");
  }
}

async function validateIncomeRuleDuplicate(
  db: ReturnType<typeof getDb>,
  match: {
    matchedCounterpartyAlias?: string | null;
    accountName?: string | null;
    purpose?: string | null;
    postScript?: string | null;
    arrivalRegion?: string | null;
  },
  excludeId?: number,
) {
  const existingRules = await db.select().from(incomeRecognitionRules);
  const aliasDuplicate = !!match.matchedCounterpartyAlias && existingRules.some((rule) =>
    rule.id !== excludeId && rule.matchedCounterpartyAlias === match.matchedCounterpartyAlias
  );
  const customDuplicate = !match.matchedCounterpartyAlias && existingRules.some((rule) =>
    rule.id !== excludeId && !rule.matchedCounterpartyAlias && isSameIncomeRuleMatch(rule, match)
  );

  if (aliasDuplicate || customDuplicate) {
    throw new Error("创建失败，有相同规则，请检查。");
  }
}

async function insertIncomeRule(
  db: ReturnType<typeof getDb>,
  userId: number,
  input: z.infer<typeof incomeRuleImportSchema>,
  forceInactive = false
) {
  const counterpartyMatch = await resolveIncomeCounterpartyMatch(db, input.matchedCounterpartyAlias);
  const normalizedName = counterpartyMatch?.accountName || input.accountName?.trim() || null;
  const normalizedPurpose = counterpartyMatch?.purpose || input.purpose?.trim() || null;
  const normalizedPostScript = counterpartyMatch?.postScript || input.postScript?.trim() || null;

  if (!counterpartyMatch && !normalizedName && !normalizedPurpose && !normalizedPostScript) {
    throw new Error("对方户名、用途、附言至少填写一项");
  }
  validateIncomeRuleSplits(input.splits);
  validateBankDirectDonationArrivalRegion(counterpartyMatch, input.splits);
  const projectCenters = await normalizeProjectCenters(db, input.splits);

  const recognitionType = normalizeRecognitionType(input.recognitionType);

  const ruleResult = await db.insert(incomeRecognitionRules).values({
    ruleName: input.ruleName,
    matchedCounterpartyAlias: counterpartyMatch?.matchedCounterpartyAlias || null,
    recognitionType: recognitionType as any,
    accountName: normalizedName,
    purpose: normalizedPurpose,
    postScript: normalizedPostScript,
    creatorId: userId,
    isActive: forceInactive ? 0 : input.isActive ? 1 : 0,
  }).$returningId();
  const ruleId = Number(ruleResult[0]?.id);
  if (!ruleId) throw new Error("创建规则失败");

  if (input.splits.length > 0) {
    const splitValues = input.splits.map((split, i) => ({
      incomeRuleId: ruleId,
      splitForm: normalizeIncomeRuleSplitForm(split.splitForm),
      splitRatio: normalizeIncomeRuleSplitForm(split.splitForm) === "百分比" ? normalizeSplitRatio(split.splitRatio) : "0",
      ...buildIncomeRuleSplitFields({ ...split, projectCenter: projectCenters[i] }),
      sortOrder: i,
    }));
    await db.insert(incomeRuleSplits).values(splitValues);
  }

  return ruleId;
}

async function refreshTaskStatusByFlows(taskId: number) {
  const db = getDb();
  const totalResult = await db.select({
    allCount: count(),
    count: sql<number>`SUM(CASE WHEN CAST(${bankFlows.income} AS DECIMAL(18,2)) > 0 THEN 1 ELSE 0 END)`,
  }).from(bankFlows)
    .where(eq(bankFlows.taskId, taskId));
  const recognizedResult = await db.select({ count: count() }).from(bankFlows)
    .where(and(eq(bankFlows.taskId, taskId), gt(bankFlows.income, "0"), eq(bankFlows.recognitionStatus, "recognized")));
  const progressResult = await db.select({ count: count() }).from(bankFlows)
    .where(and(eq(bankFlows.taskId, taskId), gt(bankFlows.income, "0"), inArray(bankFlows.recognitionStatus, ["recognized", "partial_matched"] as any)));
  const allTotal = Number(totalResult[0]?.allCount || 0);
  const total = Number(totalResult[0]?.count || 0);
  const recognized = Number(recognizedResult[0]?.count || 0);
  const progressed = Number(progressResult[0]?.count || 0);
  const status = allTotal > 0 && total === 0
    ? "completed"
    : total > 0 && recognized >= total
    ? "completed"
    : progressed > 0
      ? "partial_matched"
      : "pending_details";

  await db.update(recognitionTasks).set({
    status,
    updatedAt: new Date(),
    completedAt: status === "completed" ? new Date() : null,
  }).where(eq(recognitionTasks.id, taskId));
  await refreshRecognitionDateSummariesByTaskIds([taskId]);

  return status === "pending_details" ? "pending_recognition" : status;
}

function buildAutomaticIncomeRecognitionResultValues(input: {
  taskId: number;
  billDate: string;
  flow: any;
  matchedRule: any;
  ruleSplits: any[];
  arrivalRegion: string | null;
}) {
  const { taskId, billDate, flow, matchedRule, ruleSplits, arrivalRegion } = input;
  const flowIncome = parseFloat(flow.income || "0");
  const channelRegion = matchedRule.recognitionType === "渠道捐赠"
    ? arrivalRegion
    : null;

  if (ruleSplits.length === 0) {
    return [{
      taskId,
      incomeRuleId: matchedRule.id,
      bankFlowId: flow.id,
      recognitionType: matchedRule.recognitionType as any,
      ...buildMatchResultDisplaySnapshot(flow, null),
      region: channelRegion as any,
      totalAmount: flowIncome.toFixed(2),
      splitAmount: flowIncome.toFixed(2),
      splitRatio: "100",
      detailCount: 1,
      orderDetailCountSnapshot: 0,
      entryTime: billDate,
    }];
  }

  const splitAmounts = splitAmountByRatios(
    flowIncome,
    ruleSplits.map((split) => normalizeSplitRatio(split.splitRatio || "100")),
  );
  return ruleSplits.map((split, index) => {
    const splitMode = getIncomeRuleSplitMode(split.incomeType, split.donationSource);
    const bankDirectDonation = isBankDirectDonation(split);
    const hasNoManagementFee = splitMode === "membership" || splitMode === "interest" || splitMode === "remarkOnly";
    const managementFeeType = hasNoManagementFee ? "比例" : normalizeManagementFeeType(split.managementFeeType);
    const managementFeeValue = hasNoManagementFee ? "0.00" : normalizeManagementFeeValue(split.managementFeeValue ?? split.managementFeeRatio);
    const managementFeeRatio = managementFeeType === "比例" ? normalizeManagementFeeRatio(managementFeeValue) : "0";
    return {
      taskId,
      incomeRuleId: matchedRule.id,
      bankFlowId: flow.id,
      recognitionType: matchedRule.recognitionType as any,
      incomeType: split.incomeType,
      donationSource: split.donationSource || null,
      incomeAttr: split.incomeAttr,
      incomeDept: splitMode === "remarkOnly" ? null : split.incomeDept,
      budgetCode: splitMode === "remarkOnly" ? null : split.budgetCode,
      incomeProject: splitMode === "remarkOnly" ? null : split.incomeProject,
      platformProjectName: splitMode === "platform" ? split.platformProjectName : null,
      ...buildMatchResultDisplaySnapshot(flow, splitMode === "platform" ? split.platformProjectName : null),
      platformProjectDetail: splitMode === "platform" ? split.platformProjectDetail : null,
      feedbackType: splitMode === "platform" || splitMode === "interest" || splitMode === "remarkOnly" ? null : split.feedbackType || null,
      memberName: splitMode === "membership" || bankDirectDonation ? split.memberName || null : null,
      projectCenter: bankDirectDonation ? split.projectCenter || null : null,
      region: resolveIncomeRuleRecognitionRegion({
        splitMode,
        bankDirectDonation,
        arrivalRegion,
        channelRegion,
        configuredRegion: split.region,
      }) as any,
      isAnonymous: splitMode === "membership" ? split.isAnonymous || 0 : 0,
      managementFeeType: managementFeeType as any,
      managementFeeValue,
      managementFeeRatio,
      managementFeeAmount: hasNoManagementFee ? "0.00" : calculateManagementFeeAmountByType(splitAmounts[index], managementFeeType, managementFeeValue),
      expenseFundSource: split.incomeType === "利息"
        ? interestExpenseFundSource
        : splitMode === "interest" || splitMode === "remarkOnly"
          ? null
          : renderIncomeExpenseFundSource(
            splitMode === "membership" ? split.expenseFundSource || getMembershipExpenseFundSource(split.budgetCode) : split.expenseFundSource,
            flow,
          ),
      remark: splitMode === "remarkOnly" ? split.remark || null : null,
      totalAmount: flowIncome.toFixed(2),
      splitAmount: splitAmounts[index],
      splitRatio: normalizeSplitRatio(split.splitRatio),
      detailCount: 1,
      orderDetailCountSnapshot: 0,
      entryTime: billDate,
    };
  });
}

export async function executeUploadedIncomeRecognition(
  inputCandidates: UploadedIncomeRecognitionCandidate[],
) {
  const uniqueCandidates = Array.from(new Map(
    inputCandidates
      .filter((candidate) => Number(candidate.flowId) > 0)
      .map((candidate) => [Number(candidate.flowId), candidate]),
  ).values()).sort((a, b) => a.flowId - b.flowId);
  const affectedTaskIds = Array.from(new Set(uniqueCandidates.map((candidate) => Number(candidate.taskId)).filter(Boolean)));
  const emptyResult = {
    matchedCount: 0,
    pendingAmountCount: 0,
    noRuleCount: 0,
    skippedCount: 0,
    failedFlowCount: 0,
    affectedTaskIds,
    errorMessage: null as string | null,
  };
  if (uniqueCandidates.length === 0) return emptyResult;

  const db = getDb();
  let rules: any[];
  let splits: any[];
  try {
    rules = await db.select().from(incomeRecognitionRules)
      .where(eq(incomeRecognitionRules.isActive, 1 as any))
      .orderBy(asc(incomeRecognitionRules.id));
    const ruleIds = rules.map((rule) => Number(rule.id)).filter(Boolean);
    splits = ruleIds.length > 0
      ? await db.select().from(incomeRuleSplits)
        .where(inArray(incomeRuleSplits.incomeRuleId, ruleIds))
        .orderBy(asc(incomeRuleSplits.incomeRuleId), asc(incomeRuleSplits.sortOrder), asc(incomeRuleSplits.id))
      : [];
  } catch (error: any) {
    return {
      ...emptyResult,
      failedFlowCount: uniqueCandidates.length,
      errorMessage: error?.message || "读取到账认账规则失败",
    };
  }

  const { ruleByCounterpartyAlias, splitsByRuleId } = buildUploadedIncomeRecognitionRuleLookups(rules, splits);
  const batches = chunkUploadedIncomeRecognitionCandidates(uniqueCandidates);
  const result = { ...emptyResult };

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    try {
      const batchResult = await db.transaction(async (tx) => {
        const flowIds = batch.map((candidate) => Number(candidate.flowId));
        await tx.execute(sql`
          SELECT id
          FROM bank_flows
          WHERE id IN (${sql.join(flowIds.map((id) => sql`${id}`), sql`, `)})
          ORDER BY id
          FOR UPDATE
        `);
        const currentFlows = await tx.select().from(bankFlows).where(inArray(bankFlows.id, flowIds));
        const flowById = new Map(currentFlows.map((flow) => [Number(flow.id), flow]));
        const existingResultRows = await tx.select({
          bankFlowId: matchResults.bankFlowId,
          count: count(),
          total: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
        }).from(matchResults)
          .where(inArray(matchResults.bankFlowId, flowIds))
          .groupBy(matchResults.bankFlowId);
        const existingResultByFlowId = new Map(existingResultRows.map((row) => [
          Number(row.bankFlowId),
          { count: Number(row.count || 0), total: Number(row.total || 0) },
        ]));

        const resultValues: any[] = [];
        const recognizedFlowIdsByRuleId = new Map<number, number[]>();
        const pendingFlowIdsByRuleId = new Map<number, number[]>();
        const existingFlowIdsByStatus = new Map<string, number[]>();
        const counters = { matchedCount: 0, pendingAmountCount: 0, noRuleCount: 0, skippedCount: 0 };

        for (const candidate of batch) {
          const flow = flowById.get(Number(candidate.flowId));
          if (!flow
            || Number(flow.taskId) !== Number(candidate.taskId)
            || Number(flow.matchedCounterpartyId) !== Number(candidate.matchedCounterpartyId)
            || flow.arrivalMatchStatus !== "matched"
            || flow.recognitionStatus !== "unrecognized"
            || toCents(flow.income) <= 0) {
            counters.skippedCount++;
            continue;
          }

          const existingResult = existingResultByFlowId.get(Number(flow.id));
          if (existingResult?.count) {
            const status = deriveFlowRecognitionStatus(flow.income, existingResult.total);
            const ids = existingFlowIdsByStatus.get(status) || [];
            ids.push(Number(flow.id));
            existingFlowIdsByStatus.set(status, ids);
            counters.skippedCount++;
            continue;
          }

          const matchedRule = ruleByCounterpartyAlias.get(candidate.matchedCounterpartyAlias);
          if (!matchedRule) {
            counters.noRuleCount++;
            continue;
          }
          const ruleSplits = splitsByRuleId.get(Number(matchedRule.id)) || [];
          if (ruleSplits.length > 0 && resolveIncomeRuleSplitForm(ruleSplits) === "认账时填写") {
            const ids = pendingFlowIdsByRuleId.get(Number(matchedRule.id)) || [];
            ids.push(Number(flow.id));
            pendingFlowIdsByRuleId.set(Number(matchedRule.id), ids);
            counters.pendingAmountCount++;
            continue;
          }

          resultValues.push(...buildAutomaticIncomeRecognitionResultValues({
            taskId: Number(candidate.taskId),
            billDate: candidate.billDate,
            flow,
            matchedRule,
            ruleSplits,
            arrivalRegion: normalizeRegion(candidate.arrivalRegion) || null,
          }));
          const ids = recognizedFlowIdsByRuleId.get(Number(matchedRule.id)) || [];
          ids.push(Number(flow.id));
          recognizedFlowIdsByRuleId.set(Number(matchedRule.id), ids);
          counters.matchedCount++;
        }

        if (resultValues.length > 0) {
          await tx.insert(matchResults).values(resultValues);
        }
        for (const [ruleId, flowIds] of recognizedFlowIdsByRuleId) {
          await tx.update(bankFlows).set({
            recognitionStatus: "recognized",
            incomeRuleId: ruleId,
          }).where(inArray(bankFlows.id, flowIds));
        }
        for (const [ruleId, flowIds] of pendingFlowIdsByRuleId) {
          await tx.update(bankFlows).set({
            recognitionStatus: "unrecognized",
            incomeRuleId: ruleId,
          }).where(inArray(bankFlows.id, flowIds));
        }
        for (const [status, flowIds] of existingFlowIdsByStatus) {
          await tx.update(bankFlows).set({ recognitionStatus: status as any })
            .where(inArray(bankFlows.id, flowIds));
        }
        return counters;
      });

      result.matchedCount += batchResult.matchedCount;
      result.pendingAmountCount += batchResult.pendingAmountCount;
      result.noRuleCount += batchResult.noRuleCount;
      result.skippedCount += batchResult.skippedCount;
    } catch (error: any) {
      result.failedFlowCount = batches.slice(batchIndex).reduce((sum, item) => sum + item.length, 0);
      result.errorMessage = error?.message || `第 ${batchIndex + 1} 批到账认账失败`;
      break;
    }
  }

  return result;
}

/**
 * 执行到账认账核心逻辑（公共函数，可被 taskRouter 调用）
 */
export async function executeIncomeRecognition(taskId: number) {
  const db = getDb();

  // 获取任务
  const [task] = await db.select().from(recognitionTasks)
    .where(eq(recognitionTasks.id, taskId));
  if (!task) throw new Error("任务不存在");

  await db.update(recognitionTasks).set({
    status: "processing",
    updatedAt: new Date(),
  }).where(eq(recognitionTasks.id, taskId));
  await refreshRecognitionDateSummariesByTaskIds([taskId]);

  // 获取所有启用的到账认账规则
  let rules = await db.select().from(incomeRecognitionRules)
    .where(eq(incomeRecognitionRules.isActive, 1 as any));

  if (rules.length === 0) {
    await refreshTaskStatusByFlows(taskId);
    return { matchedCount: 0, message: "没有启用的到账认账规则" };
  }

  // 只处理上传或人工重新匹配后已经固化到账信息的流水。
  const flows = await db.select().from(bankFlows)
    .where(and(
      eq(bankFlows.taskId, taskId),
      gt(bankFlows.income, "0"),
      eq(bankFlows.recognitionStatus, "unrecognized"),
      eq(bankFlows.arrivalMatchStatus, "matched"),
      isNotNull(bankFlows.matchedCounterpartyId),
    ));

  if (flows.length === 0) {
    await refreshTaskStatusByFlows(taskId);
    return { matchedCount: 0, message: "没有待匹配的银行流水" };
  }

  const matchedCounterpartyIds = Array.from(new Set(
    flows.map((flow) => Number(flow.matchedCounterpartyId)).filter(Boolean),
  ));
  const counterpartyRows = matchedCounterpartyIds.length > 0
    ? await db.select().from(counterpartyRecords).where(inArray(counterpartyRecords.id, matchedCounterpartyIds))
    : [];
  const counterpartyById = new Map(counterpartyRows.map((item) => [Number(item.id), item]));
  const regionByAlias = new Map(counterpartyRows.map((item) => [item.alias, normalizeRegion(item.arrivalRegion)]));

  const existingResultRows = await db.select({
    bankFlowId: matchResults.bankFlowId,
    count: count(),
    total: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
  }).from(matchResults)
    .where(inArray(matchResults.bankFlowId, flows.map((flow) => Number(flow.id))))
    .groupBy(matchResults.bankFlowId);
  const existingResultByFlowId = new Map(existingResultRows.map((row) => [
    Number(row.bankFlowId),
    {
      count: Number(row.count || 0),
      total: Number(row.total || 0),
    },
  ]));

  // 获取所有规则的分账（用 or + eq 替代 sql.join 避免语法错误）
  const allRuleIds = rules.map((r) => r.id);
  let splits: any[] = [];
  if (allRuleIds.length > 0) {
    const conditions = allRuleIds.map((id) => eq(incomeRuleSplits.incomeRuleId, id));
    splits = await db.select().from(incomeRuleSplits)
      .where(or(...conditions))
      .orderBy(asc(incomeRuleSplits.incomeRuleId), asc(incomeRuleSplits.sortOrder), asc(incomeRuleSplits.id));
  }

  let matchedCount = 0;
  let pendingAmountCount = 0;

  for (const flow of flows) {
    const existingResult = existingResultByFlowId.get(Number(flow.id));
    if (existingResult?.count) {
      await db.update(bankFlows).set({
        recognitionStatus: deriveFlowRecognitionStatus(flow.income, existingResult.total),
      }).where(eq(bankFlows.id, flow.id));
      continue;
    }

    const matchedCounterparty = counterpartyById.get(Number(flow.matchedCounterpartyId));
    const matchedRule = matchedCounterparty?.recognitionType === "到账认账"
      ? rules.find((rule) => rule.matchedCounterpartyAlias === matchedCounterparty.alias)
      : undefined;

    if (matchedRule) {
      const ruleSplits = splits.filter((s) => s.incomeRuleId === matchedRule.id);
      const arrivalRegion = regionByAlias.get(matchedRule.matchedCounterpartyAlias || "") || null;

      if (ruleSplits.length > 0 && resolveIncomeRuleSplitForm(ruleSplits) === "认账时填写") {
        await db.update(bankFlows).set({
          recognitionStatus: "unrecognized",
          incomeRuleId: matchedRule.id,
        }).where(eq(bankFlows.id, flow.id));
        pendingAmountCount++;
        continue;
      }

      await db.insert(matchResults).values(buildAutomaticIncomeRecognitionResultValues({
        taskId,
        billDate: task.billDate,
        flow,
        matchedRule,
        ruleSplits,
        arrivalRegion,
      }));

      // 标记银行流水为已到账认账
      await db.update(bankFlows).set({
        recognitionStatus: "recognized",
        incomeRuleId: matchedRule.id,
      }).where(eq(bankFlows.id, flow.id));

      matchedCount++;
    } else if (flow.incomeRuleId) {
      await db.update(bankFlows).set({ incomeRuleId: null }).where(eq(bankFlows.id, flow.id));
    }
  }

  await refreshTaskStatusByFlows(taskId);

  const messageParts = [`自动认账 ${matchedCount} 条银行流水`];
  if (pendingAmountCount > 0) messageParts.push(`${pendingAmountCount} 条等待填写认账金额`);
  return { matchedCount, pendingAmountCount, message: `到账认账完成：${messageParts.join("，")}` };
}

async function readPendingAmountRecognitionContext(db: any, flowId: number) {
  const [flow] = await db.select().from(bankFlows).where(eq(bankFlows.id, flowId));
  if (!flow) throw new Error("流水不存在");
  assertBankFlowRecognitionEligible(flow.income);
  if (flow.recognitionStatus !== "unrecognized") throw new Error("流水状态已变化，请刷新后重试");
  if (!flow.incomeRuleId) throw new Error("该流水未匹配认账时填写规则");

  const [rule] = await db.select().from(incomeRecognitionRules)
    .where(eq(incomeRecognitionRules.id, Number(flow.incomeRuleId)));
  if (!rule) throw new Error("匹配的到账认账规则不存在");

  const splits = await db.select().from(incomeRuleSplits)
    .where(eq(incomeRuleSplits.incomeRuleId, Number(rule.id)))
    .orderBy(asc(incomeRuleSplits.sortOrder), asc(incomeRuleSplits.id));
  if (splits.length === 0 || resolveIncomeRuleSplitForm(splits) !== "认账时填写") {
    throw new Error("该流水当前不是认账时填写规则，请刷新后重试");
  }

  const [recognized] = await db.select({
    total: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
  }).from(matchResults).where(eq(matchResults.bankFlowId, flowId));
  const recognizedCents = toCents(recognized?.total || 0);
  const availableCents = getSignedRecognitionAvailableCents(flow.income, recognizedCents / 100);
  if (availableCents === 0) throw new Error("该流水已无可认账金额");

  const [task] = await db.select({ billDate: recognitionTasks.billDate })
    .from(recognitionTasks)
    .where(eq(recognitionTasks.id, Number(flow.taskId)));
  if (!task) throw new Error("认账任务不存在");

  return {
    flow,
    rule,
    splits,
    task,
    recognizedAmount: formatCents(recognizedCents),
    availableAmount: formatCents(availableCents),
  };
}

export const incomeRuleRouter = createRouter({
  // 列表
  list: authedQuery
    .input(z.object({
      search: z.string().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(20),
    }).optional())
    .query(async ({ input }) => {
    const db = getDb();
    const page = input?.page || 1;
    const pageSize = input?.pageSize || 20;
    const search = input?.search?.trim() || "";
    const whereClause = search
      ? sql`${incomeRecognitionRules.ruleName} LIKE ${`%${search}%`}`
      : undefined;

    const [rules, totalResult] = await Promise.all([
      db.select().from(incomeRecognitionRules)
        .where(whereClause)
        .orderBy(desc(incomeRecognitionRules.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ count: count() }).from(incomeRecognitionRules).where(whereClause),
    ]);
    const ruleIds = rules.map((rule) => Number(rule.id));
    const splitRows = ruleIds.length > 0
      ? await db.select({ incomeRuleId: incomeRuleSplits.incomeRuleId }).from(incomeRuleSplits).where(inArray(incomeRuleSplits.incomeRuleId, ruleIds))
      : [];
    const splitCountByRuleId = new Map<number, number>();
    for (const split of splitRows) {
      const ruleId = Number(split.incomeRuleId);
      splitCountByRuleId.set(ruleId, (splitCountByRuleId.get(ruleId) || 0) + 1);
    }

    return {
      items: rules.map((r) => ({
      ...r,
      // 旧规则 ruleName 为 null 时显示默认名
      ruleName: r.ruleName || `规则#${r.id}`,
        splitCount: splitCountByRuleId.get(Number(r.id)) || 0,
      })),
      total: Number(totalResult[0]?.count || 0),
      page,
      pageSize,
    };
  }),

  // 单条
  getById: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [rule] = await db.select().from(incomeRecognitionRules).where(eq(incomeRecognitionRules.id, input.id));
      if (!rule) return null;
      const splits = await db.select().from(incomeRuleSplits)
        .where(eq(incomeRuleSplits.incomeRuleId, input.id))
        .orderBy(asc(incomeRuleSplits.sortOrder), asc(incomeRuleSplits.id));
      return { ...rule, ruleName: rule.ruleName || `规则#${rule.id}`, splits };
    }),

  exportAll: authedQuery.query(async () => {
    const db = getDb();
    const rules = await db.select().from(incomeRecognitionRules).orderBy(desc(incomeRecognitionRules.createdAt));
    const splits = await db.select().from(incomeRuleSplits);
    return {
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      ruleType: "income-recognition",
      rules: rules.map((rule) => {
        const recognitionType = normalizeRecognitionType(rule.recognitionType);
        return {
          ruleName: rule.ruleName || `规则#${rule.id}`,
          matchedCounterpartyAlias: rule.matchedCounterpartyAlias || null,
          recognitionType,
          accountName: rule.accountName || null,
          purpose: rule.purpose || null,
          postScript: rule.postScript || null,
          isActive: !!rule.isActive,
          splits: splits
            .filter((split) => split.incomeRuleId === rule.id)
            .map((split) => ({
              splitForm: normalizeIncomeRuleSplitForm(split.splitForm),
              splitRatio: normalizeIncomeRuleSplitForm(split.splitForm) === "百分比" ? normalizeSplitRatio(split.splitRatio) : "0",
              ...buildIncomeRuleSplitFields(split),
              isAnonymous: !!buildIncomeRuleSplitFields(split).isAnonymous,
            })),
        };
      }),
    };
  }),

  importRules: authedQuery
    .input(z.object({
      data: z.object({
        ruleType: z.string().optional(),
        rules: z.array(z.unknown()).min(1, "导入文件中没有规则"),
      }).passthrough(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.data.ruleType && input.data.ruleType !== "income-recognition") {
        throw new Error("导入文件不是到账认账规则");
      }
      const db = getDb();
      const activeRules = await db.select().from(incomeRecognitionRules).where(eq(incomeRecognitionRules.isActive, 1 as any));
      let imported = 0;
      let deactivated = 0;
      for (let i = 0; i < input.data.rules.length; i++) {
        const parsed = incomeRuleImportSchema.parse(input.data.rules[i]);
        const normalized = {
          accountName: parsed.accountName?.trim() || null,
          purpose: parsed.purpose?.trim() || null,
          postScript: parsed.postScript?.trim() || null,
        };
        const shouldDeactivate = !!parsed.isActive && activeRules.some((rule) => isSameIncomeRuleMatch(rule, normalized));
        await insertIncomeRule(db, ctx.user.id, parsed, shouldDeactivate);
        if (!shouldDeactivate && parsed.isActive) {
          activeRules.push(normalized as any);
        }
        imported++;
        if (shouldDeactivate) deactivated++;
      }
      return { imported, deactivated };
    }),

  // 创建
  create: authedQuery
    .input(
      z.object({
        ruleName: z.string().min(1, "规则名称不能为空").max(200),
        matchedCounterpartyAlias: z.string().trim().min(1, "请选择匹配到账信息").max(200),
        recognitionType: z.enum(["银行直捐", "渠道捐赠"]).default("渠道捐赠"),
        accountName: z.string().nullable(),
        purpose: z.string().nullable(),
        postScript: z.string().nullable(),
        splits: z.array(
          z.object({
            splitForm: z.enum(incomeRuleSplitFormValues).optional().default("百分比"),
            splitRatio: z.string(),
            incomeType: z.string().nullable(),
            donationSource: z.enum(donationSourceValues).nullable().optional(),
            incomeAttr: z.string().nullable(),
            remark: z.string().nullable().optional(),
            incomeDept: z.string().nullable(),
            budgetCode: z.string().nullable(),
            incomeProject: z.string().nullable(),
            platformProjectName: z.string().nullable(),
            platformProjectDetail: z.string().nullable(),
            feedbackType: z.enum(["反馈", "重点反馈"]).nullable().optional(),
            memberName: z.string().nullable().optional(),
            projectCenter: z.string().nullable().optional(),
            region: z.enum(["北京市", "外省市", "港澳台", "境外", "内部客商"]).nullable().optional(),
            isAnonymous: z.boolean().optional().default(false),
            managementFeeType: z.enum(["比例", "金额"]).nullable().optional(),
            managementFeeValue: z.string().nullable().optional(),
            managementFeeRatio: z.string().nullable(),
            expenseFundSource: z.string().nullable(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      const counterpartyMatch = await resolveIncomeCounterpartyMatch(db, input.matchedCounterpartyAlias);
      const normalizedName = counterpartyMatch?.accountName || input.accountName?.trim() || null;
      const normalizedPurpose = counterpartyMatch?.purpose || input.purpose?.trim() || null;
      const normalizedPostScript = counterpartyMatch?.postScript || input.postScript?.trim() || null;

      validateIncomeRuleSplits(input.splits);

      await validateIncomeRuleDuplicate(db, {
        matchedCounterpartyAlias: counterpartyMatch?.matchedCounterpartyAlias || null,
        accountName: normalizedName,
        purpose: normalizedPurpose,
        postScript: normalizedPostScript,
      });

      const ruleId = await insertIncomeRule(db, ctx.user.id, {
        ...input,
        matchedCounterpartyAlias: counterpartyMatch?.matchedCounterpartyAlias || null,
        accountName: normalizedName,
        purpose: normalizedPurpose,
        postScript: normalizedPostScript,
        isActive: true,
      });

      return { id: ruleId };
    }),

  // 更新
  update: authedQuery
    .input(
      z.object({
        id: z.number(),
        ruleName: z.string().min(1).max(200),
        matchedCounterpartyAlias: z.string().trim().min(1, "请选择匹配到账信息").max(200),
        recognitionType: z.enum(["银行直捐", "渠道捐赠"]).default("渠道捐赠"),
        accountName: z.string().nullable(),
        purpose: z.string().nullable(),
        postScript: z.string().nullable(),
        isActive: z.boolean(),
        splits: z.array(
          z.object({
            splitForm: z.enum(incomeRuleSplitFormValues).optional().default("百分比"),
            splitRatio: z.string(),
            incomeType: z.string().nullable(),
            donationSource: z.enum(donationSourceValues).nullable().optional(),
            incomeAttr: z.string().nullable(),
            remark: z.string().nullable().optional(),
            incomeDept: z.string().nullable(),
            budgetCode: z.string().nullable(),
            incomeProject: z.string().nullable(),
            platformProjectName: z.string().nullable(),
            platformProjectDetail: z.string().nullable(),
            feedbackType: z.enum(["反馈", "重点反馈"]).nullable().optional(),
            memberName: z.string().nullable().optional(),
            projectCenter: z.string().nullable().optional(),
            region: z.enum(["北京市", "外省市", "港澳台", "境外", "内部客商"]).nullable().optional(),
            isAnonymous: z.boolean().optional().default(false),
            managementFeeType: z.enum(["比例", "金额"]).nullable().optional(),
            managementFeeValue: z.string().nullable().optional(),
            managementFeeRatio: z.string().nullable(),
            expenseFundSource: z.string().nullable(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();

      const counterpartyMatch = await resolveIncomeCounterpartyMatch(db, input.matchedCounterpartyAlias);
      const normalizedName = counterpartyMatch?.accountName || input.accountName?.trim() || null;
      const normalizedPurpose = counterpartyMatch?.purpose || input.purpose?.trim() || null;
      const normalizedPostScript = counterpartyMatch?.postScript || input.postScript?.trim() || null;

      validateIncomeRuleSplits(input.splits);
      validateBankDirectDonationArrivalRegion(counterpartyMatch, input.splits);
      const projectCenters = await normalizeProjectCenters(db, input.splits);
      await validateIncomeRuleDuplicate(db, {
        matchedCounterpartyAlias: counterpartyMatch?.matchedCounterpartyAlias || null,
        accountName: normalizedName,
        purpose: normalizedPurpose,
        postScript: normalizedPostScript,
      }, input.id);

      await db.update(incomeRecognitionRules).set({
        ruleName: input.ruleName,
        matchedCounterpartyAlias: counterpartyMatch?.matchedCounterpartyAlias || null,
        recognitionType: normalizeRecognitionType(input.recognitionType) as any,
        accountName: normalizedName,
        purpose: normalizedPurpose,
        postScript: normalizedPostScript,
        isActive: input.isActive ? 1 : 0,
        updatedAt: new Date(),
      }).where(eq(incomeRecognitionRules.id, input.id));

      // 删除旧分账，插入新分账
      await db.delete(incomeRuleSplits).where(eq(incomeRuleSplits.incomeRuleId, input.id));
      if (input.splits.length > 0) {
        const splitValues = input.splits.map((split, i) => ({
          incomeRuleId: input.id,
          splitForm: normalizeIncomeRuleSplitForm(split.splitForm),
          splitRatio: normalizeIncomeRuleSplitForm(split.splitForm) === "百分比" ? normalizeSplitRatio(split.splitRatio) : "0",
          ...buildIncomeRuleSplitFields({ ...split, projectCenter: projectCenters[i] }),
          sortOrder: i,
        }));
        await db.insert(incomeRuleSplits).values(splitValues);
      }

      return { success: true };
    }),

  getPendingAmountRecognition: authedQuery
    .input(z.object({ flowId: z.number() }))
    .query(async ({ input }) => {
      const context = await readPendingAmountRecognitionContext(getDb(), input.flowId);
      return {
        ruleId: Number(context.rule.id),
        ruleName: context.rule.ruleName || `规则#${context.rule.id}`,
        recognizedAmount: context.recognizedAmount,
        availableAmount: context.availableAmount,
        splits: context.splits.map((split: any) => ({
          id: Number(split.id),
          incomeDept: split.incomeDept || null,
          incomeProject: split.incomeProject || null,
          budgetCode: split.budgetCode || null,
        })),
      };
    }),

  confirmPendingAmountRecognition: authedQuery
    .input(z.object({
      flowId: z.number(),
      voucherReceiptChannelCode: z.string().max(100, "收款渠道编号最长100字").nullable().optional(),
      splits: z.array(z.object({
        splitId: z.number(),
        recognitionAmount: z.string().nullable().optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const voucherReceiptChannelCode = await validateVoucherReceiptChannelCode(db, input.voucherReceiptChannelCode);
      let affectedTaskId = 0;

      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM bank_flows WHERE id = ${input.flowId} FOR UPDATE`);
        const context = await readPendingAmountRecognitionContext(tx, input.flowId);
        affectedTaskId = Number(context.flow.taskId);

        const inputBySplitId = new Map<number, string | null | undefined>();
        for (const split of input.splits) {
          if (inputBySplitId.has(split.splitId)) throw new Error("分账设置重复，请刷新后重试");
          inputBySplitId.set(split.splitId, split.recognitionAmount);
        }
        if (inputBySplitId.size !== context.splits.length || context.splits.some((split: any) => !inputBySplitId.has(Number(split.id)))) {
          throw new Error("分账设置已变化，请刷新后重试");
        }

        const orderedAmounts = context.splits.map((split: any) => ({
          recognitionAmount: inputBySplitId.get(Number(split.id)),
        }));
        const amountValidation = validateIncomeRuleRecognitionAmounts(context.availableAmount, orderedAmounts);
        const [counterparty] = context.rule.matchedCounterpartyAlias
          ? await tx.select({ arrivalRegion: counterpartyRecords.arrivalRegion })
            .from(counterpartyRecords)
            .where(eq(counterpartyRecords.alias, context.rule.matchedCounterpartyAlias))
          : [];
        const arrivalRegion = normalizeRegion(counterparty?.arrivalRegion) || null;
        const channelRegion = context.rule.recognitionType === "渠道捐赠"
          ? arrivalRegion
          : null;

        const resultValues = amountValidation.nonZeroIndexes.map((index) => {
          const split = context.splits[index];
          const splitAmount = amountValidation.amounts[index];
          const splitMode = getIncomeRuleSplitMode(split.incomeType, split.donationSource);
          const bankDirectDonation = isBankDirectDonation(split);
          const hasNoManagementFee = splitMode === "membership" || splitMode === "interest" || splitMode === "remarkOnly";
          const managementFeeType = hasNoManagementFee ? "比例" : normalizeManagementFeeType(split.managementFeeType);
          const managementFeeValue = hasNoManagementFee ? "0.00" : normalizeManagementFeeValue(split.managementFeeValue ?? split.managementFeeRatio);
          const managementFeeRatio = managementFeeType === "比例" ? normalizeManagementFeeRatio(managementFeeValue) : "0";
          return {
            taskId: Number(context.flow.taskId),
            incomeRuleId: Number(context.rule.id),
            bankFlowId: Number(context.flow.id),
            recognitionType: context.rule.recognitionType as any,
            incomeType: split.incomeType,
            donationSource: split.donationSource || null,
            incomeAttr: split.incomeAttr,
            incomeDept: splitMode === "remarkOnly" ? null : split.incomeDept,
            budgetCode: splitMode === "remarkOnly" ? null : split.budgetCode,
            incomeProject: splitMode === "remarkOnly" ? null : split.incomeProject,
            platformProjectName: splitMode === "platform" ? split.platformProjectName : null,
            ...buildMatchResultDisplaySnapshot(context.flow, splitMode === "platform" ? split.platformProjectName : null),
            platformProjectDetail: splitMode === "platform" ? split.platformProjectDetail : null,
            feedbackType: splitMode === "platform" || splitMode === "interest" || splitMode === "remarkOnly" ? null : split.feedbackType || null,
            memberName: splitMode === "membership" || bankDirectDonation ? split.memberName || null : null,
            projectCenter: bankDirectDonation ? split.projectCenter || null : null,
            region: resolveIncomeRuleRecognitionRegion({
              splitMode,
              bankDirectDonation,
              arrivalRegion,
              channelRegion,
              configuredRegion: split.region,
            }) as any,
            isAnonymous: splitMode === "membership" ? split.isAnonymous || 0 : 0,
            managementFeeType: managementFeeType as any,
            managementFeeValue,
            managementFeeRatio,
            managementFeeAmount: hasNoManagementFee ? "0.00" : calculateManagementFeeAmountByType(splitAmount, managementFeeType, managementFeeValue),
            expenseFundSource: split.incomeType === "利息"
              ? interestExpenseFundSource
              : splitMode === "interest" || splitMode === "remarkOnly"
                ? null
                : renderIncomeExpenseFundSource(
                  splitMode === "membership" ? split.expenseFundSource || getMembershipExpenseFundSource(split.budgetCode) : split.expenseFundSource,
                  context.flow,
                ),
            remark: splitMode === "remarkOnly" ? split.remark || null : null,
            voucherReceiptChannelCode,
            totalAmount: amountValidation.totalAmount,
            splitAmount,
            splitRatio: calculateDerivedSplitRatio(splitAmount, amountValidation.totalAmount),
            detailCount: 1,
            orderDetailCountSnapshot: 0,
            entryTime: context.task.billDate,
          };
        });

        await tx.insert(matchResults).values(resultValues);
        await tx.update(bankFlows).set({
          recognitionStatus: "recognized",
          incomeRuleId: Number(context.rule.id),
        }).where(eq(bankFlows.id, input.flowId));

        return { recognizedAmount: amountValidation.totalAmount };
      });

      await refreshTaskStatusByFlows(affectedTaskId);
      return { success: true, ...result };
    }),

  setActive: authedQuery
    .input(z.object({
      id: z.number(),
      isActive: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.update(incomeRecognitionRules).set({
        isActive: input.isActive ? 1 : 0,
        updatedAt: new Date(),
      }).where(eq(incomeRecognitionRules.id, input.id));
      return { success: true };
    }),

  // 删除
  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "recognition_rule_delete"))) throw new Error("权限不足");
      const db = getDb();
      await db.delete(incomeRuleSplits).where(eq(incomeRuleSplits.incomeRuleId, input.id));
      await db.delete(incomeRecognitionRules).where(eq(incomeRecognitionRules.id, input.id));
      return { success: true };
    }),

  // 执行到账认账（调用公共函数）
  execute: authedQuery
    .input(z.object({ taskId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [task] = await db
        .select({ billDate: recognitionTasks.billDate })
        .from(recognitionTasks)
        .where(eq(recognitionTasks.id, input.taskId));
      if (!task) throw new Error("任务不存在");
      const dateTasks = await db
        .select({ id: recognitionTasks.id })
        .from(recognitionTasks)
        .where(eq(recognitionTasks.billDate, task.billDate));
      let matchedCount = 0;
      let pendingAmountCount = 0;
      for (const item of dateTasks) {
        const result = await executeIncomeRecognition(item.id);
        matchedCount += Number(result.matchedCount || 0);
        pendingAmountCount += Number(result.pendingAmountCount || 0);
      }
      const messageParts = [`自动认账 ${matchedCount} 条银行流水`];
      if (pendingAmountCount > 0) messageParts.push(`${pendingAmountCount} 条等待填写认账金额`);
      return { matchedCount, pendingAmountCount, message: `到账认账完成：${messageParts.join("，")}` };
    }),

  // 统计
  stats: authedQuery.query(async () => {
    const db = getDb();
    const [ruleCount, activeCount] = await Promise.all([
      db.select({ count: count() }).from(incomeRecognitionRules),
      db.select({ count: count() }).from(incomeRecognitionRules).where(eq(incomeRecognitionRules.isActive, 1)),
    ]);
    return {
      total: ruleCount[0]?.count || 0,
      active: activeCount[0]?.count || 0,
    };
  }),
});
