import { z } from "zod";
import { calculateManagementFeeAmount, formatCents, toCents } from "./splitAmounts";

export const recognitionResultIncomeTypes = [
  "捐赠收入",
  "会费收入",
  "政府补助",
  "个税返还",
  "本金",
  "投资收益",
  "利息",
  "其他收入",
  "其他",
  "订单退款",
] as const;

const donationSourceValues = ["互联网募捐平台", "银行直捐", "拍卖"] as const;
const donationAttributeIncomeTypes = new Set(["捐赠收入", "订单退款"]);
const regionValues = ["北京市", "外省市", "港澳台", "境外", "内部客商"] as const;
const simpleIncomeTypes = new Set(["政府补助", "利息", "个税返还", "本金", "投资收益"]);
const remarkOnlyIncomeTypes = new Set(["其他收入", "其他"]);
const interestExpenseFundSource = "非限定性-利息收入";

export const recognitionResultAttributesInput = z.object({
  incomeType: z.enum(recognitionResultIncomeTypes),
  donationSource: z.enum(donationSourceValues).nullable().optional(),
  incomeAttr: z.string().nullable().optional(),
  remark: z.string().max(500, "备注最长500字").nullable().optional(),
  incomeDept: z.string().nullable().optional(),
  budgetCode: z.string().nullable().optional(),
  incomeProject: z.string().nullable().optional(),
  platformProjectName: z.string().nullable().optional(),
  platformProjectDetail: z.string().nullable().optional(),
  feedbackType: z.enum(["反馈", "重点反馈"]).nullable().optional(),
  memberName: z.string().nullable().optional(),
  projectCenter: z.string().nullable().optional(),
  membershipPaymentYears: z.string().nullable().optional(),
  region: z.enum(regionValues).nullable().optional(),
  isAnonymous: z.boolean().optional().default(false),
  managementFeeType: z.enum(["比例", "金额"]).nullable().optional(),
  managementFeeValue: z.string().nullable().optional(),
  expenseFundSource: z.string().nullable().optional(),
  voucherReceiptChannelCode: z.string().max(100, "收款渠道编号最长100字").nullable().optional(),
});

export type RecognitionResultAttributesInput = z.infer<typeof recognitionResultAttributesInput>;
export type RecognitionResultAttributeMode = "platform" | "direct" | "membership" | "simple" | "remarkOnly" | "refund";

function text(value?: string | null) {
  return String(value || "").trim();
}

export function getRecognitionResultAttributeMode(
  incomeType: string,
  donationSource?: string | null,
): RecognitionResultAttributeMode {
  if (incomeType === "订单退款" && !donationSourceValues.includes(donationSource as any)) return "refund";
  if (remarkOnlyIncomeTypes.has(incomeType)) return "remarkOnly";
  if (simpleIncomeTypes.has(incomeType)) return "simple";
  if (incomeType === "会费收入") return "membership";
  if (donationAttributeIncomeTypes.has(incomeType) && donationSource === "互联网募捐平台") return "platform";
  return "direct";
}

function normalizeMembershipPaymentYears(value?: string | null) {
  const normalized = text(value);
  return /^[1-9]\d*$/.test(normalized) ? parseInt(normalized, 10) : null;
}

function normalizeManagementFeeValue(value?: string | null) {
  const parsed = Number(text(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed.toFixed(2) : "0.00";
}

export function validateRecognitionResultAttributes(input: RecognitionResultAttributesInput) {
  const mode = getRecognitionResultAttributeMode(input.incomeType, input.donationSource);
  if (donationAttributeIncomeTypes.has(input.incomeType) && mode !== "refund" && !input.donationSource) {
    throw new Error("捐赠来源不能为空");
  }
  if (!text(input.incomeAttr)) throw new Error("收入属性不能为空");
  if (mode === "remarkOnly") return mode;
  if (!text(input.incomeDept)) throw new Error("收入部门不能为空");
  if (!text(input.budgetCode)) throw new Error("预算编码不能为空");
  if (!text(input.incomeProject)) throw new Error("NC项目名称不能为空");
  if ((mode === "platform" || mode === "refund") && !text(input.platformProjectName)) {
    throw new Error("平台项目名称不能为空");
  }
  if ((mode === "platform" || mode === "refund") && !text(input.platformProjectDetail)) {
    throw new Error("平台项目详情不能为空");
  }
  if ((mode === "direct" || mode === "membership") && !input.feedbackType) {
    throw new Error("反馈类型不能为空");
  }
  if ((mode === "direct" || mode === "membership") && !input.region) {
    throw new Error("地区不能为空");
  }
  if (mode === "membership" && !text(input.memberName)) {
    throw new Error("会员姓名不能为空");
  }
  if (mode === "membership" && !normalizeMembershipPaymentYears(input.membershipPaymentYears)) {
    throw new Error("缴纳年限不能为空且必须为正整数");
  }
  if (!["membership", "simple", "remarkOnly"].includes(mode) && text(input.managementFeeValue) === "") {
    throw new Error("管理费不能为空");
  }
  if (!["membership", "simple", "remarkOnly"].includes(mode)) {
    const managementFeeValue = Number(text(input.managementFeeValue));
    if (!Number.isFinite(managementFeeValue) || managementFeeValue < 0) {
      throw new Error("管理费必须为大于等于0的数字");
    }
  }
  if (!["simple", "remarkOnly"].includes(mode) && !text(input.expenseFundSource)) {
    throw new Error("支出资金来源不能为空");
  }
  return mode;
}

function calculateEditedManagementFeeAmount(
  splitAmount: string | number,
  managementFeeType: "比例" | "金额",
  managementFeeValue: string,
) {
  if (managementFeeType === "金额") {
    const feeCents = toCents(managementFeeValue);
    const signedFeeCents = toCents(splitAmount) < 0 ? -Math.abs(feeCents) : Math.abs(feeCents);
    return formatCents(signedFeeCents);
  }
  return calculateManagementFeeAmount(splitAmount, managementFeeValue);
}

export function buildRecognitionResultAttributeUpdate(input: {
  attributes: RecognitionResultAttributesInput;
  splitAmount: string | number;
  normalizedProjectCenter?: string | null;
  normalizedVoucherReceiptChannelCode?: string | null;
  bankCounterpartyName?: string | null;
}) {
  const attributes = input.attributes;
  const mode = validateRecognitionResultAttributes(attributes);
  const isBankDirectDonation = donationAttributeIncomeTypes.has(attributes.incomeType)
    && attributes.donationSource === "银行直捐";
  const hasNoManagementFee = ["membership", "simple", "remarkOnly"].includes(mode);
  const managementFeeType: "比例" | "金额" = hasNoManagementFee
    ? "比例"
    : attributes.managementFeeType === "金额" ? "金额" : "比例";
  const managementFeeValue = hasNoManagementFee
    ? "0.00"
    : normalizeManagementFeeValue(attributes.managementFeeValue);
  const managementFeeRatio = managementFeeType === "比例" ? managementFeeValue : "0.00";
  const expenseFundSourceTemplate = attributes.incomeType === "利息"
    ? interestExpenseFundSource
    : ["simple", "remarkOnly"].includes(mode)
      ? null
      : text(attributes.expenseFundSource) || null;
  const expenseFundSource = expenseFundSourceTemplate
    ? expenseFundSourceTemplate.replace(/\[到账户名\]/g, input.bankCounterpartyName || "")
    : null;

  return {
    recognitionType: isBankDirectDonation ? "银行直捐" as const : "渠道捐赠" as const,
    incomeType: attributes.incomeType,
    donationSource: donationAttributeIncomeTypes.has(attributes.incomeType)
      ? attributes.donationSource || null
      : null,
    incomeAttr: text(attributes.incomeAttr) || null,
    incomeDept: mode === "remarkOnly" ? null : text(attributes.incomeDept) || null,
    budgetCode: mode === "remarkOnly" ? null : text(attributes.budgetCode) || null,
    incomeProject: mode === "remarkOnly" ? null : text(attributes.incomeProject) || null,
    platformProjectName: mode === "platform" || mode === "refund"
      ? text(attributes.platformProjectName) || null
      : null,
    platformProjectDisplayName: mode === "platform" || mode === "refund"
      ? text(attributes.platformProjectName) || null
      : null,
    platformProjectDetail: mode === "platform" || mode === "refund"
      ? text(attributes.platformProjectDetail) || null
      : null,
    feedbackType: mode === "direct" || mode === "membership" ? attributes.feedbackType || null : null,
    memberName: mode === "membership" || isBankDirectDonation ? text(attributes.memberName) || null : null,
    projectCenter: isBankDirectDonation ? input.normalizedProjectCenter || null : null,
    membershipPaymentYears: mode === "membership"
      ? normalizeMembershipPaymentYears(attributes.membershipPaymentYears)
      : null,
    region: ["platform", "refund", "direct", "membership"].includes(mode)
      ? attributes.region || null
      : null,
    isAnonymous: (mode === "membership" || isBankDirectDonation) && attributes.isAnonymous ? 1 : 0,
    managementFeeType,
    managementFeeValue,
    managementFeeRatio,
    managementFeeAmount: hasNoManagementFee
      ? "0.00"
      : calculateEditedManagementFeeAmount(input.splitAmount, managementFeeType, managementFeeValue),
    expenseFundSource,
    remark: text(attributes.remark) || null,
    voucherReceiptChannelCode: input.normalizedVoucherReceiptChannelCode || null,
  };
}
