export type AmountCandidate = {
  amount: string | number | null;
};

type CombinationOptions = {
  maxStateCount?: number;
};

function amountToCents(value: unknown) {
  return Math.round(Number(value || 0) * 100);
}

export function findFirstAmountCombination<T extends AmountCandidate>(
  rows: T[],
  targetCents: number,
  options: CombinationOptions = {},
) {
  const states = new Map<number, number[]>();
  states.set(0, []);
  const maxStateCount = options.maxStateCount ?? 50000;

  for (let index = 0; index < rows.length; index += 1) {
    const amountCents = amountToCents(rows[index].amount);
    if (amountCents <= 0 || amountCents > targetCents) continue;
    const currentEntries = Array.from(states.entries());
    for (const [sum, indexes] of currentEntries) {
      const nextSum = sum + amountCents;
      if (nextSum > targetCents || states.has(nextSum)) continue;
      const nextIndexes = [...indexes, index];
      if (nextSum === targetCents && nextIndexes.length >= 2) {
        return nextIndexes.map((rowIndex) => rows[rowIndex]);
      }
      states.set(nextSum, nextIndexes);
      if (states.size > maxStateCount) break;
    }
    if (states.size > maxStateCount) break;
  }

  return [];
}

function buildSubsetStates<T extends AmountCandidate>(rows: T[], maxStateCount: number) {
  const states = new Map<number, number[]>();
  states.set(0, []);

  for (let index = 0; index < rows.length; index += 1) {
    const amountCents = amountToCents(rows[index].amount);
    if (amountCents <= 0) continue;
    const currentEntries = Array.from(states.entries());
    for (const [sum, indexes] of currentEntries) {
      const nextSum = sum + amountCents;
      const nextIndexes = [...indexes, index];
      const existing = states.get(nextSum);
      if (existing && existing.length <= nextIndexes.length) continue;
      if (!existing && states.size >= maxStateCount) continue;
      states.set(nextSum, nextIndexes);
    }
  }

  return states;
}

export function findVarianceAdjustmentSuggestion<TIgnore extends AmountCandidate, TTransfer extends AmountCandidate>(
  ignoreRows: TIgnore[],
  transferRows: TTransfer[],
  targetCents: number,
  options: CombinationOptions = {},
) {
  const exactIgnore = ignoreRows.find((row) => amountToCents(row.amount) === targetCents);
  if (exactIgnore) {
    return { ignoreItems: [exactIgnore], transferItems: [] as TTransfer[] };
  }

  const ignoreCombination = findFirstAmountCombination(ignoreRows, targetCents, options);
  if (ignoreCombination.length > 0) {
    return { ignoreItems: ignoreCombination, transferItems: [] as TTransfer[] };
  }

  if (targetCents <= 0 || ignoreRows.length === 0 || transferRows.length === 0) {
    return { ignoreItems: [] as TIgnore[], transferItems: [] as TTransfer[] };
  }

  const maxStateCount = options.maxStateCount ?? 50000;
  const ignoreStates = buildSubsetStates(ignoreRows, maxStateCount);
  const transferStates = buildSubsetStates(transferRows, maxStateCount);
  let best: { ignoreIndexes: number[]; transferIndexes: number[] } | null = null;

  for (const [ignoreSum, ignoreIndexes] of ignoreStates.entries()) {
    if (ignoreIndexes.length === 0 || ignoreSum <= targetCents) continue;
    const transferIndexes = transferStates.get(ignoreSum - targetCents);
    if (!transferIndexes || transferIndexes.length === 0) continue;
    if (!best || ignoreIndexes.length + transferIndexes.length < best.ignoreIndexes.length + best.transferIndexes.length) {
      best = { ignoreIndexes, transferIndexes };
    }
  }

  if (!best) {
    return { ignoreItems: [] as TIgnore[], transferItems: [] as TTransfer[] };
  }
  return {
    ignoreItems: best.ignoreIndexes.map((index) => ignoreRows[index]),
    transferItems: best.transferIndexes.map((index) => transferRows[index]),
  };
}
