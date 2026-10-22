export type VoucherOverviewLineExplanation = Record<"结算方式" | "银行账户", string>;

export function buildVoucherOverviewLineExplanation(bankAccountAlias?: string | null): VoucherOverviewLineExplanation {
  return {
    结算方式: "203_网上银行",
    银行账户: String(bankAccountAlias || "").trim() || "-",
  };
}
