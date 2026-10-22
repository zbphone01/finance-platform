export type MultiDayAmountCandidate = {
  id: number;
  amount: string | number | null;
};

export type MultiDayCombinationOptions = {
  maxSolutions?: number;
  maxStateCount?: number;
  requiredCandidateIds?: number[];
};

function amountToCents(value: unknown) {
  return Math.round(Number(value || 0) * 100);
}

function combinationKey(indexes: number[]) {
  return indexes.join(",");
}

export function findMultiDayAmountSolutions<T extends MultiDayAmountCandidate>(
  rows: T[],
  targetCents: number,
  options: MultiDayCombinationOptions = {},
) {
  if (targetCents <= 0) return [] as T[][];
  const maxSolutions = Math.max(1, options.maxSolutions ?? 3);
  const maxStateCount = Math.max(100, options.maxStateCount ?? 50000);
  const requiredIds = new Set((options.requiredCandidateIds || []).map(Number).filter(Boolean));
  const satisfiesTrigger = (indexes: number[]) => requiredIds.size === 0
    || indexes.some((index) => requiredIds.has(Number(rows[index]?.id)));

  // 单笔等额优先；存在单笔方案时不再混入多笔组合。
  const direct = rows.filter((row) => {
    const amountCents = amountToCents(row.amount);
    return amountCents === targetCents && (requiredIds.size === 0 || requiredIds.has(Number(row.id)));
  });
  if (direct.length > 0) return direct.slice(0, maxSolutions).map((row) => [row]);

  const states = new Map<number, number[][]>();
  states.set(0, [[]]);
  const solutions: number[][] = [];
  const solutionKeys = new Set<string>();

  for (let index = 0; index < rows.length; index += 1) {
    const amountCents = amountToCents(rows[index].amount);
    if (amountCents <= 0 || amountCents >= targetCents) continue;
    const currentEntries = Array.from(states.entries());
    for (const [sum, combinations] of currentEntries) {
      const nextSum = sum + amountCents;
      if (nextSum > targetCents) continue;
      for (const indexes of combinations) {
        const nextIndexes = [...indexes, index];
        if (nextSum === targetCents) {
          if (nextIndexes.length < 2 || !satisfiesTrigger(nextIndexes)) continue;
          const key = combinationKey(nextIndexes);
          if (!solutionKeys.has(key)) {
            solutionKeys.add(key);
            solutions.push(nextIndexes);
          }
          if (solutions.length >= maxSolutions) {
            return solutions.map((solution) => solution.map((rowIndex) => rows[rowIndex]));
          }
          continue;
        }
        const existing = states.get(nextSum) || [];
        if (existing.length >= maxSolutions) continue;
        states.set(nextSum, [...existing, nextIndexes]);
      }
      if (states.size >= maxStateCount) break;
    }
    if (states.size >= maxStateCount) break;
  }

  return solutions
    .sort((a, b) => a.length - b.length || combinationKey(a).localeCompare(combinationKey(b)))
    .slice(0, maxSolutions)
    .map((solution) => solution.map((rowIndex) => rows[rowIndex]));
}
