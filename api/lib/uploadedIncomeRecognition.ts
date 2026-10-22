export const UPLOADED_INCOME_RECOGNITION_BATCH_SIZE = 100;

export type UploadedIncomeRecognitionCandidate = {
  flowId: number;
  taskId: number;
  billDate: string;
  matchedCounterpartyId: number;
  matchedCounterpartyAlias: string;
  arrivalRegion: string | null;
};

export function chunkUploadedIncomeRecognitionCandidates<T>(
  candidates: T[],
  batchSize = UPLOADED_INCOME_RECOGNITION_BATCH_SIZE,
) {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("到账认账批次大小必须是正整数");
  }
  const batches: T[][] = [];
  for (let index = 0; index < candidates.length; index += batchSize) {
    batches.push(candidates.slice(index, index + batchSize));
  }
  return batches;
}

export function buildUploadedIncomeRecognitionRuleLookups<
  Rule extends { id: number; matchedCounterpartyAlias: string | null },
  Split extends { incomeRuleId: number },
>(rules: Rule[], splits: Split[]) {
  const ruleByCounterpartyAlias = new Map<string, Rule>();
  for (const rule of rules) {
    const alias = String(rule.matchedCounterpartyAlias || "").trim();
    if (alias && !ruleByCounterpartyAlias.has(alias)) {
      ruleByCounterpartyAlias.set(alias, rule);
    }
  }

  const splitsByRuleId = new Map<number, Split[]>();
  for (const split of splits) {
    const ruleId = Number(split.incomeRuleId);
    const rows = splitsByRuleId.get(ruleId) || [];
    rows.push(split);
    splitsByRuleId.set(ruleId, rows);
  }

  return { ruleByCounterpartyAlias, splitsByRuleId };
}
