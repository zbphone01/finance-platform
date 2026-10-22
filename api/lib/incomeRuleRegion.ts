export type IncomeRuleRegionMode = "platform" | "direct" | "membership" | "interest" | "remarkOnly";

export function resolveIncomeRuleRecognitionRegion(input: {
  splitMode: IncomeRuleRegionMode;
  bankDirectDonation: boolean;
  arrivalRegion?: string | null;
  channelRegion?: string | null;
  configuredRegion?: string | null;
}) {
  if (input.splitMode === "interest" || input.splitMode === "remarkOnly") return null;
  if (input.bankDirectDonation) return input.arrivalRegion || null;
  if (input.splitMode === "platform") return input.channelRegion || null;
  return input.configuredRegion || null;
}
