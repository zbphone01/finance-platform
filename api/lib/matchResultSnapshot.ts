type BankFlowSnapshotSource = {
  referenceNo?: string | null;
  transactionTime?: string | null;
  income?: string | null;
  counterpartyAccount?: string | null;
  counterpartyName?: string | null;
  counterpartyBank?: string | null;
  summary?: string | null;
  purpose?: string | null;
  postScript?: string | null;
};

export function buildBankFlowSnapshot(flow: BankFlowSnapshotSource | null | undefined) {
  return {
    bankReferenceNo: flow?.referenceNo || null,
    bankTransactionTime: flow?.transactionTime || null,
    bankIncome: flow?.income || null,
    bankCounterpartyAccount: flow?.counterpartyAccount || null,
    bankCounterpartyName: flow?.counterpartyName || null,
    bankCounterpartyBank: flow?.counterpartyBank || null,
    bankSummary: flow?.summary || null,
    bankPurpose: flow?.purpose || null,
    bankPostScript: flow?.postScript || null,
  };
}

export function buildMatchResultDisplaySnapshot(
  flow: BankFlowSnapshotSource | null | undefined,
  platformProjectName?: string | null,
) {
  return {
    ...buildBankFlowSnapshot(flow),
    platformProjectDisplayName: platformProjectName || null,
  };
}
