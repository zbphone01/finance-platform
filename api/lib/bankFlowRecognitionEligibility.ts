import { toCents } from "./splitAmounts";

export type BankFlowDirection = "income" | "expense" | "zero";

export function getBankFlowDirection(amount: number | string | null | undefined): BankFlowDirection {
  const amountCents = toCents(amount);
  if (amountCents > 0) return "income";
  if (amountCents < 0) return "expense";
  return "zero";
}

export function isBankFlowRecognitionEligible(amount: number | string | null | undefined) {
  return getBankFlowDirection(amount) === "income";
}

export function assertBankFlowRecognitionEligible(amount: number | string | null | undefined) {
  if (!isBankFlowRecognitionEligible(amount)) {
    throw new Error("支出流水仅供查看，不支持认账");
  }
}
