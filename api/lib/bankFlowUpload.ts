export function filterIngestibleBankFlows<T extends { bankName?: string; income: string }>(flows: T[]) {
  return flows.filter((flow) => {
    const amount = Number(flow.income);
    if (!Number.isFinite(amount) || amount === 0) return false;
    return flow.bankName !== "中国银行" || amount > 0;
  });
}
