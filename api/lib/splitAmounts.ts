export function formatCents(cents: number) {
  return (cents / 100).toFixed(2);
}

export function toCents(amount: number | string | null | undefined) {
  const value = Number(amount ?? 0);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

export function deriveFlowRecognitionStatus(income: number | string, recognizedAmount: number | string) {
  const incomeCents = toCents(income);
  const recognizedCents = toCents(recognizedAmount);
  if (incomeCents > 0 && recognizedCents >= incomeCents) return "recognized" as const;
  if (incomeCents < 0 && recognizedCents <= incomeCents) return "recognized" as const;
  if (
    (incomeCents > 0 && recognizedCents > 0)
    || (incomeCents < 0 && recognizedCents < 0)
  ) return "partial_matched" as const;
  return "unrecognized" as const;
}

export function getSignedRecognitionAvailableCents(
  income: number | string | null | undefined,
  recognizedAmount: number | string | null | undefined,
) {
  const incomeCents = toCents(income);
  const recognizedCents = toCents(recognizedAmount);
  if (incomeCents > 0) {
    if (recognizedCents <= 0) return incomeCents;
    return Math.max(0, incomeCents - recognizedCents);
  }
  if (incomeCents < 0) {
    if (recognizedCents >= 0) return incomeCents;
    return Math.min(0, incomeCents - recognizedCents);
  }
  return 0;
}

export function isSignedAmountWithinAvailable(
  amount: number | string | null | undefined,
  availableAmount: number | string | null | undefined,
) {
  const amountCents = toCents(amount);
  const availableCents = toCents(availableAmount);
  if (availableCents > 0) return amountCents > 0 && amountCents <= availableCents;
  if (availableCents < 0) return amountCents < 0 && amountCents >= availableCents;
  return false;
}

export function hasRecognitionProgress(
  income: number | string | null | undefined,
  recognizedAmount: number | string | null | undefined,
) {
  const incomeCents = toCents(income);
  const recognizedCents = toCents(recognizedAmount);
  return (incomeCents > 0 && recognizedCents > 0)
    || (incomeCents < 0 && recognizedCents < 0);
}

export function splitAmountByRatios(totalAmount: number | string, ratios: Array<number | string>) {
  if (ratios.length === 0) return [];

  const totalCents = toCents(totalAmount);
  const splitCents = ratios.map((ratio) => {
    const normalizedRatio = Number(ratio || 0);
    return Math.round((totalCents * normalizedRatio) / 100);
  });
  const splitTotalCents = splitCents.reduce((sum, amount) => sum + amount, 0);

  splitCents[splitCents.length - 1] += totalCents - splitTotalCents;

  return splitCents.map(formatCents);
}

export function calculateManagementFeeAmount(amount: number | string, ratio: number | string | null | undefined) {
  const normalizedAmount = Number(amount ?? 0);
  const normalizedRatio = Number(ratio ?? 0);
  if (!Number.isFinite(normalizedAmount) || !Number.isFinite(normalizedRatio) || normalizedRatio <= 0) return "0.00";
  return formatManagementFee(normalizedAmount * normalizedRatio / 100);
}

export function calculateManagementFeeAmountByType(
  amount: number | string,
  feeType: string | null | undefined,
  feeValue: number | string | null | undefined,
) {
  if (feeType === "金额") {
    const value = Number(feeValue ?? 0);
    const normalizedValue = Number.isFinite(value) ? Math.max(0, value) : 0;
    return formatManagementFee(toCents(amount) < 0 ? -normalizedValue : normalizedValue);
  }
  return calculateManagementFeeAmount(amount, feeValue);
}

function formatManagementFee(value: number) {
  const sign = value < 0 ? -1 : 1;
  const absValue = Math.abs(value);
  const cents = absValue >= 0.01
    ? Math.floor(absValue * 100)
    : Math.round(absValue * 100);
  return formatCents(cents * sign);
}
