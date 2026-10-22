import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { bankAccounts, bankFlows, counterpartyRecords, donationActivities, incomeRecognitionRules, matchResults, recognitionRules, recognitionTasks, ruleItems, voucherReceiptChannels, voucherResultFlows, voucherResultLines, voucherResults, voucherTemplateSettings, type VoucherTemplateRow, type VoucherTemplateSet, type VoucherTemplateType } from "@db/schema";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  assertBankFlowRecognitionEligible,
  isBankFlowRecognitionEligible,
} from "./lib/bankFlowRecognitionEligibility";
import { attachCounterpartyMatchers } from "./lib/counterpartyMatchers";
import { userHasPermission } from "./lib/permissions";
import {
  generatedVoucherIncomeTypes,
  getManualVoucherCancellationMatchResultIds,
  getPendingGeneratedVoucherMatchResultIds,
  groupPendingManualVoucherRequirements,
  isGeneratedVoucherIncomeType,
  isLegacyManualVoucherIncomeType,
  isManualVoucherIncomeType,
  isTemplateVoucherRecognitionResult,
  isVoucherScopeFullyCreated,
  manualVoucherIncomeTypes,
  needsInterestSummaryContent as shouldRequestInterestSummaryContent,
  type ManualVoucherIncomeType,
} from "./lib/voucherCreation";
import { buildVoucherOverviewLineExplanation, type VoucherOverviewLineExplanation } from "./lib/voucherOverviewExplanation";
import { getMultiDayMatchGroupByFlowId, getMultiDayMatchGroupFlows } from "./lib/multiDayDetailMatching";
import {
  buildInterestSummaryPreview,
  formatVoucherQuarter,
  renderVoucherTemplateRow,
} from "./lib/voucherTemplateRendering";
import {
  buildVoucherTemplateChoices,
  LEGACY_VOUCHER_TEMPLATE_SETTING_KEY,
  normalizeVoucherTemplates,
  resolveVoucherTemplateSets,
  VOUCHER_TEMPLATE_SETTING_KEY,
  type VoucherTemplateSelection,
} from "./lib/voucherTemplates";

function stripCodePrefix(value?: string | null) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.includes("-")) return text.split("-").slice(1).join("-").trim() || text;
  if (text.includes("_")) return text.split("_").slice(1).join("_").trim() || text;
  return text;
}

function extractPlatformName(value?: string | null) {
  const text = String(value || "").trim();
  const platformPart = text.includes(" / ") ? text.split(" / ")[0] : "";
  return stripCodePrefix(platformPart);
}

function formatManagementFeeRatio(value?: string | null) {
  const parsed = parseFloat(String(value ?? "0"));
  if (!Number.isFinite(parsed)) return "0";
  return Number.isInteger(parsed) ? String(parsed) : String(parsed).replace(/\.?0+$/, "");
}

function formatMoney(value?: string | null) {
  const parsed = Number(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed.toFixed(2) : "0.00";
}

function formatFlowDate(value?: string | null) {
  const text = String(value || "").trim();
  return text ? text.slice(0, 10) : "-";
}

function formatFlowMonth(value?: string | null) {
  const dateText = formatFlowDate(value);
  const match = /^(\d{4})-(\d{1,2})/.exec(dateText);
  if (!match) return "-";
  return `${match[1]}年${Number(match[2])}月`;
}

function getNextDateInputValue(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function assertVoucherFlowRecognitionEligible(flowId: number) {
  const db = getDb();
  const [flow] = await db.select({ income: bankFlows.income })
    .from(bankFlows)
    .where(eq(bankFlows.id, flowId));
  if (!flow) throw new Error("银行流水不存在");
  assertBankFlowRecognitionEligible(flow.income);
}

async function getVoucherTemplates() {
  const db = getDb();
  const rows = await db
    .select({
      settingKey: voucherTemplateSettings.settingKey,
      templates: voucherTemplateSettings.templates,
    })
    .from(voucherTemplateSettings)
    .where(inArray(voucherTemplateSettings.settingKey, [
      VOUCHER_TEMPLATE_SETTING_KEY,
      LEGACY_VOUCHER_TEMPLATE_SETTING_KEY,
    ]));
  const row = rows.find((item) => item.settingKey === VOUCHER_TEMPLATE_SETTING_KEY)
    || rows.find((item) => item.settingKey === LEGACY_VOUCHER_TEMPLATE_SETTING_KEY);
  return normalizeVoucherTemplates(row?.templates);
}

function extractLastSegment(value?: string | null) {
  const text = String(value || "").trim();
  if (!text) return "";
  const parts = text.split(/[_/／｜|>]+/).map((item) => item.trim()).filter(Boolean);
  return parts.at(-1) || text;
}

function hasTemplateContent(row: VoucherTemplateRow) {
  return Boolean(row.摘要 || row.科目编码 || row.科目名称 || row.借方金额 || row.贷方金额);
}

type VoucherLineType = "overview" | "project_fund" | "management_fee";
type VoucherDetailLineExplanation = Record<"年度" | "部门" | "客户档案" | "收款渠道" | "收入预算" | "项目名称" | "资金来源" | "收款活动类型", string>;
type VoucherLineExplanation = VoucherOverviewLineExplanation | VoucherDetailLineExplanation;

function firstMeaningfulValue(...values: Array<string | null | undefined>) {
  return values.map((value) => String(value || "").trim()).find((value) => value && value !== "-") || "-";
}

function getVoucherLineTypeByTemplateIndex(templateIndex: number): VoucherLineType {
  if (templateIndex === 0) return "overview";
  return templateIndex === 1 ? "project_fund" : "management_fee";
}

const manualVoucherInputSchema = z.object({
  incomeType: z.enum(manualVoucherIncomeTypes),
  voucherId: z.string().trim().min(1, "凭证ID不能为空").max(200, "凭证ID最长200字"),
});

const voucherTemplateTypeSchema = z.enum([
  "捐赠收入-到账认账模版",
  "捐赠收入-明细认账模版",
  "会费收入",
  "利息收入",
]);

const voucherTemplateSelectionSchema = z.object({
  templateType: voucherTemplateTypeSchema,
  templateId: z.string().trim().min(1).max(100),
});

function getVoucherTemplateType(row: { incomeType?: string | null; ruleItemId?: number | null }): VoucherTemplateType {
  if (row.incomeType === "会费收入") return "会费收入";
  if (row.incomeType === "利息") return "利息收入";
  return row.ruleItemId ? "捐赠收入-明细认账模版" : "捐赠收入-到账认账模版";
}

function getPendingVoucherTemplateTypes(
  rows: Array<{
    incomeType?: string | null;
    ruleItemId?: number | null;
    orderDetailCountSnapshot?: number | null;
    voucherStatus?: string | null;
  }>,
) {
  return Array.from(new Set(
    rows
      .filter((row) => row.voucherStatus !== "created" && isTemplateVoucherRecognitionResult(row))
      .map((row) => getVoucherTemplateType(row)),
  ));
}

function normalizeVoucherLineType(value?: string | null): VoucherLineType {
  if (value === "project_fund" || value === "management_fee") return value;
  return "overview";
}

function normalizeVoucherOverviewLineExplanation(value: unknown): VoucherOverviewLineExplanation {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    结算方式: String(source.结算方式 || "-"),
    银行账户: String(source.银行账户 || "-"),
  };
}

function normalizeVoucherDetailLineExplanation(value: unknown): VoucherDetailLineExplanation | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  return {
    年度: String(source.年度 || "-"),
    部门: String(source.部门 || "-"),
    客户档案: String(source.客户档案 || source.客户 || "-"),
    收款渠道: String(source.收款渠道 || "-"),
    收入预算: String(source.收入预算 || source.项目筹款预算 || "-"),
    项目名称: String(source.项目名称 || "-"),
    资金来源: String(source.资金来源 || "-"),
    收款活动类型: String(source.收款活动类型 || "-"),
  };
}

async function readDonationActivityCodeByName(activityNames: string[]) {
  const names = Array.from(new Set(activityNames.map((name) => name.trim()).filter(Boolean)));
  if (names.length === 0) return new Map<string, string>();
  const db = getDb();
  const rows = await db
    .select({ name: donationActivities.name, code: donationActivities.code })
    .from(donationActivities)
    .where(and(
      inArray(donationActivities.name, names),
      eq(donationActivities.level, 2),
      eq(donationActivities.isActive, 1),
    ));
  return new Map(rows.map((row) => [String(row.name), String(row.code)]));
}

function getDonationActivityDisplay(activityName: string, activityCodeByName: Map<string, string>) {
  const name = activityName.trim();
  if (!name) return "-";
  const code = activityCodeByName.get(name);
  return code ? `${code}_${name}` : "-";
}

type VoucherReceiptChannelDisplay = {
  name: string;
  fullName: string;
};

async function readVoucherReceiptChannelsByCode(channelCodes: string[]) {
  const codes = Array.from(new Set(channelCodes.map((code) => code.trim()).filter(Boolean)));
  if (codes.length === 0) return new Map<string, VoucherReceiptChannelDisplay>();
  const db = getDb();
  const rows = await db
    .select({
      channelCode: voucherReceiptChannels.channelCode,
      channelName: voucherReceiptChannels.channelName,
    })
    .from(voucherReceiptChannels)
    .where(inArray(voucherReceiptChannels.channelCode, codes));
  return new Map(rows.map((row) => {
    const channelCode = String(row.channelCode || "").trim();
    const channelName = String(row.channelName || "").trim();
    return [channelCode, {
      name: channelName || channelCode || "-",
      fullName: channelCode && channelName ? `${channelCode}_${channelName}` : channelName || channelCode || "-",
    }];
  }));
}

function getVoucherReceiptChannelDisplay(
  channelCode: string | undefined,
  channelByCode: Map<string, VoucherReceiptChannelDisplay>,
  fallback: string,
) {
  const code = String(channelCode || "").trim();
  const display = code ? channelByCode.get(code) : undefined;
  if (display) return display;
  const fallbackValue = String(fallback || code || "-").trim() || "-";
  return { name: fallbackValue, fullName: fallbackValue };
}

function buildVoucherDetailLineExplanation(
  row: {
    incomeType?: string | null;
    incomeDept?: string | null;
    budgetCode?: string | null;
    incomeProject?: string | null;
    expenseFundSource?: string | null;
  },
  variables: Record<string, string>,
  flowDate: string,
  activityCodeByName: Map<string, string>,
): VoucherDetailLineExplanation {
  const activityName = extractLastSegment(row.expenseFundSource);
  return {
    年度: flowDate && flowDate !== "-" ? flowDate.slice(0, 4) : "-",
    部门: firstMeaningfulValue(row.incomeDept),
    客户档案: row.incomeType === "利息" ? "北京市企业家环保基金会" : firstMeaningfulValue(variables["【到账户名】"]),
    收款渠道: firstMeaningfulValue(variables["【凭证收款渠道】"], variables["【到账户名】"], variables["【凭证收款渠道名称】"]),
    收入预算: firstMeaningfulValue(row.budgetCode),
    项目名称: firstMeaningfulValue(row.incomeProject),
    资金来源: firstMeaningfulValue(row.expenseFundSource),
    收款活动类型: row.incomeType === "利息"
      ? "801_其他收入"
      : row.incomeType === "会费收入"
        ? "101_日常捐赠"
        : getDonationActivityDisplay(activityName, activityCodeByName),
  };
}

function isAggregateDetailCounterparty(counterparty: any) {
  return counterparty?.recognitionType === "明细认账" && counterparty?.detailMatchingMode === "同日汇总匹配";
}

async function resolveVoucherFlowScope(flowId: number) {
  const db = getDb();
  const [flow] = await db
    .select({
      id: bankFlows.id,
      taskId: bankFlows.taskId,
      bankName: bankFlows.bankName,
      income: bankFlows.income,
      recognitionStatus: bankFlows.recognitionStatus,
      referenceNo: bankFlows.referenceNo,
      transactionTime: bankFlows.transactionTime,
      counterpartyName: bankFlows.counterpartyName,
      billDate: recognitionTasks.billDate,
      ruleId: recognitionTasks.ruleId,
      matchedCounterpartyAlias: recognitionRules.matchedCounterpartyAlias,
    })
    .from(bankFlows)
    .leftJoin(recognitionTasks, eq(recognitionTasks.id, bankFlows.taskId))
    .leftJoin(recognitionRules, eq(recognitionRules.id, recognitionTasks.ruleId))
    .where(eq(bankFlows.id, flowId));

  if (!flow) {
    return {
      selectedFlow: null,
      flowIds: [flowId],
      isAggregate: false,
      aggregateFlowCount: 0,
      unrecognizedFlowCount: 0,
      aggregateKind: "none" as const,
      startDate: "-",
      endDate: "-",
    };
  }

  const multiDayGroup = await getMultiDayMatchGroupByFlowId(flowId);
  if (multiDayGroup) {
    const groupFlowRows = await getMultiDayMatchGroupFlows(Number(multiDayGroup.id));
    const groupFlows = groupFlowRows.map((item) => item.flow);
    const selectedFlow = groupFlows[groupFlows.length - 1] || flow;
    const dates = groupFlowRows.map((item) => formatFlowDate(item.billDate || item.flow.transactionTime));
    return {
      selectedFlow,
      flowIds: groupFlows.map((item) => Number(item.id)).filter(Boolean),
      isAggregate: true,
      aggregateFlowCount: groupFlows.length,
      unrecognizedFlowCount: groupFlows.filter((item) => item.recognitionStatus !== "recognized").length,
      aggregateKind: "multi_day" as const,
      startDate: dates[0] || "-",
      endDate: dates[dates.length - 1] || "-",
    };
  }

  const alias = String(flow.matchedCounterpartyAlias || "").trim();
  const [counterpartyRow] = alias
    ? await db.select().from(counterpartyRecords).where(eq(counterpartyRecords.alias, alias))
    : [];
  const counterparty = await attachCounterpartyMatchers(db, counterpartyRow);
  if (!isAggregateDetailCounterparty(counterparty) || !flow.billDate || !flow.ruleId) {
    return {
      selectedFlow: flow,
      flowIds: [Number(flow.id)],
      isAggregate: false,
      aggregateFlowCount: 1,
      unrecognizedFlowCount: flow.recognitionStatus === "recognized" ? 0 : 1,
      aggregateKind: "none" as const,
      startDate: formatFlowDate(flow.transactionTime),
      endDate: formatFlowDate(flow.transactionTime),
    };
  }

  const aggregateFlows = await db.select().from(bankFlows)
    .where(eq(bankFlows.taskId, Number(flow.taskId)))
    .orderBy(asc(bankFlows.transactionTime), asc(bankFlows.id));
  const flowIds = aggregateFlows.map((item) => Number(item.id)).filter(Boolean);

  return {
    selectedFlow: flow,
    flowIds: flowIds.length > 0 ? flowIds : [Number(flow.id)],
    isAggregate: true,
    aggregateFlowCount: flowIds.length || 1,
    unrecognizedFlowCount: aggregateFlows.filter((item) => item.recognitionStatus !== "recognized").length,
    aggregateKind: "same_day" as const,
    startDate: formatFlowDate(flow.transactionTime),
    endDate: formatFlowDate(flow.transactionTime),
  };
}

async function readBankAccountAliasByFlowId(flowId?: number | null) {
  if (!flowId) return null;
  const db = getDb();
  const [row] = await db
    .select({ accountAlias: bankAccounts.accountAlias })
    .from(bankFlows)
    .leftJoin(bankAccounts, eq(bankAccounts.id, bankFlows.bankAccountId))
    .where(eq(bankFlows.id, flowId));
  return row?.accountAlias || null;
}

async function readVoucherCreationMatchResults(flowIds: number[]) {
  if (flowIds.length === 0) return [];
  const db = getDb();
  return db
    .select({
      id: matchResults.id,
      ruleItemId: matchResults.ruleItemId,
      orderDetailCountSnapshot: matchResults.orderDetailCountSnapshot,
      incomeType: matchResults.incomeType,
      splitAmount: matchResults.splitAmount,
      voucherStatus: matchResults.voucherStatus,
    })
    .from(matchResults)
    .where(inArray(matchResults.bankFlowId, flowIds))
    .orderBy(matchResults.id);
}

async function readGeneratedVoucherResultByFlow(flowId: number) {
  const db = getDb();
  const [row] = await db
    .select({
      id: voucherResults.id,
      creationGroupId: voucherResults.creationGroupId,
    })
    .from(voucherResultFlows)
    .innerJoin(voucherResults, eq(voucherResults.id, voucherResultFlows.voucherResultId))
    .where(and(
      eq(voucherResultFlows.bankFlowId, flowId),
      eq(voucherResults.voucherKind, "generated"),
    ))
    .orderBy(voucherResults.id)
    .limit(1);
  return row || null;
}

async function getVoucherCreationRequirementsByFlow(flowId: number) {
  const scope = await resolveVoucherFlowScope(flowId);
  if (!scope.selectedFlow) throw new Error("银行流水不存在");
  if (scope.isAggregate && scope.unrecognizedFlowCount > 0) {
    const label = scope.aggregateKind === "multi_day" ? "多日汇总匹配" : "同日汇总匹配";
    throw new Error(`该到账使用${label}，需汇总范围内的 ${scope.aggregateFlowCount} 笔银行到账全部已认账后才能制单。当前还有 ${scope.unrecognizedFlowCount} 笔未认账或部分认账。`);
  }
  const flowIds = scope.flowIds.length > 0 ? scope.flowIds : [flowId];
  const rows = await readVoucherCreationMatchResults(flowIds);
  const manualRequirements = groupPendingManualVoucherRequirements(rows);
  const pendingGeneratedMatchResultIds = getPendingGeneratedVoucherMatchResultIds(rows);
  const needsInterestSummaryContent = shouldRequestInterestSummaryContent(rows);
  const unsupportedIncomeTypes = Array.from(new Set(
    rows
      .filter((row) => row.voucherStatus !== "created")
      .map((row) => String(row.incomeType || "").trim())
      .filter((incomeType) => !isGeneratedVoucherIncomeType(incomeType) && !isManualVoucherIncomeType(incomeType)),
  ));
  const generatedVoucher = await readGeneratedVoucherResultByFlow(flowId);
  return {
    scope,
    flowIds,
    rows,
    manualRequirements,
    pendingGeneratedMatchResultIds,
    needsInterestSummaryContent,
    unsupportedIncomeTypes,
    generatedVoucher,
  };
}

async function buildVoucherPreviewByFlow(
  flowId: number,
  interestSummaryContent = "",
  selectedTemplateSets?: Map<VoucherTemplateType, VoucherTemplateSet>,
) {
  const db = getDb();
  const scope = await resolveVoucherFlowScope(flowId);
  const selectedFlow = scope.selectedFlow;
  const scopedFlowIds = scope.flowIds.length > 0 ? scope.flowIds : [flowId];
  const bankAccountAlias = await readBankAccountAliasByFlowId(selectedFlow?.id);

  const rows = await db
    .select({
      resultId: matchResults.id,
      ruleItemId: matchResults.ruleItemId,
      incomeRuleId: matchResults.incomeRuleId,
      orderDetailCountSnapshot: matchResults.orderDetailCountSnapshot,
      incomeType: matchResults.incomeType,
      incomeAttr: matchResults.incomeAttr,
      incomeDept: matchResults.incomeDept,
      budgetCode: matchResults.budgetCode,
      detailCount: matchResults.orderDetailCountSnapshot,
      incomeProject: matchResults.incomeProject,
      platformProjectName: matchResults.platformProjectName,
      platformProjectDisplayName: matchResults.platformProjectDisplayName,
      platformProjectDetail: matchResults.platformProjectDetail,
      memberName: matchResults.memberName,
      membershipPaymentYears: matchResults.membershipPaymentYears,
      managementFeeType: matchResults.managementFeeType,
      managementFeeValue: matchResults.managementFeeValue,
      managementFeeRatio: matchResults.managementFeeRatio,
      managementFeeAmount: matchResults.managementFeeAmount,
      splitAmount: matchResults.splitAmount,
      splitRatio: matchResults.splitRatio,
      expenseFundSource: matchResults.expenseFundSource,
      voucherReceiptChannelCode: matchResults.voucherReceiptChannelCode,
      bankCounterpartyName: matchResults.bankCounterpartyName,
      detailCounterpartyAlias: recognitionRules.matchedCounterpartyAlias,
      incomeCounterpartyAlias: incomeRecognitionRules.matchedCounterpartyAlias,
    })
    .from(matchResults)
    .leftJoin(ruleItems, eq(matchResults.ruleItemId, ruleItems.id))
    .leftJoin(recognitionRules, eq(ruleItems.ruleId, recognitionRules.id))
    .leftJoin(incomeRecognitionRules, eq(matchResults.incomeRuleId, incomeRecognitionRules.id))
    .where(inArray(matchResults.bankFlowId, scopedFlowIds))
    .orderBy(matchResults.id);

  const aliases = Array.from(new Set(
    rows
      .map((row) => row.incomeCounterpartyAlias || row.detailCounterpartyAlias || "")
      .map((alias) => alias.trim())
      .filter(Boolean),
  ));
  const summaryRows = aliases.length > 0
    ? await db
      .select({
        alias: counterpartyRecords.alias,
        summaryText: counterpartyRecords.voucherSummaryText,
        incomeName: counterpartyRecords.voucherIncomeName,
      })
      .from(counterpartyRecords)
      .where(inArray(counterpartyRecords.alias, aliases))
    : [];
  const voucherChannelCodeByAlias = new Map(
    summaryRows
      .filter((row) => row.alias && aliases.includes(row.alias) && String(row.incomeName || "").trim())
      .map((row) => [String(row.alias), String(row.incomeName || "").trim()]),
  );
  const rowVoucherChannelCodes = rows
    .map((row) => String(row.voucherReceiptChannelCode || "").trim())
    .filter(Boolean);
  const voucherChannelByCode = await readVoucherReceiptChannelsByCode([
    ...Array.from(voucherChannelCodeByAlias.values()),
    ...rowVoucherChannelCodes,
  ]);

  const voucherableRows = rows.filter((row) => isTemplateVoucherRecognitionResult({
    ruleItemId: row.ruleItemId,
    orderDetailCountSnapshot: row.orderDetailCountSnapshot,
    incomeType: row.incomeType,
  }));
  const templates = await getVoucherTemplates();
  const getSelectedTemplateRows = (templateType: VoucherTemplateType) =>
    selectedTemplateSets?.get(templateType)?.rows || templates[templateType][0].rows;
  const orderDetailTotal = voucherableRows.reduce((sum, row) => sum + Number(row.detailCount || 0), 0);
  const totalSplitAmount = voucherableRows.reduce((sum, row) => sum + Number(row.splitAmount || 0), 0);
  let voucherLineNo = 1;
  type VoucherSourceRow = (typeof rows)[number] & { resultIds?: number[] };
  const buildVoucherSourceRows = () => voucherableRows
    .map((row) => ({ ...row, resultIds: [Number(row.resultId)].filter(Boolean) }))
    .sort((a, b) => Number(a.resultId) - Number(b.resultId)) as VoucherSourceRow[];
  const voucherSourceRows = buildVoucherSourceRows();
  const flowDate = formatFlowDate(selectedFlow?.transactionTime);
  const flowMonth = formatFlowMonth(selectedFlow?.transactionTime);
  const flowQuarter = formatVoucherQuarter(selectedFlow?.transactionTime);
  const activityCodeByName = await readDonationActivityCodeByName(
    voucherableRows.map((row) => extractLastSegment(row.expenseFundSource)),
  );
  const buildVariables = (row: (typeof rows)[number], incomeAmount: number) => {
    const alias = String(row.incomeCounterpartyAlias || row.detailCounterpartyAlias || "").trim();
    const rowVoucherChannelCode = String(row.voucherReceiptChannelCode || "").trim();
    const voucherChannel = getVoucherReceiptChannelDisplay(rowVoucherChannelCode || voucherChannelCodeByAlias.get(alias), voucherChannelByCode, alias || "-");
    const detailCount = Number(row.detailCount || 0);
    const projectDetail = stripCodePrefix(row.platformProjectDetail);
    const incomeProject = stripCodePrefix(row.incomeProject);
    const platformName = extractPlatformName(row.platformProjectDisplayName || row.platformProjectName);
    const splitAmount = Number(row.splitAmount || 0);
    const managementFeeAmount = Number(row.managementFeeAmount || 0);
    return {
      "【到账户名】": String(row.bankCounterpartyName || selectedFlow?.counterpartyName || "-"),
      "【银行】": String(selectedFlow?.bankName || "-"),
      "【季度】": flowQuarter,
      "【捐赠活动】": extractLastSegment(row.expenseFundSource) || "-",
      "【NC项目名称】": incomeProject || "-",
      "【管理费比例】": formatManagementFeeRatio(row.managementFeeRatio),
      "【管理费】": formatMoney(row.managementFeeAmount),
      "【到账月份】": flowMonth,
      "【凭证收款渠道名称】": voucherChannel.name,
      "【凭证收款渠道】": voucherChannel.fullName,
      "【订单明细总计】": String(orderDetailTotal),
      "【入账金额】": formatMoney(String(incomeAmount)),
      "【分账金额】": formatMoney(String(splitAmount)),
      "【公益平台】": platformName || "-",
      "【项目详情】": projectDetail || "-",
      "【订单明细数】": String(detailCount),
      "【项目资金】": formatMoney(String(splitAmount - managementFeeAmount)),
      "【会员姓名】": row.memberName || "-",
      "【缴纳年限】": row.membershipPaymentYears ? String(row.membershipPaymentYears) : "-",
    };
  };
  const renderVoucherLine = (
    row: VoucherSourceRow,
    templateRow: VoucherTemplateRow,
    variables: Record<string, string>,
    lineType: VoucherLineType,
  ) => {
    const explanation = lineType === "overview"
      ? buildVoucherOverviewLineExplanation(bankAccountAlias)
      : buildVoucherDetailLineExplanation(row, variables, flowDate, activityCodeByName);
    const renderedTemplateRow = renderVoucherTemplateRow(
      templateRow,
      variables,
      row.incomeType,
      interestSummaryContent,
    );
    return {
      matchResultId: Number(row.resultId),
      matchResultIds: row.resultIds || [Number(row.resultId)].filter(Boolean),
      incomeType: row.incomeType,
      lineNo: voucherLineNo++,
      lineType,
      explanation,
      ...renderedTemplateRow,
    };
  };
  const voucherRows = [];
  const firstResult = voucherableRows[0];
  if (firstResult) {
    const firstTemplateType: VoucherTemplateType = getVoucherTemplateType(firstResult);
    const firstTemplateRow = getSelectedTemplateRows(firstTemplateType)[0];
    if (firstTemplateRow && hasTemplateContent(firstTemplateRow)) {
      voucherRows.push(renderVoucherLine(firstResult, firstTemplateRow, buildVariables(firstResult, totalSplitAmount), "overview"));
    }
  }
  for (const row of voucherSourceRows) {
    const templateType: VoucherTemplateType = getVoucherTemplateType(row);
    const variables = buildVariables(row, Number(row.splitAmount || 0));
    for (const [offset, templateRow] of getSelectedTemplateRows(templateType).slice(1).entries()) {
      if (hasTemplateContent(templateRow)) {
        voucherRows.push(renderVoucherLine(row, templateRow, variables, getVoucherLineTypeByTemplateIndex(offset + 1)));
      }
    }
  }
  return {
    flow: {
      date: flowDate,
      referenceNo: scope.aggregateKind === "multi_day"
        ? `${scope.startDate} 至 ${scope.endDate} · 多日汇总 ${scope.aggregateFlowCount} 笔银行到账`
        : scope.isAggregate
        ? `同日汇总 ${scope.aggregateFlowCount} 笔银行到账`
        : selectedFlow?.referenceNo || "-",
    },
    flowIds: scopedFlowIds,
    isAggregate: scope.isAggregate,
    aggregateFlowCount: scope.aggregateFlowCount,
    unrecognizedFlowCount: scope.unrecognizedFlowCount,
    rows: voucherRows,
  };
}

async function readVoucherResultByFlow(flowId: number) {
  const db = getDb();
  const [linked] = await db
    .select({
      voucherResultId: voucherResultFlows.voucherResultId,
    })
    .from(voucherResultFlows)
    .innerJoin(voucherResults, eq(voucherResults.id, voucherResultFlows.voucherResultId))
    .where(and(
      eq(voucherResultFlows.bankFlowId, flowId),
      eq(voucherResults.voucherKind, "generated"),
    ))
    .orderBy(voucherResults.id)
    .limit(1);
  const voucherResultId = Number(linked?.voucherResultId || 0);
  if (!voucherResultId) {
    return {
      voucherId: 0,
      flow: { date: "-", referenceNo: "-" },
      flowIds: [] as number[],
      isAggregate: false,
      aggregateFlowCount: 0,
      rows: [] as Array<{
        matchResultId: number;
        lineNo: number;
        lineType: VoucherLineType;
        explanation: VoucherLineExplanation | null;
        summary: string;
        subjectCode: string;
        subjectName: string;
        debitAmount: string;
        creditAmount: string;
      }>,
    };
  }

  const [voucher] = await db
    .select()
    .from(voucherResults)
    .where(eq(voucherResults.id, voucherResultId));
  const flowRows = await db
    .select({ bankFlowId: voucherResultFlows.bankFlowId })
    .from(voucherResultFlows)
    .where(eq(voucherResultFlows.voucherResultId, voucherResultId))
    .orderBy(asc(voucherResultFlows.sortOrder), asc(voucherResultFlows.id));
  const lineRows = await db
    .select()
    .from(voucherResultLines)
    .where(eq(voucherResultLines.voucherResultId, voucherResultId))
    .orderBy(asc(voucherResultLines.lineNo), asc(voucherResultLines.id));
  const voucherDate = voucher?.voucherDate || "-";

  return {
    voucherId: Number(voucher?.id || voucherResultId),
    flow: {
      date: voucherDate,
      referenceNo: voucher?.referenceText || "-",
    },
    flowIds: flowRows.map((item) => Number(item.bankFlowId)).filter(Boolean),
    isAggregate: Number(voucher?.isAggregate || 0) === 1,
    aggregateFlowCount: Number(voucher?.aggregateFlowCount || flowRows.length || 0),
    rows: lineRows.map((row) => {
      const lineType = normalizeVoucherLineType(row.lineType);
      return {
        matchResultId: Number(row.matchResultId || 0),
        lineNo: Number(row.lineNo),
        lineType,
        explanation: lineType === "overview"
          ? normalizeVoucherOverviewLineExplanation(row.explanationJson)
          : normalizeVoucherDetailLineExplanation(row.explanationJson),
        summary: row.summary,
        subjectCode: row.subjectCode,
        subjectName: row.subjectName,
        debitAmount: row.debitAmount,
        creditAmount: row.creditAmount,
      };
    }),
  };
}

async function createVoucherResultByFlow(
  flowId: number,
  userId: number,
  manualVouchers: Array<{ incomeType: ManualVoucherIncomeType; voucherId: string }> = [],
  interestSummaryContent = "",
  templateSelections: VoucherTemplateSelection[] = [],
) {
  const db = getDb();
  const context = await getVoucherCreationRequirementsByFlow(flowId);
  if (context.unsupportedIncomeTypes.length > 0) {
    throw new Error(`存在暂不支持制单的收入类型：${context.unsupportedIncomeTypes.map((item) => item || "未填写").join("、")}`);
  }
  if (context.manualRequirements.length === 0 && context.pendingGeneratedMatchResultIds.length === 0) {
    return {
      success: true,
      flowIds: context.flowIds,
      createdVoucherIds: [] as number[],
      alreadyCompleted: true,
    };
  }

  const normalizedInterestSummaryContent = interestSummaryContent.trim();

  const providedVoucherIdByType = new Map<ManualVoucherIncomeType, string>();
  for (const item of manualVouchers) {
    const voucherId = item.voucherId.trim();
    if (providedVoucherIdByType.has(item.incomeType)) {
      throw new Error(`${item.incomeType}凭证ID重复填写`);
    }
    providedVoucherIdByType.set(item.incomeType, voucherId);
  }
  for (const requirement of context.manualRequirements) {
    if (!providedVoucherIdByType.get(requirement.incomeType)) {
      throw new Error(`请填写${requirement.incomeType}凭证ID`);
    }
  }
  const pendingManualTypeSet = new Set(context.manualRequirements.map((item) => item.incomeType));
  const unexpectedManualType = Array.from(providedVoucherIdByType.keys()).find((incomeType) => !pendingManualTypeSet.has(incomeType));
  if (unexpectedManualType) throw new Error(`${unexpectedManualType}当前没有待制单入账结果`);

  if (context.generatedVoucher && context.pendingGeneratedMatchResultIds.length > 0) {
    throw new Error("该银行流水已有自动凭证且仍有待制单收入，请先取消自动凭证后重新制单");
  }

  const relevantTemplateTypes = getPendingVoucherTemplateTypes(context.rows);
  const selectedTemplateSets = resolveVoucherTemplateSets(
    await getVoucherTemplates(),
    relevantTemplateTypes,
    templateSelections,
  );
  const preview = await buildVoucherPreviewByFlow(
    flowId,
    normalizedInterestSummaryContent,
    selectedTemplateSets,
  );
  const pendingTemplateResult = context.rows.some((row) =>
    row.voucherStatus !== "created" && isTemplateVoucherRecognitionResult(row)
  );
  if (context.pendingGeneratedMatchResultIds.length > 0 && !context.generatedVoucher && preview.rows.length === 0) {
    throw new Error(pendingTemplateResult
      ? "该银行到账没有捐赠收入、到账认账订单退款、会费收入或利息的可生成凭证行，请维护对应凭证模板"
      : "订单退款需随捐赠收入凭证一并制单");
  }

  const creationGroupId = context.generatedVoucher?.creationGroupId || randomUUID();
  const canonicalSourceFlowId = Math.min(...context.flowIds);
  const createdVoucherIds: number[] = [];
  await db.transaction(async (tx) => {
    let generatedVoucherResultId = Number(context.generatedVoucher?.id || 0);
    if (generatedVoucherResultId && !context.generatedVoucher?.creationGroupId) {
      await tx.update(voucherResults)
        .set({ creationGroupId })
        .where(eq(voucherResults.id, generatedVoucherResultId));
    }
    if (!generatedVoucherResultId && context.pendingGeneratedMatchResultIds.length > 0) {
      const inserted = await tx.insert(voucherResults).values({
        sourceFlowId: canonicalSourceFlowId,
        voucherDate: preview.flow.date || "-",
        referenceText: preview.flow.referenceNo || "-",
        voucherKind: "generated",
        voucherKey: "generated",
        creationGroupId,
        isAggregate: preview.isAggregate ? 1 : 0,
        aggregateFlowCount: preview.aggregateFlowCount || preview.flowIds.length || 1,
        createdBy: userId,
      }).$returningId();
      generatedVoucherResultId = Number(inserted[0]?.id || 0);
      if (!generatedVoucherResultId) throw new Error("生成制单结果失败");
      createdVoucherIds.push(generatedVoucherResultId);
      await tx.insert(voucherResultFlows).values(
        preview.flowIds.map((bankFlowId, index) => ({
          voucherResultId: generatedVoucherResultId,
          bankFlowId,
          sortOrder: index + 1,
        })),
      );
      await tx.insert(voucherResultLines).values(
        preview.rows.map((row) => ({
          voucherResultId: generatedVoucherResultId,
          matchResultId: row.matchResultId || null,
          lineNo: row.lineNo,
          lineType: row.lineType,
          summary: row.summary,
          subjectCode: row.subjectCode,
          subjectName: row.subjectName,
          debitAmount: row.debitAmount,
          creditAmount: row.creditAmount,
          explanationJson: row.explanation,
        })),
      );
    }

    for (const requirement of context.manualRequirements) {
      const inserted = await tx.insert(voucherResults).values({
        sourceFlowId: canonicalSourceFlowId,
        voucherDate: preview.flow.date || "-",
        referenceText: preview.flow.referenceNo || "-",
        voucherKind: "manual",
        voucherKey: `manual:${requirement.incomeType}`,
        voucherIdText: providedVoucherIdByType.get(requirement.incomeType)!,
        incomeType: requirement.incomeType,
        voucherAmount: requirement.amount.toFixed(2),
        creationGroupId,
        isAggregate: preview.isAggregate ? 1 : 0,
        aggregateFlowCount: preview.aggregateFlowCount || preview.flowIds.length || 1,
        createdBy: userId,
      }).$returningId();
      const manualVoucherResultId = Number(inserted[0]?.id || 0);
      if (!manualVoucherResultId) throw new Error(`保存${requirement.incomeType}凭证ID失败`);
      createdVoucherIds.push(manualVoucherResultId);
      await tx.insert(voucherResultFlows).values(
        preview.flowIds.map((bankFlowId, index) => ({
          voucherResultId: manualVoucherResultId,
          bankFlowId,
          sortOrder: index + 1,
        })),
      );
      await tx.update(matchResults)
        .set({ voucherStatus: "created" })
        .where(inArray(matchResults.id, requirement.matchResultIds));
    }

    if (generatedVoucherResultId && context.pendingGeneratedMatchResultIds.length > 0) {
      await tx.update(matchResults)
        .set({ voucherStatus: "created" })
        .where(inArray(matchResults.id, context.pendingGeneratedMatchResultIds));
    }
  });

  return {
    success: true,
    flowIds: context.flowIds,
    createdVoucherIds,
    alreadyCompleted: false,
  };
}

async function createBatchVoucherResultsByTask(taskId: number, userId: number) {
  const db = getDb();
  const [task] = await db
    .select({ billDate: recognitionTasks.billDate })
    .from(recognitionTasks)
    .where(eq(recognitionTasks.id, taskId));
  if (!task?.billDate) throw new Error("日期汇总不存在");

  const dateTasks = await db
    .select({ id: recognitionTasks.id })
    .from(recognitionTasks)
    .where(eq(recognitionTasks.billDate, task.billDate));
  const taskIds = dateTasks.map((item) => Number(item.id)).filter(Boolean);
  if (taskIds.length === 0) {
    return {
      billDate: task.billDate,
      recognizedFlowCount: 0,
      pendingFlowCount: 0,
      createdVoucherCount: 0,
      createdFlowCount: 0,
      skippedAlreadyCreatedCount: 0,
      skippedTemplateSelectionCount: 0,
      skippedManualVoucherCount: 0,
      needsManualProcessingCount: 0,
      failedCount: 0,
      failures: [] as Array<{ flowId: number; message: string }>,
    };
  }

  const recognizedFlows = await db
    .select({ id: bankFlows.id })
    .from(bankFlows)
    .where(and(
      inArray(bankFlows.taskId, taskIds),
      gt(bankFlows.income, "0"),
      eq(bankFlows.recognitionStatus, "recognized"),
    ))
    .orderBy(bankFlows.id);
  const recognizedFlowIds = recognizedFlows.map((item) => Number(item.id)).filter(Boolean);
  if (recognizedFlowIds.length === 0) {
    return {
      billDate: task.billDate,
      recognizedFlowCount: 0,
      pendingFlowCount: 0,
      createdVoucherCount: 0,
      createdFlowCount: 0,
      skippedAlreadyCreatedCount: 0,
      skippedTemplateSelectionCount: 0,
      skippedManualVoucherCount: 0,
      needsManualProcessingCount: 0,
      failedCount: 0,
      failures: [] as Array<{ flowId: number; message: string }>,
    };
  }

  const voucherStatusRows = await db
    .select({
      bankFlowId: matchResults.bankFlowId,
      resultCount: sql<number>`COUNT(*)`,
      pendingCount: sql<number>`SUM(CASE WHEN ${matchResults.voucherStatus} = 'pending' THEN 1 ELSE 0 END)`,
    })
    .from(matchResults)
    .where(inArray(matchResults.bankFlowId, recognizedFlowIds))
    .groupBy(matchResults.bankFlowId);
  const completedFlowIds = new Set(
    voucherStatusRows
      .filter((item) => Number(item.resultCount || 0) > 0 && Number(item.pendingCount || 0) === 0)
      .map((item) => Number(item.bankFlowId)),
  );
  const pendingFlowIds = recognizedFlowIds.filter((flowId) => !completedFlowIds.has(flowId));
  if (pendingFlowIds.length > 500) {
    throw new Error(`当日待制单银行流水 ${pendingFlowIds.length} 条，超过单次批量制单上限 500 条，请拆分处理或改用后台队列。`);
  }

  const createdVoucherIds = new Set<number>();
  const createdFlowIds = new Set<number>();
  const handledFlowIds = new Set<number>();
  const templateSelectionFlowIds = new Set<number>();
  const manualVoucherFlowIds = new Set<number>();
  const failureFlowIds = new Set<number>();
  const failures: Array<{ flowId: number; message: string }> = [];
  const pendingFlowIdSet = new Set(pendingFlowIds);
  const templates = await getVoucherTemplates();

  for (const flowId of pendingFlowIds) {
    if (handledFlowIds.has(flowId)) continue;

    let currentScopeFlowIds = [flowId];
    try {
      const requirements = await getVoucherCreationRequirementsByFlow(flowId);
      const scopedPendingFlowIds = requirements.flowIds.filter((id) => pendingFlowIdSet.has(id));
      const handledScopeFlowIds = scopedPendingFlowIds.length > 0 ? scopedPendingFlowIds : [flowId];
      currentScopeFlowIds = handledScopeFlowIds;
      handledScopeFlowIds.forEach((id) => handledFlowIds.add(id));
      if (requirements.manualRequirements.length > 0) {
        handledScopeFlowIds.forEach((id) => manualVoucherFlowIds.add(id));
        continue;
      }
      const relevantTemplateTypes = getPendingVoucherTemplateTypes(requirements.rows);
      if (relevantTemplateTypes.some((templateType) => templates[templateType].length > 1)) {
        handledScopeFlowIds.forEach((id) => templateSelectionFlowIds.add(id));
        continue;
      }
      const created = await createVoucherResultByFlow(flowId, userId);
      created.createdVoucherIds.forEach((id) => createdVoucherIds.add(Number(id)));
      created.flowIds.forEach((id) => {
        if (pendingFlowIdSet.has(id)) createdFlowIds.add(id);
      });
    } catch (error: any) {
      const message = error?.message || "生成凭证失败";
      if (message.includes("请选择") && message.includes("模板名称")) {
        currentScopeFlowIds.forEach((id) => {
          handledFlowIds.add(id);
          templateSelectionFlowIds.add(id);
        });
        continue;
      }
      currentScopeFlowIds.forEach((id) => {
        handledFlowIds.add(id);
        failureFlowIds.add(id);
      });
      failures.push({
        flowId,
        message,
      });
    }
  }

  return {
    billDate: task.billDate,
    recognizedFlowCount: recognizedFlowIds.length,
    pendingFlowCount: pendingFlowIds.length,
    createdVoucherCount: createdVoucherIds.size,
    createdFlowCount: createdFlowIds.size,
    skippedAlreadyCreatedCount: completedFlowIds.size,
    skippedTemplateSelectionCount: templateSelectionFlowIds.size,
    skippedManualVoucherCount: manualVoucherFlowIds.size,
    needsManualProcessingCount: Math.max(0, pendingFlowIds.length - createdFlowIds.size),
    failedCount: failureFlowIds.size,
    failures: failures.slice(0, 5),
  };
}

async function listManualVoucherResultsByFlow(flowId: number) {
  const db = getDb();
  const rows = await db
    .select({
      voucherResultId: voucherResults.id,
      incomeType: voucherResults.incomeType,
      voucherId: voucherResults.voucherIdText,
      voucherAmount: voucherResults.voucherAmount,
    })
    .from(voucherResultFlows)
    .innerJoin(voucherResults, eq(voucherResults.id, voucherResultFlows.voucherResultId))
    .where(and(
      eq(voucherResultFlows.bankFlowId, flowId),
      eq(voucherResults.voucherKind, "manual"),
    ))
    .orderBy(voucherResults.id);
  return rows.map((row) => ({
    voucherResultId: Number(row.voucherResultId),
    incomeType: String(row.incomeType || "-"),
    voucherId: String(row.voucherId || "-"),
    voucherAmount: Number(row.voucherAmount || 0).toFixed(2),
  }));
}

async function cancelManualVoucherResult(voucherResultId: number) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const [voucher] = await tx
      .select({
        id: voucherResults.id,
        incomeType: voucherResults.incomeType,
      })
      .from(voucherResults)
      .where(and(
        eq(voucherResults.id, voucherResultId),
        eq(voucherResults.voucherKind, "manual"),
      ))
      .limit(1);
    if (!voucher || !isLegacyManualVoucherIncomeType(voucher.incomeType)) {
      throw new Error("手工凭证不存在或已取消");
    }

    const flowRows = await tx
      .select({ bankFlowId: voucherResultFlows.bankFlowId })
      .from(voucherResultFlows)
      .where(eq(voucherResultFlows.voucherResultId, voucherResultId));
    const flowIds = Array.from(new Set(flowRows.map((row) => Number(row.bankFlowId)).filter(Boolean)));
    if (flowIds.length === 0) throw new Error("手工凭证未关联银行流水");
    const flowAmounts = await tx.select({ income: bankFlows.income })
      .from(bankFlows)
      .where(inArray(bankFlows.id, flowIds));
    if (flowAmounts.some((flow) => !isBankFlowRecognitionEligible(flow.income))) {
      throw new Error("支出流水仅供查看，不支持取消凭证");
    }

    const recognitionRows = await tx
      .select({
        id: matchResults.id,
        incomeType: matchResults.incomeType,
        voucherStatus: matchResults.voucherStatus,
      })
      .from(matchResults)
      .where(inArray(matchResults.bankFlowId, flowIds));
    const matchResultIds = getManualVoucherCancellationMatchResultIds(
      recognitionRows,
      voucher.incomeType,
    );

    await tx.delete(voucherResultLines).where(eq(voucherResultLines.voucherResultId, voucherResultId));
    await tx.delete(voucherResultFlows).where(eq(voucherResultFlows.voucherResultId, voucherResultId));
    await tx.delete(voucherResults).where(eq(voucherResults.id, voucherResultId));
    if (matchResultIds.length > 0) {
      await tx.update(matchResults)
        .set({ voucherStatus: "pending" })
        .where(inArray(matchResults.id, matchResultIds));
    }

    return {
      success: true,
      incomeType: voucher.incomeType,
      flowIds,
      restoredResultCount: matchResultIds.length,
    };
  });
}

async function cancelVoucherResultByFlow(flowId: number) {
  const db = getDb();
  const generatedVoucher = await readGeneratedVoucherResultByFlow(flowId);
  const voucherResultId = Number(generatedVoucher?.id || 0);
  if (!voucherResultId) return { success: true };

  const flowRows = await db
    .select({ bankFlowId: voucherResultFlows.bankFlowId })
    .from(voucherResultFlows)
    .where(eq(voucherResultFlows.voucherResultId, voucherResultId));
  const flowIds = Array.from(new Set(flowRows.map((row) => Number(row.bankFlowId || 0)).filter(Boolean)));
  const lineRows = await db
    .select({ matchResultId: voucherResultLines.matchResultId })
    .from(voucherResultLines)
    .where(eq(voucherResultLines.voucherResultId, voucherResultId));
  const lineMatchResultIds = lineRows.map((row) => Number(row.matchResultId || 0)).filter(Boolean);
  const flowMatchResultRows = flowIds.length > 0
    ? await db
      .select({ id: matchResults.id })
      .from(matchResults)
      .where(and(
        inArray(matchResults.bankFlowId, flowIds),
        eq(matchResults.voucherStatus, "created"),
        inArray(matchResults.incomeType, [...generatedVoucherIncomeTypes]),
      ))
    : [];
  const matchResultIds = Array.from(new Set([
    ...lineMatchResultIds,
    ...flowMatchResultRows.map((row) => Number(row.id || 0)).filter(Boolean),
  ]));

  await db.transaction(async (tx) => {
    await tx.delete(voucherResultLines).where(eq(voucherResultLines.voucherResultId, voucherResultId));
    await tx.delete(voucherResultFlows).where(eq(voucherResultFlows.voucherResultId, voucherResultId));
    await tx.delete(voucherResults).where(eq(voucherResults.id, voucherResultId));
    if (matchResultIds.length > 0) {
      await tx.update(matchResults)
        .set({ voucherStatus: "pending" })
        .where(inArray(matchResults.id, matchResultIds));
    }
  });

  return { success: true };
}

export const voucherSummaryRouter = createRouter({
  list: authedQuery
    .input(z.object({
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(50),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      flowStatus: z.enum(["processing", "unrecognized", "partial_matched", "recognized", "recognized_with_voucher", "large_variance"]).optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const page = input?.page || 1;
      const pageSize = input?.pageSize || 50;
      const conditions = [];
      if (input?.startDate) {
        conditions.push(sql`${bankFlows.transactionTime} >= ${input.startDate}`);
      }
      if (input?.endDate) {
        const nextEndDate = getNextDateInputValue(input.endDate);
        conditions.push(nextEndDate
          ? sql`${bankFlows.transactionTime} < ${nextEndDate}`
          : sql`${bankFlows.transactionTime} <= ${input.endDate}`);
      }
      if (input?.flowStatus === "processing") {
        conditions.push(eq(recognitionTasks.status, "processing"));
      } else if (input?.flowStatus === "large_variance") {
        conditions.push(sql`(${bankFlows.recognitionStatus} = 'large_variance' OR ${recognitionTasks.status} = 'large_variance')`);
      } else if (input?.flowStatus === "recognized") {
        conditions.push(eq(bankFlows.recognitionStatus, "recognized"));
        conditions.push(sql`EXISTS (
          SELECT 1 FROM match_results pending_result
          WHERE pending_result.bank_flow_id = ${bankFlows.id}
            AND pending_result.voucher_status = 'pending'
        )`);
      } else if (input?.flowStatus === "recognized_with_voucher") {
        conditions.push(eq(bankFlows.recognitionStatus, "recognized"));
        conditions.push(sql`${voucherResults.id} IS NOT NULL`);
        conditions.push(sql`NOT EXISTS (
          SELECT 1 FROM match_results pending_result
          WHERE pending_result.bank_flow_id = ${bankFlows.id}
            AND pending_result.voucher_status = 'pending'
        )`);
      } else if (input?.flowStatus) {
        conditions.push(eq(bankFlows.recognitionStatus, input.flowStatus));
      }
      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
      const groupKey = sql<string>`COALESCE(CONCAT('v:', ${voucherResults.id}), CONCAT('f:', ${bankFlows.id}))`;
      const items = await db
        .select({
          groupKey,
          sourceFlowId: sql<number>`COALESCE(MAX(${voucherResults.sourceFlowId}), MIN(${bankFlows.id}))`,
          flowIds: sql<string>`GROUP_CONCAT(${bankFlows.id} ORDER BY ${bankFlows.transactionTime} DESC, ${bankFlows.id} DESC SEPARATOR ',')`,
          flowDate: sql<string>`MAX(${bankFlows.transactionTime})`,
          referenceNo: sql<string>`GROUP_CONCAT(${bankFlows.referenceNo} ORDER BY ${bankFlows.transactionTime} DESC, ${bankFlows.id} DESC SEPARATOR '，')`,
          income: sql<string>`COALESCE(SUM(CAST(${bankFlows.income} AS DECIMAL(18,2))), 0.00)`,
          flowCount: sql<number>`COUNT(*)`,
          processingCount: sql<number>`SUM(CASE WHEN ${recognitionTasks.status} = 'processing' THEN 1 ELSE 0 END)`,
          largeVarianceCount: sql<number>`SUM(CASE WHEN ${bankFlows.recognitionStatus} = 'large_variance' OR ${recognitionTasks.status} = 'large_variance' THEN 1 ELSE 0 END)`,
          recognizedCount: sql<number>`SUM(CASE WHEN ${bankFlows.recognitionStatus} = 'recognized' THEN 1 ELSE 0 END)`,
          partialMatchedCount: sql<number>`SUM(CASE WHEN ${bankFlows.recognitionStatus} = 'partial_matched' OR ${recognitionTasks.status} = 'partial_matched' OR COALESCE(${recognitionTasks.matchedCount}, 0) > 0 THEN 1 ELSE 0 END)`,
          taskDiffAmount: sql<string>`MAX(${recognitionTasks.diffAmount})`,
          voucherResultId: sql<number>`MAX(${voucherResults.id})`,
          voucherDate: sql<string>`MAX(${voucherResults.voucherDate})`,
          voucherKind: sql<string>`MAX(${voucherResults.voucherKind})`,
          voucherIdText: sql<string>`MAX(${voucherResults.voucherIdText})`,
          voucherIncomeType: sql<string>`MAX(${voucherResults.incomeType})`,
          manualVoucherAmount: sql<string>`MAX(${voucherResults.voucherAmount})`,
        })
        .from(bankFlows)
        .leftJoin(recognitionTasks, eq(recognitionTasks.id, bankFlows.taskId))
        .leftJoin(voucherResultFlows, eq(voucherResultFlows.bankFlowId, bankFlows.id))
        .leftJoin(voucherResults, eq(voucherResults.id, voucherResultFlows.voucherResultId))
        .where(whereClause)
        .groupBy(groupKey)
        .orderBy(sql`MAX(${bankFlows.transactionTime}) DESC`, sql`MAX(${bankFlows.id}) DESC`)
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const flowIds = items
        .flatMap((item) => String(item.flowIds || "").split(","))
        .map((id) => Number(id))
        .filter(Boolean);
      const voucherIds = items.map((item) => Number(item.voucherResultId || 0)).filter(Boolean);
      const recognizedAmountRows = flowIds.length > 0
        ? await db
          .select({
            bankFlowId: matchResults.bankFlowId,
            total: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
            resultCount: sql<number>`COUNT(*)`,
            pendingVoucherCount: sql<number>`SUM(CASE WHEN ${matchResults.voucherStatus} = 'pending' THEN 1 ELSE 0 END)`,
          })
          .from(matchResults)
          .where(inArray(matchResults.bankFlowId, flowIds))
          .groupBy(matchResults.bankFlowId)
        : [];
      const recognizedAmountByFlowId = new Map(
        recognizedAmountRows.map((row) => [Number(row.bankFlowId), {
          total: Number(row.total || 0),
          resultCount: Number(row.resultCount || 0),
          pendingVoucherCount: Number(row.pendingVoucherCount || 0),
        }]),
      );
      const voucherAmountRows = voucherIds.length > 0
        ? await db
          .select({
            voucherResultId: voucherResultLines.voucherResultId,
            debitCount: sql<number>`SUM(CASE WHEN TRIM(COALESCE(${voucherResultLines.debitAmount}, '')) <> '' THEN 1 ELSE 0 END)`,
            debitTotal: sql<string>`COALESCE(SUM(CASE WHEN TRIM(COALESCE(${voucherResultLines.debitAmount}, '')) <> '' THEN CAST(${voucherResultLines.debitAmount} AS DECIMAL(18,2)) ELSE 0 END), 0.00)`,
          })
          .from(voucherResultLines)
          .where(inArray(voucherResultLines.voucherResultId, voucherIds))
          .groupBy(voucherResultLines.voucherResultId)
        : [];
      const voucherAmountById = new Map(
        voucherAmountRows.map((row) => [Number(row.voucherResultId), {
          debitCount: Number(row.debitCount || 0),
          debitTotal: Number(row.debitTotal || 0),
        }]),
      );
      const [totalRow] = await db
        .select({ count: sql<number>`COUNT(DISTINCT ${groupKey})` })
        .from(bankFlows)
        .leftJoin(recognitionTasks, eq(recognitionTasks.id, bankFlows.taskId))
        .leftJoin(voucherResultFlows, eq(voucherResultFlows.bankFlowId, bankFlows.id))
        .leftJoin(voucherResults, eq(voucherResults.id, voucherResultFlows.voucherResultId))
        .where(whereClause);
      return {
        items: items.map((item) => {
          const flowId = Number(item.sourceFlowId);
          const voucherResultId = Number(item.voucherResultId || 0);
          const groupFlowIds = String(item.flowIds || "").split(",").map((id) => Number(id)).filter(Boolean);
          const recognizedAmount = groupFlowIds.reduce((sum, id) => sum + (recognizedAmountByFlowId.get(id)?.total || 0), 0);
          const isFullyVouchered = isVoucherScopeFullyCreated(
            groupFlowIds.map((id) => recognizedAmountByFlowId.get(id)),
          );
          const voucherAmount = voucherAmountById.get(voucherResultId);
          const isManualVoucher = item.voucherKind === "manual";
          let status: "processing" | "unrecognized" | "partial_matched" | "recognized" | "variance_partial_matched" | "variance_unrecognized" = "unrecognized";
          if (Number(item.processingCount || 0) > 0) {
            status = "processing";
          } else if (Number(item.largeVarianceCount || 0) > 0) {
            status = recognizedAmount > 0.01 ? "variance_partial_matched" : "variance_unrecognized";
          } else if (Number(item.recognizedCount || 0) === Number(item.flowCount || 0)) {
            status = "recognized";
          } else if (Number(item.partialMatchedCount || 0) > 0 || recognizedAmount > 0.01) {
            status = "partial_matched";
          }
          return {
            id: flowId,
            groupKey: item.groupKey,
            flowDate: formatFlowDate(item.flowDate),
            transactionTime: item.flowDate,
            referenceNo: item.referenceNo,
            income: Number(item.income || 0).toFixed(2),
            status,
            hasVoucher: voucherResultId > 0 && isFullyVouchered,
            hasView: voucherResultId > 0 && !isManualVoucher,
            voucherKind: item.voucherKind || null,
            voucherResultId: voucherResultId || null,
            voucherIncomeType: item.voucherIncomeType || null,
            voucherId: isManualVoucher ? item.voucherIdText || null : voucherResultId || null,
            voucherDate: item.voucherDate || null,
            voucherAmount: isManualVoucher
              ? item.manualVoucherAmount || null
              : voucherAmount && voucherAmount.debitCount > 0
                ? voucherAmount.debitTotal.toFixed(2)
                : null,
            recognitionDiffAmount: item.taskDiffAmount || "0.00",
            flowCount: Number(item.flowCount || 0),
          };
        }),
        total: Number(totalRow?.count || 0),
        page,
        pageSize,
      };
    }),

  previewByFlow: authedQuery
    .input(z.object({ flowId: z.number() }))
    .query(async ({ input }) => {
      return readVoucherResultByFlow(input.flowId);
    }),

  prepareCreateByFlow: authedQuery
    .input(z.object({ flowId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (!(await userHasPermission(ctx.user, "voucher_create"))) throw new Error("权限不足");
      await assertVoucherFlowRecognitionEligible(input.flowId);
      const requirements = await getVoucherCreationRequirementsByFlow(input.flowId);
      if (requirements.unsupportedIncomeTypes.length > 0) {
        throw new Error(`存在暂不支持制单的收入类型：${requirements.unsupportedIncomeTypes.map((item) => item || "未填写").join("、")}`);
      }
      const relevantTemplateTypes = getPendingVoucherTemplateTypes(requirements.rows);
      const templateChoices = buildVoucherTemplateChoices(
        await getVoucherTemplates(),
        relevantTemplateTypes,
      );
      const interestSummaryPreview = requirements.needsInterestSummaryContent
        ? buildInterestSummaryPreview((await buildVoucherPreviewByFlow(input.flowId)).rows)
        : "";
      return {
        manualVouchers: requirements.manualRequirements.map((item) => ({
          incomeType: item.incomeType,
          amount: item.amount.toFixed(2),
        })),
        needsGeneratedVoucher: requirements.pendingGeneratedMatchResultIds.length > 0,
        templateChoices,
        needsTemplateSelection: templateChoices.some((item) => item.requiresSelection),
        needsInterestSummaryContent: requirements.needsInterestSummaryContent,
        interestSummaryPreview,
        hasGeneratedVoucher: Boolean(requirements.generatedVoucher),
        alreadyCompleted: requirements.manualRequirements.length === 0
          && requirements.pendingGeneratedMatchResultIds.length === 0,
      };
    }),

  previewInterestSummaryByFlow: authedQuery
    .input(z.object({
      flowId: z.number(),
      templateSelections: z.array(voucherTemplateSelectionSchema).default([]),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!(await userHasPermission(ctx.user, "voucher_create"))) throw new Error("权限不足");
      await assertVoucherFlowRecognitionEligible(input.flowId);
      const requirements = await getVoucherCreationRequirementsByFlow(input.flowId);
      if (!requirements.needsInterestSummaryContent) return { interestSummaryPreview: "" };
      const relevantTemplateTypes = getPendingVoucherTemplateTypes(requirements.rows);
      const templates = await getVoucherTemplates();
      const providedSelectionByType = new Map(
        input.templateSelections.map((item) => [item.templateType, item.templateId]),
      );
      const completeSelections = relevantTemplateTypes.map((templateType) => ({
        templateType,
        templateId: providedSelectionByType.get(templateType) || templates[templateType][0].id,
      }));
      const selectedTemplateSets = resolveVoucherTemplateSets(
        templates,
        relevantTemplateTypes,
        completeSelections,
      );
      const preview = await buildVoucherPreviewByFlow(input.flowId, "", selectedTemplateSets);
      return {
        interestSummaryPreview: buildInterestSummaryPreview(preview.rows),
      };
    }),

  listManualByFlow: authedQuery
    .input(z.object({ flowId: z.number() }))
    .query(async ({ input, ctx }) => {
      if (!(await userHasPermission(ctx.user, "voucher_create"))) throw new Error("权限不足");
      return { items: await listManualVoucherResultsByFlow(input.flowId) };
    }),

  validateCreateByFlow: authedQuery
    .input(z.object({
      flowId: z.number(),
      manualVouchers: z.array(manualVoucherInputSchema).default([]),
      interestSummaryContent: z.string().trim().max(500, "摘要内容最长500字").default(""),
      templateSelections: z.array(voucherTemplateSelectionSchema).default([]),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!(await userHasPermission(ctx.user, "voucher_create"))) throw new Error("权限不足");
      await assertVoucherFlowRecognitionEligible(input.flowId);
      return createVoucherResultByFlow(
        input.flowId,
        Number(ctx.user.id),
        input.manualVouchers,
        input.interestSummaryContent,
        input.templateSelections,
      );
    }),

  createBatchByTask: authedQuery
    .input(z.object({ taskId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (!(await userHasPermission(ctx.user, "voucher_create"))) throw new Error("权限不足");
      return createBatchVoucherResultsByTask(input.taskId, Number(ctx.user.id));
    }),

  cancelByFlow: authedQuery
    .input(z.object({ flowId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "voucher_cancel"))) throw new Error("权限不足");
      await assertVoucherFlowRecognitionEligible(input.flowId);
      return cancelVoucherResultByFlow(input.flowId);
    }),

  cancelManual: authedQuery
    .input(z.object({ voucherResultId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "voucher_create"))) throw new Error("权限不足");
      return cancelManualVoucherResult(input.voucherResultId);
    }),
});
