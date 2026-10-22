import { parseLooseDecimal } from "./amountParsing";

export type ExcludeOrderMatchType = "等于" | "包含";

export type ExcludeOrderConditionConfig = {
  field?: string | null;
  matchType?: ExcludeOrderMatchType | null;
  keyword?: string | null;
};

export type RefundOrderConfig = {
  enabled?: boolean | null;
  judgeField?: string | null;
  judgeValue?: string | null;
  directionJudgeValue?: string | null;
  incomeField?: string | null;
  amountField?: string | null;
};

export type RefundOrderClassification = {
  kind: "normal" | "refund" | "unmatched" | "invalid";
  reason?: string;
};

function normalizeCellValue(value: unknown) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^[`'"]+/, "")
    .replace(/[`'"]+$/, "")
    .trim();
}

export function isExcludedOrder(
  conditions: ExcludeOrderConditionConfig[],
  readField: (field: string) => unknown,
) {
  return conditions.some((condition) => {
    const field = normalizeCellValue(condition.field);
    const keyword = normalizeCellValue(condition.keyword);
    if (!field || !keyword) return false;
    const value = normalizeCellValue(readField(field));
    return condition.matchType === "包含"
      ? value.includes(keyword)
      : value === keyword;
  });
}

export function isRefundOrder(
  config: RefundOrderConfig,
  readField: (field: string) => unknown,
) {
  return createRefundOrderClassifier(config)(readField).kind === "refund";
}

function classifyAmount(value: unknown) {
  const normalized = normalizeCellValue(value);
  if (!normalized) return "zero" as const;
  const parsed = parseLooseDecimal(normalized);
  if (!Number.isFinite(parsed)) return "invalid" as const;
  return Math.round(Math.abs(parsed) * 100) === 0 ? "zero" as const : "nonzero" as const;
}

export function createRefundOrderClassifier(config: RefundOrderConfig) {
  const judgeField = normalizeCellValue(config.judgeField);
  const judgeValue = normalizeCellValue(config.judgeValue);
  const directionJudgeValue = normalizeCellValue(config.directionJudgeValue);
  const incomeField = normalizeCellValue(config.incomeField);
  const amountField = normalizeCellValue(config.amountField);
  if (!config.enabled || !judgeField || !judgeValue || !amountField) {
    return (_readField: (field: string) => unknown): RefundOrderClassification => ({ kind: "normal" });
  }
  return (readField: (field: string) => unknown): RefundOrderClassification => {
    const actualJudgeValue = normalizeCellValue(readField(judgeField));
    const matchesRefundValue = actualJudgeValue === judgeValue;
    const matchesDirectionValue = Boolean(directionJudgeValue) && actualJudgeValue === directionJudgeValue;
    const refundAmountState = matchesRefundValue || matchesDirectionValue
      ? classifyAmount(readField(amountField))
      : "zero";

    if (matchesRefundValue) {
      if (refundAmountState !== "nonzero") {
        return {
          kind: "invalid",
          reason: `判断字段“${judgeField}”命中退款值“${judgeValue}”时，退款字段“${amountField}”必须为非0数字`,
        };
      }
      return { kind: "refund" };
    }

    if (matchesDirectionValue) {
      const incomeAmountState = classifyAmount(readField(incomeField));
      if (refundAmountState === "invalid" || incomeAmountState === "invalid") {
        return {
          kind: "invalid",
          reason: `判断字段“${judgeField}”命中收支方向值“${directionJudgeValue}”时，收入字段“${incomeField}”和退款字段“${amountField}”必须为数字`,
        };
      }
      if (refundAmountState === "nonzero" && incomeAmountState === "nonzero") {
        return {
          kind: "invalid",
          reason: `判断字段“${judgeField}”命中收支方向值“${directionJudgeValue}”时，收入字段“${incomeField}”和退款字段“${amountField}”不能同时非0`,
        };
      }
      if (refundAmountState === "nonzero") return { kind: "refund" };
      if (incomeAmountState === "nonzero") return { kind: "normal" };
      return { kind: "unmatched" };
    }

    return { kind: "normal" };
  };
}

export function shouldDirectlyMarkOrderUnmatched(
  isRefund: boolean,
  incomeAmount: unknown,
) {
  if (isRefund) return false;
  const normalizedAmount = normalizeCellValue(incomeAmount);
  if (!normalizedAmount) return true;
  const parsedAmount = parseLooseDecimal(normalizedAmount);
  return Number.isFinite(parsedAmount) && parsedAmount === 0;
}
