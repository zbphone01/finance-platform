import { formatCents, toCents } from "./splitAmounts";

export const incomeRuleSplitFormValues = ["百分比", "认账时填写"] as const;
export type IncomeRuleSplitForm = (typeof incomeRuleSplitFormValues)[number];

export function normalizeIncomeRuleSplitForm(value: unknown): IncomeRuleSplitForm {
  return value === "认账时填写" ? "认账时填写" : "百分比";
}

export function resolveIncomeRuleSplitForm(
  splits: Array<{ splitForm?: string | null }>,
): IncomeRuleSplitForm {
  const forms = new Set(splits.map((split) => normalizeIncomeRuleSplitForm(split.splitForm)));
  if (forms.size > 1) throw new Error("各分账的分账形式必须一致");
  return forms.values().next().value || "百分比";
}

function parseRecognitionAmountCents(value: unknown, index: number) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  if (!/^-?(?:\d+|\d*\.\d{1,2})$/.test(text)) {
    throw new Error(`分账 ${index + 1} 认账金额格式不正确`);
  }
  return toCents(text);
}

export function validateIncomeRuleRecognitionAmounts(
  availableAmount: number | string,
  rows: Array<{ recognitionAmount?: string | null }>,
) {
  const availableCents = toCents(availableAmount);
  if (availableCents === 0) throw new Error("该流水已无可认账金额");

  const amountCents = rows.map((row, index) => parseRecognitionAmountCents(row.recognitionAmount, index));
  const hasOppositeDirection = amountCents.some((amount) => (
    (availableCents > 0 && amount < 0)
    || (availableCents < 0 && amount > 0)
  ));
  if (hasOppositeDirection) {
    throw new Error("分账认账金额必须与银行流水金额方向一致");
  }
  const totalCents = amountCents.reduce((sum, amount) => sum + amount, 0);
  if (totalCents !== availableCents) {
    throw new Error(`认账金额合计必须等于可认账金额 ${formatCents(availableCents)}，当前为 ${formatCents(totalCents)}`);
  }

  return {
    totalAmount: formatCents(totalCents),
    amounts: amountCents.map(formatCents),
    nonZeroIndexes: amountCents
      .map((amount, index) => amount !== 0 ? index : -1)
      .filter((index) => index >= 0),
  };
}
