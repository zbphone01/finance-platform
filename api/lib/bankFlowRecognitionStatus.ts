export type StoredBankFlowRecognitionStatus =
  | "unrecognized"
  | "partial_matched"
  | "recognized"
  | "large_variance";

export type BankFlowDisplayStatus =
  | "processing"
  | "unrecognized"
  | "partial_matched"
  | "recognized"
  | "variance_partial_matched"
  | "variance_unrecognized";

export function deriveBankFlowDisplayStatus(input: {
  recognitionStatus: StoredBankFlowRecognitionStatus | string | null | undefined;
  taskStatus: string | null | undefined;
  hasRecognitionProgress: boolean;
}): BankFlowDisplayStatus {
  if (input.taskStatus === "processing") return "processing";
  if (input.recognitionStatus === "recognized") return "recognized";

  const hasVariance = input.recognitionStatus === "large_variance"
    || input.taskStatus === "large_variance";
  if (hasVariance) {
    return input.recognitionStatus === "partial_matched" || input.hasRecognitionProgress
      ? "variance_partial_matched"
      : "variance_unrecognized";
  }

  if (input.recognitionStatus === "partial_matched") return "partial_matched";
  return "unrecognized";
}
