import type { ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BudgetCodeSelect,
  DeptTreeSelect,
  DonationActivitySelect,
  NCProjectSelect,
  PlatformProjectDetailSelect,
  PlatformProjectSelect,
  ProjectCenterSelect,
} from "@/components/TreeSelects";
import { sanitizeSignedDecimalInput, toSignedAmountCents } from "@/lib/signedAmount";

export type SplitFormType = "百分比" | "金额";
export type ManualRecognitionContext = "income" | "detail";
type DonationSourceOption = "互联网募捐平台" | "银行直捐" | "拍卖";
type SplitFieldMode = "platform" | "direct" | "membership" | "interest" | "remarkOnly" | "refund";
export type ManualRecognitionValidationResult = {
  message: string;
  presentation?: "toast" | "dialog";
};

export type ManualSplit = {
  splitForm: SplitFormType;
  splitRatio: string;
  splitAmount: string;
  incomeType: string;
  donationSource: string;
  incomeAttr: string;
  remark: string;
  incomeDept: string;
  budgetCode: string;
  incomeProject: string;
  platformProjectName: string;
  platformProjectDetail?: string;
  feedbackType: string;
  memberName: string;
  projectCenter: string;
  membershipPaymentYears: string;
  region: string;
  isAnonymous: boolean;
  managementFeeType: "比例" | "金额";
  managementFeeValue: string;
  managementFeeRatio: string;
  expenseFundSource: string;
};

const regionOptions = ["北京市", "外省市", "港澳台", "境外", "内部客商"];
const donationSourceOptions: DonationSourceOption[] = ["互联网募捐平台", "银行直捐", "拍卖"];
const donationAttributeIncomeTypes = ["捐赠收入", "订单退款"];
const simpleIncomeTypes = ["政府补助", "利息", "个税返还", "本金", "投资收益"];
const remarkOnlyIncomeTypes = ["其他收入", "其他"];
const interestExpenseFundSource = "非限定性-利息收入";

function getDefaultDonationSource(context: ManualRecognitionContext): DonationSourceOption {
  return context === "detail" ? "互联网募捐平台" : "银行直捐";
}

export const createManualSplit = (splitRatio = "100"): ManualSplit => ({
  splitForm: "百分比",
  splitRatio,
  splitAmount: "",
  incomeType: "",
  donationSource: "",
  incomeAttr: "",
  remark: "",
  incomeDept: "",
  budgetCode: "",
  incomeProject: "",
  platformProjectName: "",
  platformProjectDetail: "",
  feedbackType: "",
  memberName: "",
  projectCenter: "",
  membershipPaymentYears: "",
  region: "",
  isAnonymous: false,
  managementFeeType: "比例",
  managementFeeValue: "5",
  managementFeeRatio: "5",
  expenseFundSource: "",
});

export function createManualSplitForAmount(
  amount: number | string | null | undefined,
  context: ManualRecognitionContext = "income",
  splitRatio = "100",
): ManualSplit {
  const split = createManualSplit(splitRatio);
  if (Number(amount || 0) >= 0) return split;
  return {
    ...split,
    incomeType: "订单退款",
    donationSource: getDefaultDonationSource(context),
  };
}

const createManualSplitWithForm = (
  splitForm: SplitFormType,
  splitRatio = "",
  amount: number | string | null | undefined = 0,
  context: ManualRecognitionContext = "income",
): ManualSplit => ({
  ...createManualSplitForAmount(amount, context, splitRatio),
  splitForm,
  splitRatio: splitForm === "百分比" ? splitRatio : "0",
  splitAmount: splitForm === "金额" ? "" : "",
});

function parseAmountCents(value: unknown) {
  return toSignedAmountCents(value);
}

function formatCents(cents: number) {
  return (cents / 100).toFixed(2);
}

export function formatManualSplitRatio(value: unknown) {
  const parsed = parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : "0";
}

function formatManualAmount(value: unknown) {
  const parsed = Number(String(value ?? "0"));
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : "0";
}

function formatSignedManualAmount(value: unknown) {
  const parsed = Number(String(value ?? "0"));
  return Number.isFinite(parsed) ? String(parsed) : "0";
}

function formatMembershipPaymentYears(value: unknown) {
  const text = String(value ?? "").trim();
  return /^[1-9]\d*$/.test(text) ? String(parseInt(text, 10)) : "";
}

export function normalizeManualFeedbackType(value: string): "反馈" | "重点反馈" | null {
  return value === "反馈" || value === "重点反馈" ? value : null;
}

function normalizeRegionOption(value: string) {
  return regionOptions.includes(value) ? value : null;
}

function isDonationAttributeIncomeType(incomeType: string) {
  return donationAttributeIncomeTypes.includes(incomeType);
}

function normalizeDonationSourceOption(value: string, incomeType: string): DonationSourceOption | null {
  if (!isDonationAttributeIncomeType(incomeType)) return null;
  return donationSourceOptions.includes(value as DonationSourceOption) ? value as DonationSourceOption : null;
}

function getSplitFieldMode(incomeType: string, donationSource: string): SplitFieldMode {
  const normalizedDonationSource = normalizeDonationSourceOption(donationSource, incomeType);
  if (incomeType === "订单退款" && !normalizedDonationSource) return "refund";
  if (remarkOnlyIncomeTypes.includes(incomeType)) return "remarkOnly";
  if (simpleIncomeTypes.includes(incomeType)) return "interest";
  if (incomeType === "会费收入") return "membership";
  if (normalizedDonationSource === "互联网募捐平台") return "platform";
  return "direct";
}

function getSplitMode(split: Pick<ManualSplit, "incomeType" | "donationSource">) {
  return getSplitFieldMode(split.incomeType, split.donationSource);
}

function isBankDirectDonationSplit(split: Pick<ManualSplit, "incomeType" | "donationSource">) {
  return isDonationAttributeIncomeType(split.incomeType) && split.donationSource === "银行直捐";
}

function getIncomeAttrPrefix(incomeAttr: string) {
  return incomeAttr === "限定性收入" ? "限定性" : "非限定性";
}

function updateFundSourcePrefix(expenseFundSource: string, incomeAttr: string) {
  if (!expenseFundSource) return "";
  const parts = expenseFundSource.split("_");
  parts[0] = getIncomeAttrPrefix(incomeAttr);
  return parts.filter(Boolean).join("_");
}

export function updateManualFundSourceFeedback(
  expenseFundSource: string,
  incomeAttr: string,
  previousFeedbackType: string,
  feedbackType: string,
  counterpartyName: string,
) {
  if (!expenseFundSource) return "";

  const normalizedCounterpartyName = counterpartyName.trim();
  let activityName = "";

  if (normalizedCounterpartyName) {
    const activitySeparator = `_${normalizedCounterpartyName}_`;
    const separatorIndex = expenseFundSource.indexOf(activitySeparator);
    if (separatorIndex >= 0) {
      activityName = expenseFundSource.slice(separatorIndex + activitySeparator.length);
    }
  }

  if (!activityName) {
    const prefixSeparatorIndex = expenseFundSource.indexOf("_");
    if (prefixSeparatorIndex < 0) return expenseFundSource;

    let remainder = expenseFundSource.slice(prefixSeparatorIndex + 1);
    if (previousFeedbackType && remainder.startsWith(`${previousFeedbackType}_`)) {
      remainder = remainder.slice(previousFeedbackType.length + 1);
    }
    if (normalizedCounterpartyName && remainder.startsWith(`${normalizedCounterpartyName}_`)) {
      remainder = remainder.slice(normalizedCounterpartyName.length + 1);
    }
    activityName = remainder;
  }

  if (!activityName) return expenseFundSource;
  return [
    getIncomeAttrPrefix(incomeAttr),
    feedbackType,
    normalizedCounterpartyName,
    activityName,
  ].filter(Boolean).join("_");
}

function getMembershipExpenseFundSource(budgetCode: string) {
  return budgetCode.trim() === "2.1-其他银行直捐"
    ? "非限定性-项目中心-企业家捐赠"
    : "非限定性_企业家捐赠";
}

function getProjectNameForFundSource(value: string) {
  const projectPart = value.includes(" / ") ? value.split(" / ").pop() || value : value;
  const parts = projectPart.split("_");
  return parts.length > 1 ? parts.slice(1).join("_") : projectPart;
}

export function validateManualRecognitionSplits(splits: ManualSplit[], recognitionAmount: number | string) {
  const totalAmount = Number(recognitionAmount);
  const totalCents = parseAmountCents(totalAmount);
  if (!Number.isFinite(totalCents) || totalCents === 0) return { message: "认账金额不能为0" };

  const splitForm = splits[0]?.splitForm || "百分比";
  const hasDifferentSplitForm = splits.some((split) => split.splitForm !== splitForm);
  if (hasDifferentSplitForm) {
    return { message: "各分账的分账形式必须一致", presentation: "dialog" };
  }

  if (splitForm === "百分比") {
    const splitRatioTotal = splits.reduce((sum, split) => sum + Number(formatManualSplitRatio(split.splitRatio)), 0);
    if (splitRatioTotal !== 100) {
      return { message: `分账百分比合计必须等于100%，当前为 ${splitRatioTotal}%`, presentation: "dialog" };
    }
  } else {
    const splitAmountCents = splits.map((split) => parseAmountCents(split.splitAmount));
    const hasInvalidDirection = splitAmountCents.some((cents) => (
      !Number.isFinite(cents)
      || cents === 0
      || (totalCents > 0 && cents < 0)
      || (totalCents < 0 && cents > 0)
    ));
    if (hasInvalidDirection) {
      return { message: "各分账金额必须与认账金额方向一致且不能为0", presentation: "dialog" };
    }
    const splitTotalCents = splitAmountCents.reduce((sum, cents) => sum + cents, 0);
    if (splitTotalCents !== totalCents) {
      return { message: `分账金额合计必须等于认账金额 ${formatCents(totalCents)}，当前为 ${formatCents(splitTotalCents)}`, presentation: "dialog" };
    }
  }

  for (let i = 0; i < splits.length; i += 1) {
    const split = splits[i];
    const mode = getSplitMode(split);
    if (split.splitForm === "金额") {
      const amountCents = parseAmountCents(split.splitAmount);
      if (!Number.isFinite(amountCents) || amountCents === 0) return { message: `分账 ${i + 1} 金额不能为空或0` };
    } else if (!split.splitRatio || Number(split.splitRatio) <= 0) {
      return { message: `分账 ${i + 1} 百分比不能为空或0` };
    }
    if (!split.incomeType) return { message: `分账 ${i + 1} 收入类型必填` };
    if (isDonationAttributeIncomeType(split.incomeType) && !normalizeDonationSourceOption(split.donationSource, split.incomeType)) {
      return { message: `分账 ${i + 1} 捐赠来源必填` };
    }
    if (!split.incomeAttr) return { message: `分账 ${i + 1} 收入属性必填` };
    if (mode === "remarkOnly") continue;
    if (!split.incomeDept) return { message: `分账 ${i + 1} 收入部门必填` };
    if (!split.budgetCode) return { message: `分账 ${i + 1} 预算编码必填` };
    if (!split.incomeProject) return { message: `分账 ${i + 1} NC项目名称必填` };
    if (mode === "platform" && !split.platformProjectName) return { message: `分账 ${i + 1} 平台项目名称必填` };
    if (mode === "platform" && !split.platformProjectDetail) return { message: `分账 ${i + 1} 平台项目详情必填` };
    if (mode !== "platform" && mode !== "interest" && !split.feedbackType) return { message: `分账 ${i + 1} 反馈类型必填` };
    if (mode !== "platform" && mode !== "interest" && !split.region) return { message: `分账 ${i + 1} 地区必填` };
    if (mode === "membership" && !split.memberName.trim()) return { message: `分账 ${i + 1} 会员姓名必填` };
    if (isBankDirectDonationSplit(split) && split.memberName.trim() && !split.projectCenter) {
      return { message: `分账 ${i + 1} 填写会员姓名时所属项目中心必填` };
    }
    if (mode === "membership" && !formatMembershipPaymentYears(split.membershipPaymentYears)) return { message: `分账 ${i + 1} 缴纳年限必填且必须为正整数` };
    if (mode !== "membership" && mode !== "interest" && !split.expenseFundSource) return { message: `分账 ${i + 1} 支出资金来源必填` };
    if (mode !== "membership" && mode !== "interest" && !String(split.managementFeeValue || split.managementFeeRatio).trim()) return { message: `分账 ${i + 1} 管理费必填` };
  }
  return null;
}

export function validateRecognitionResultAttributeSplit(split: ManualSplit) {
  const mode = getSplitMode(split);
  if (!split.incomeType) return { message: "收入类型必填" };
  if (
    isDonationAttributeIncomeType(split.incomeType)
    && mode !== "refund"
    && !normalizeDonationSourceOption(split.donationSource, split.incomeType)
  ) {
    return { message: "捐赠来源必填" };
  }
  if (!split.incomeAttr) return { message: "收入属性必填" };
  if (mode === "remarkOnly") return null;
  if (!split.incomeDept) return { message: "收入部门必填" };
  if (!split.budgetCode) return { message: "预算编码必填" };
  if (!split.incomeProject) return { message: "NC项目名称必填" };
  if ((mode === "platform" || mode === "refund") && !split.platformProjectName) {
    return { message: "平台项目名称必填" };
  }
  if ((mode === "platform" || mode === "refund") && !split.platformProjectDetail) {
    return { message: "平台项目详情必填" };
  }
  if ((mode === "direct" || mode === "membership") && !split.feedbackType) {
    return { message: "反馈类型必填" };
  }
  if ((mode === "direct" || mode === "membership") && !split.region) {
    return { message: "地区必填" };
  }
  if (mode === "membership" && !split.memberName.trim()) return { message: "会员姓名必填" };
  if (isBankDirectDonationSplit(split) && split.memberName.trim() && !split.projectCenter) {
    return { message: "填写会员姓名时所属项目中心必填" };
  }
  if (mode === "membership" && !formatMembershipPaymentYears(split.membershipPaymentYears)) {
    return { message: "缴纳年限必填且必须为正整数" };
  }
  if (!["membership", "interest", "remarkOnly"].includes(mode) && !String(split.managementFeeValue || split.managementFeeRatio).trim()) {
    return { message: "管理费必填" };
  }
  if (!["interest", "remarkOnly"].includes(mode) && !split.expenseFundSource) {
    return { message: "支出资金来源必填" };
  }
  return null;
}

export function serializeManualRecognitionSplits(splits: ManualSplit[]) {
  return splits.map((split) => {
    const mode = getSplitMode(split);
    const isBankDirectDonation = isBankDirectDonationSplit(split);
    const hasNoManagementFee = mode === "membership" || mode === "interest" || mode === "remarkOnly";
    const managementFeeType = hasNoManagementFee ? "比例" : split.managementFeeType;
    const managementFeeValue = hasNoManagementFee ? "0" : formatManualAmount(split.managementFeeValue || split.managementFeeRatio);
    return {
      splitForm: split.splitForm,
      splitRatio: split.splitForm === "百分比" ? formatManualSplitRatio(split.splitRatio) : "0",
      splitAmount: split.splitForm === "金额" ? formatSignedManualAmount(split.splitAmount) : "0",
      incomeType: split.incomeType,
      donationSource: normalizeDonationSourceOption(split.donationSource, split.incomeType),
      incomeAttr: split.incomeAttr || null,
      remark: mode === "remarkOnly" ? split.remark.trim() || null : null,
      incomeDept: mode === "remarkOnly" ? null : split.incomeDept || null,
      budgetCode: mode === "remarkOnly" ? null : split.budgetCode || null,
      incomeProject: mode === "remarkOnly" ? null : split.incomeProject || null,
      platformProjectName: mode === "platform" ? split.platformProjectName || null : null,
      platformProjectDetail: mode === "platform" ? split.platformProjectDetail || null : null,
      feedbackType: mode === "platform" || mode === "interest" || mode === "remarkOnly" ? null : normalizeManualFeedbackType(split.feedbackType),
      memberName: mode === "membership" || isBankDirectDonation ? split.memberName.trim() || null : null,
      projectCenter: isBankDirectDonation ? split.projectCenter || null : null,
      membershipPaymentYears: mode === "membership" ? formatMembershipPaymentYears(split.membershipPaymentYears) || null : null,
      region: mode === "platform" || mode === "interest" || mode === "remarkOnly" ? null : normalizeRegionOption(split.region) as any,
      isAnonymous: mode === "membership" ? split.isAnonymous : false,
      managementFeeType,
      managementFeeValue,
      managementFeeRatio: managementFeeType === "比例" ? formatManualSplitRatio(managementFeeValue) : "0",
      expenseFundSource: split.incomeType === "利息"
        ? interestExpenseFundSource
        : mode === "interest" || mode === "remarkOnly"
          ? null
        : mode === "membership"
          ? split.expenseFundSource || getMembershipExpenseFundSource(split.budgetCode)
          : split.expenseFundSource || null,
    };
  });
}

export function serializeRecognitionResultAttributes(split: ManualSplit) {
  const mode = getSplitMode(split);
  const isBankDirectDonation = isBankDirectDonationSplit(split);
  const hasNoManagementFee = mode === "membership" || mode === "interest" || mode === "remarkOnly";
  const managementFeeType = hasNoManagementFee ? "比例" : split.managementFeeType;
  const managementFeeValue = hasNoManagementFee
    ? "0"
    : formatManualAmount(split.managementFeeValue || split.managementFeeRatio);
  return {
    incomeType: split.incomeType as "捐赠收入" | "会费收入" | "政府补助" | "个税返还" | "本金" | "投资收益" | "利息" | "其他收入" | "其他" | "订单退款",
    donationSource: normalizeDonationSourceOption(split.donationSource, split.incomeType),
    incomeAttr: split.incomeAttr || null,
    remark: split.remark.trim() || null,
    incomeDept: mode === "remarkOnly" ? null : split.incomeDept || null,
    budgetCode: mode === "remarkOnly" ? null : split.budgetCode || null,
    incomeProject: mode === "remarkOnly" ? null : split.incomeProject || null,
    platformProjectName: mode === "platform" || mode === "refund" ? split.platformProjectName || null : null,
    platformProjectDetail: mode === "platform" || mode === "refund" ? split.platformProjectDetail || null : null,
    feedbackType: mode === "direct" || mode === "membership" ? normalizeManualFeedbackType(split.feedbackType) : null,
    memberName: mode === "membership" || isBankDirectDonation ? split.memberName.trim() || null : null,
    projectCenter: isBankDirectDonation ? split.projectCenter || null : null,
    membershipPaymentYears: mode === "membership" ? formatMembershipPaymentYears(split.membershipPaymentYears) || null : null,
    region: ["platform", "refund", "direct", "membership"].includes(mode)
      ? normalizeRegionOption(split.region) as any
      : null,
    isAnonymous: mode === "membership" || isBankDirectDonation ? split.isAnonymous : false,
    managementFeeType,
    managementFeeValue,
    expenseFundSource: split.incomeType === "利息"
      ? interestExpenseFundSource
      : mode === "interest" || mode === "remarkOnly"
        ? null
        : mode === "membership"
          ? split.expenseFundSource || getMembershipExpenseFundSource(split.budgetCode)
          : split.expenseFundSource || null,
  };
}

type ManualRecognitionFormProps = {
  selectedFlow?: any | null;
  manualRecognitionContext?: ManualRecognitionContext;
  splits: ManualSplit[];
  onSplitsChange: React.Dispatch<React.SetStateAction<ManualSplit[]>>;
  treeEnabled?: boolean;
  amountSection?: ReactNode;
  voucherReceiptChannelCode?: string;
  onVoucherReceiptChannelCodeChange?: (value: string) => void;
  footer?: ReactNode;
  splitCardClassName?: string;
  splitGridClassName?: string;
  attributeEditMode?: boolean;
};

export function ManualRecognitionForm({
  selectedFlow,
  manualRecognitionContext = "income",
  splits,
  onSplitsChange,
  treeEnabled = true,
  amountSection,
  voucherReceiptChannelCode = "",
  onVoucherReceiptChannelCodeChange,
  footer,
  splitCardClassName = "bg-white border rounded-lg p-4 space-y-3",
  splitGridClassName = "grid grid-cols-2 gap-3",
  attributeEditMode = false,
}: ManualRecognitionFormProps) {
  const deptTreeQuery = trpc.department.tree.useQuery(undefined, { enabled: treeEnabled });
  const budgetCodeTreeQuery = trpc.budgetCode.tree.useQuery(undefined, {
    enabled: treeEnabled,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });
  const projectTreeQuery = trpc.project.tree.useQuery(undefined, {
    enabled: treeEnabled,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });
  const fundraisingPlatformTreeQuery = trpc.fundraisingPlatform.tree.useQuery(undefined, {
    enabled: treeEnabled,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });
  const donationActivityTreeQuery = trpc.donationActivity.tree.useQuery(undefined, { enabled: treeEnabled });
  const voucherReceiptChannelsQuery = trpc.counterparty.listVoucherReceiptChannels.useQuery(
    undefined,
    { enabled: treeEnabled && Boolean(onVoucherReceiptChannelCodeChange) }
  );

  const addSplit = () => {
    onSplitsChange((prev) => {
      const splitForm = prev[0]?.splitForm || "百分比";
      const selectedAmount = selectedFlow?.recognitionAvailableAmount ?? selectedFlow?.income ?? 0;
      return [...prev, createManualSplitWithForm(splitForm, "", selectedAmount, manualRecognitionContext)];
    });
  };

  const removeSplit = (idx: number) => {
    if (splits.length <= 1) return;
    onSplitsChange((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateSplit = (idx: number, field: keyof ManualSplit, value: string | boolean) => {
    if (field === "splitForm") {
      const nextSplitForm = value as SplitFormType;
      onSplitsChange((prev) =>
        prev.map((split) => ({
          ...split,
          splitForm: nextSplitForm,
          splitRatio: nextSplitForm === "百分比" ? split.splitRatio || "100" : "0",
          splitAmount: nextSplitForm === "金额" ? split.splitAmount : "",
        }))
      );
      return;
    }

    onSplitsChange((prev) =>
      prev.map((split, i) => {
        if (i !== idx) return split;
        const next = { ...split, [field]: value };
        if (field === "incomeDept") {
          next.budgetCode = "";
          next.incomeProject = "";
          next.platformProjectName = "";
          next.platformProjectDetail = "";
          next.expenseFundSource = getSplitMode(next) === "membership" ? getMembershipExpenseFundSource("") : "";
        }
        if (field === "incomeAttr") {
          next.expenseFundSource = getSplitMode(next) === "membership"
            ? getMembershipExpenseFundSource(next.budgetCode)
            : updateFundSourcePrefix(next.expenseFundSource, String(value));
        }
        if (field === "incomeType") {
          next.donationSource = isDonationAttributeIncomeType(String(value))
            ? getDefaultDonationSource(manualRecognitionContext)
            : "";
        }
        if (field === "incomeType" || field === "donationSource") {
          next.expenseFundSource = "";
          const mode = getSplitMode(next);
          const usesPlatformFields = mode === "platform" || mode === "refund";
          const isBankDirectDonation = isBankDirectDonationSplit(next);
          if (!usesPlatformFields) {
            next.platformProjectName = "";
            next.platformProjectDetail = "";
          }
          if (usesPlatformFields || mode === "interest" || mode === "remarkOnly") {
            next.feedbackType = "";
            next.region = "";
          }
          if (mode === "remarkOnly") {
            next.incomeDept = "";
            next.budgetCode = "";
            next.incomeProject = "";
            next.expenseFundSource = "";
          } else if (!attributeEditMode) {
            next.remark = "";
          }
          if (mode !== "membership" && !isBankDirectDonation) {
            next.memberName = "";
          }
          if (!isBankDirectDonation) {
            next.projectCenter = "";
          }
          if (mode !== "membership") {
            next.membershipPaymentYears = "";
            next.isAnonymous = false;
          }
          if (mode === "membership" || mode === "interest" || mode === "remarkOnly") {
            next.managementFeeType = "比例";
            next.managementFeeValue = "0";
            next.managementFeeRatio = "0";
          } else if (!next.managementFeeValue || next.managementFeeValue === "0") {
            next.managementFeeValue = "5";
            next.managementFeeRatio = "5";
          }
          if (mode === "membership") {
            next.expenseFundSource = getMembershipExpenseFundSource(next.budgetCode);
          }
        }
        if (field === "platformProjectName") {
          next.expenseFundSource = "";
          next.platformProjectDetail = "";
        }
        if (field === "feedbackType") {
          const mode = getSplitMode(next);
          next.expenseFundSource = mode === "membership"
            ? getMembershipExpenseFundSource(next.budgetCode)
            : mode === "direct"
              ? updateManualFundSourceFeedback(
                next.expenseFundSource,
                next.incomeAttr,
                split.feedbackType,
                String(value),
                selectedFlow?.counterpartyName || "",
              )
              : next.expenseFundSource;
        }
        return next;
      })
    );
  };

  const handleNCProjectChange = (idx: number, value: string) => {
    onSplitsChange((prev) =>
      prev.map((split, i) => (i === idx ? { ...split, incomeProject: value, platformProjectName: "", platformProjectDetail: "" } : split))
    );
  };

  const handleBudgetCodeChange = (idx: number, val: string, autoProject: string | null) => {
    onSplitsChange((prev) =>
      prev.map((split, i) => {
        if (i !== idx) return split;
        const next = {
          ...split,
          budgetCode: val,
          expenseFundSource: getSplitMode(split) === "membership" ? getMembershipExpenseFundSource(val) : "",
        };
        if (autoProject && /^PM/.test(autoProject)) {
          next.incomeProject = autoProject;
          next.platformProjectName = "";
          next.platformProjectDetail = "";
        }
        return next;
      })
    );
  };

  const handleDonationActivityChange = (idx: number, activityName: string) => {
    onSplitsChange((prev) =>
      prev.map((split, i) => {
        if (i !== idx) return split;
        const mode = getSplitMode(split);
        if (mode !== "platform" && mode !== "refund") {
          const parts = [getIncomeAttrPrefix(split.incomeAttr), split.feedbackType, selectedFlow?.counterpartyName || "", activityName].filter(Boolean);
          return { ...split, expenseFundSource: parts.join("_") };
        }
        const prefix = getIncomeAttrPrefix(split.incomeAttr);
        let budgetName = "";
        if (split.budgetCode) {
          const parts = split.budgetCode.split("-");
          budgetName = parts.length > 1 ? parts.slice(1).join("-") : split.budgetCode;
        }
        const projectName = split.platformProjectName ? getProjectNameForFundSource(split.platformProjectName) : "";
        const parts = [prefix, budgetName, projectName, activityName].filter(Boolean);
        return { ...split, expenseFundSource: parts.join("_") };
      })
    );
  };

  return (
    <div className="space-y-4">
      {amountSection}

      {onVoucherReceiptChannelCodeChange && (
        <div className="max-w-lg rounded-md border bg-white p-3">
          <div className="space-y-1">
            <Label className="text-xs">收款渠道</Label>
            <div className="flex gap-2">
              <Select
                value={voucherReceiptChannelCode || undefined}
                onValueChange={onVoucherReceiptChannelCodeChange}
                disabled={voucherReceiptChannelsQuery.isLoading}
              >
                <SelectTrigger className="h-9 flex-1">
                  <SelectValue placeholder={voucherReceiptChannelsQuery.isLoading ? "加载渠道中..." : "请选择收款渠道"} />
                </SelectTrigger>
                <SelectContent>
                  {voucherReceiptChannelsQuery.data?.items.map((item: any) => (
                    <SelectItem key={item.id} value={item.channelCode}>
                      {item.channelName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {voucherReceiptChannelCode && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 px-3"
                  onClick={() => onVoucherReceiptChannelCodeChange("")}
                >
                  清空
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{attributeEditMode ? "认账属性" : "分账设置"}</span>
          {!attributeEditMode && <span className="text-xs text-gray-400">分账金额合计须等于认账金额</span>}
        </div>
      </div>

      <div className="space-y-4">
        {splits.map((split, idx) => {
          const mode = getSplitMode(split);
          const isPlatformMode = mode === "platform";
          const isMembershipMode = mode === "membership";
          const isInterestMode = mode === "interest";
          const isRemarkOnlyMode = mode === "remarkOnly";
          const isRefundMode = mode === "refund";
          const isPlatformLikeMode = isPlatformMode || isRefundMode;
          const isBankDirectDonationMode = isBankDirectDonationSplit(split);
          const hasNoManagementFee = isMembershipMode || isInterestMode || isRemarkOnlyMode;
          return (
          <div key={idx} className={splitCardClassName}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-blue-700">
                {attributeEditMode ? "当前入账结果" : `分账 ${idx + 1}`}
              </span>
              {!attributeEditMode && splits.length > 1 && (
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => removeSplit(idx)}>
                  <Trash2 className="h-4 w-4 text-red-500" />
                </Button>
              )}
            </div>

            <div className={splitGridClassName}>
              {!attributeEditMode && (
                <div className="space-y-1">
                  <Label className="text-xs">分账形式 <span className="text-red-500">*</span></Label>
                  <div className="flex h-9 rounded-md border border-input bg-background">
                    <select
                      className="w-20 border-r bg-transparent px-2 text-sm outline-none disabled:text-gray-400"
                      value={split.splitForm}
                      onChange={(e) => updateSplit(idx, "splitForm", e.target.value as SplitFormType)}
                      disabled={idx > 0}
                    >
                      <option>百分比</option>
                      <option>金额</option>
                    </select>
                    <Input
                      className="h-8 flex-1 border-0 shadow-none focus-visible:ring-0"
                      value={split.splitForm === "金额" ? split.splitAmount : split.splitRatio}
                      onChange={(e) => updateSplit(
                        idx,
                        split.splitForm === "金额" ? "splitAmount" : "splitRatio",
                        split.splitForm === "金额"
                          ? sanitizeSignedDecimalInput(e.target.value, Number(selectedFlow?.income || 0) < 0)
                          : e.target.value.replace(/[^\d.]/g, ""),
                      )}
                      placeholder={split.splitForm === "金额" ? "0.00" : "100"}
                      inputMode="decimal"
                    />
                  </div>
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs">收入类型 <span className="text-red-500">*</span></Label>
                <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={split.incomeType} onChange={(e) => updateSplit(idx, "incomeType", e.target.value)}>
                  <option value="">请选择</option>
                  <option>捐赠收入</option>
                  <option>会费收入</option>
                  <option>政府补助</option>
                  <option>个税返还</option>
                  <option>本金</option>
                  <option>投资收益</option>
                  <option>利息</option>
                  <option>其他收入</option>
                  <option>其他</option>
                  <option>订单退款</option>
                </select>
              </div>
              {(
                split.incomeType === "捐赠收入"
                || (split.incomeType === "订单退款" && (!attributeEditMode || Boolean(split.donationSource)))
              ) && (
                <div className="space-y-1">
                  <Label className="text-xs">捐赠来源 <span className="text-red-500">*</span></Label>
                  <select
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={split.donationSource}
                    onChange={(e) => updateSplit(idx, "donationSource", e.target.value)}
                  >
                    <option value="">请选择</option>
                    {donationSourceOptions.map((option) => <option key={option}>{option}</option>)}
                  </select>
                </div>
              )}
              {Boolean(split.incomeType) && (
                <div className="space-y-1">
                  <Label className="text-xs">收入属性 <span className="text-red-500">*</span></Label>
                  <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={split.incomeAttr} onChange={(e) => updateSplit(idx, "incomeAttr", e.target.value)}>
                    <option value="">请选择</option>
                    <option>非限定性收入</option>
                    <option>限定性收入</option>
                  </select>
                </div>
              )}
              {Boolean(split.incomeType) && isRemarkOnlyMode && (
                <div className="space-y-1">
                  <Label className="text-xs">备注</Label>
                  <Input className="h-9" value={split.remark} onChange={(e) => updateSplit(idx, "remark", e.target.value)} placeholder="请输入备注" />
                </div>
              )}
              {Boolean(split.incomeType) && !isRemarkOnlyMode && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">收入部门 <span className="text-red-500">*</span></Label>
                    <DeptTreeSelect value={split.incomeDept} tree={deptTreeQuery.data || []} onChange={(val) => updateSplit(idx, "incomeDept", val)} placeholder="请选择部门" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">预算编码 <span className="text-red-500">*</span></Label>
                    <BudgetCodeSelect value={split.budgetCode} tree={budgetCodeTreeQuery.data || []} incomeDept={split.incomeDept} onChange={(val, autoProject) => handleBudgetCodeChange(idx, val, autoProject)} placeholder="请选择预算编码" disabled={budgetCodeTreeQuery.isLoading} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">NC项目名称 <span className="text-red-500">*</span></Label>
                    <NCProjectSelect value={split.incomeProject} tree={projectTreeQuery.data || []} budgetCodeTree={budgetCodeTreeQuery.data || []} budgetCodeValue={split.budgetCode} onChange={(val) => handleNCProjectChange(idx, val)} placeholder="请选择NC项目名称" disabled={projectTreeQuery.isLoading} />
                  </div>
                  {isInterestMode ? null : isPlatformLikeMode ? (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs">平台项目名称 <span className="text-red-500">*</span></Label>
                        <PlatformProjectSelect value={split.platformProjectName} tree={projectTreeQuery.data || []} budgetCodeTree={budgetCodeTreeQuery.data || []} budgetCodeValue={split.budgetCode} ncProjectValue={split.incomeProject} onChange={(val) => updateSplit(idx, "platformProjectName", val)} placeholder="请选择平台项目名称" disabled={projectTreeQuery.isLoading} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">平台项目详情 <span className="text-red-500">*</span></Label>
                        <PlatformProjectDetailSelect value={split.platformProjectDetail || ""} tree={fundraisingPlatformTreeQuery.data || []} platformProjectValue={split.platformProjectName} onChange={(val) => updateSplit(idx, "platformProjectDetail", val)} placeholder="请选择平台项目详情" disabled={fundraisingPlatformTreeQuery.isLoading} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">支出资金来源 <span className="text-red-500">*</span></Label>
                        <DonationActivitySelect value={split.expenseFundSource} tree={donationActivityTreeQuery.data || []} onChange={(activityName) => handleDonationActivityChange(idx, activityName)} placeholder="请选择捐赠活动" disabled={donationActivityTreeQuery.isLoading} />
                      </div>
                      {attributeEditMode && (
                        <div className="space-y-1">
                          <Label className="text-xs">地区</Label>
                          <select
                            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                            value={split.region}
                            onChange={(e) => updateSplit(idx, "region", e.target.value)}
                          >
                            <option value="">请选择</option>
                            {regionOptions.map((option) => <option key={option}>{option}</option>)}
                          </select>
                        </div>
                      )}
                    </>
                  ) : isMembershipMode ? (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs">反馈类型 <span className="text-red-500">*</span></Label>
                        <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={split.feedbackType} onChange={(e) => updateSplit(idx, "feedbackType", e.target.value)}>
                          <option value="">请选择</option>
                          <option>反馈</option>
                          <option>重点反馈</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">地区 <span className="text-red-500">*</span></Label>
                        <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={split.region} onChange={(e) => updateSplit(idx, "region", e.target.value)}>
                          <option value="">请选择</option>
                          {regionOptions.map((option) => <option key={option}>{option}</option>)}
                        </select>
                      </div>
	                      <div className="space-y-1">
	                        <Label className="text-xs">会员姓名 <span className="text-red-500">*</span></Label>
	                        <Input className="h-9" value={split.memberName} onChange={(e) => updateSplit(idx, "memberName", e.target.value)} placeholder="请输入会员姓名" />
	                      </div>
	                      <div className="space-y-1">
	                        <Label className="text-xs">缴纳年限 <span className="text-red-500">*</span></Label>
	                        <Input className="h-9" value={split.membershipPaymentYears} onChange={(e) => updateSplit(idx, "membershipPaymentYears", e.target.value.replace(/\D/g, ""))} placeholder="请输入数字" inputMode="numeric" />
	                      </div>
	                      <div className="space-y-1">
                        <Label className="text-xs">匿名 <span className="text-red-500">*</span></Label>
                        <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={split.isAnonymous ? "是" : "否"} onChange={(e) => updateSplit(idx, "isAnonymous", e.target.value === "是")}>
                          <option>否</option>
                          <option>是</option>
                        </select>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs">支出资金来源 <span className="text-red-500">*</span></Label>
                        <DonationActivitySelect value={split.expenseFundSource} tree={donationActivityTreeQuery.data || []} onChange={(activityName) => handleDonationActivityChange(idx, activityName)} placeholder="请选择捐赠活动" disabled={donationActivityTreeQuery.isLoading} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">反馈类型 <span className="text-red-500">*</span></Label>
                        <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={split.feedbackType} onChange={(e) => updateSplit(idx, "feedbackType", e.target.value)}>
                          <option value="">请选择</option>
                          <option>反馈</option>
                          <option>重点反馈</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">地区 <span className="text-red-500">*</span></Label>
                        <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={split.region} onChange={(e) => updateSplit(idx, "region", e.target.value)}>
                          <option value="">请选择</option>
                          {regionOptions.map((option) => <option key={option}>{option}</option>)}
                        </select>
                      </div>
                      {isBankDirectDonationMode && (
                        <>
                          <div className="space-y-1">
                            <Label className="text-xs">会员姓名</Label>
                            <Input className="h-9" value={split.memberName} onChange={(e) => updateSplit(idx, "memberName", e.target.value)} placeholder="选填" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">
                              所属项目中心
                              {split.memberName.trim() && <span className="text-red-500"> *</span>}
                            </Label>
                            <ProjectCenterSelect
                              value={split.projectCenter}
                              tree={deptTreeQuery.data || []}
                              onChange={(value) => updateSplit(idx, "projectCenter", value)}
                              placeholder="请选择所属项目中心"
                              disabled={deptTreeQuery.isLoading}
                            />
                          </div>
                          {attributeEditMode && (
                            <div className="space-y-1">
                              <Label className="text-xs">匿名</Label>
                              <select
                                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                                value={split.isAnonymous ? "是" : "否"}
                                onChange={(e) => updateSplit(idx, "isAnonymous", e.target.value === "是")}
                              >
                                <option>否</option>
                                <option>是</option>
                              </select>
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}
                  {!hasNoManagementFee && (
                    <div className="space-y-1">
                      <Label className="text-xs">管理费 <span className="text-red-500">*</span></Label>
                      <div className="flex h-9 rounded-md border border-input bg-background">
                        <select className="w-20 border-r bg-transparent px-2 text-sm outline-none" value={split.managementFeeType} onChange={(e) => updateSplit(idx, "managementFeeType", e.target.value as "比例" | "金额")}>
                          <option value="比例">百分比</option>
                          <option>金额</option>
                        </select>
                        <Input
                          className="h-8 flex-1 border-0 shadow-none focus-visible:ring-0"
                          value={split.managementFeeValue}
                          onChange={(e) => updateSplit(idx, "managementFeeValue", e.target.value.replace(/[^\d.]/g, ""))}
                          placeholder={split.managementFeeType === "比例" ? "9" : "0.00"}
                          inputMode="decimal"
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
              {attributeEditMode && Boolean(split.incomeType) && !isRemarkOnlyMode && (
                <div className="space-y-1">
                  <Label className="text-xs">备注</Label>
                  <Input
                    className="h-9"
                    value={split.remark}
                    onChange={(e) => updateSplit(idx, "remark", e.target.value)}
                    placeholder="选填"
                  />
                </div>
              )}
            </div>
          </div>
          );
        })}
      </div>

      <div className="space-y-3">
        {!attributeEditMode && (
          <Button variant="outline" className="w-full border-dashed" onClick={addSplit}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            添加分账
          </Button>
        )}
        <div className="flex justify-end gap-2">
          {footer}
        </div>
      </div>
    </div>
  );
}
