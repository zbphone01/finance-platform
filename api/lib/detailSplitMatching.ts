import { toCents } from "./splitAmounts";

export function getDetailSplitBindingDates(source: { billDate: unknown; partitionDate: unknown }) {
  const billDate = String(source.billDate || "1970-01-01");
  const partitionDate = String(source.partitionDate || "1970-01-01");
  return { billDate, partitionDate };
}

export function isDetailSplitGroupAmountMatch(
  group: { ids: number[]; totalCents: number } | undefined,
  sourceAmount: unknown
) {
  return Boolean(
    group &&
    group.ids.length > 0 &&
    group.totalCents === toCents(sourceAmount as number | string | null | undefined)
  );
}

export function isDetailSplitGroupReady(
  group: { ids: number[]; totalCents: number; allRecognizable: boolean } | undefined,
  sourceAmount: unknown,
) {
  return Boolean(group?.allRecognizable && isDetailSplitGroupAmountMatch(group, sourceAmount));
}

export type DetailSplitRuleRematchRow = {
  id: number;
  matchStatus: "matched" | "unmatched";
  ruleItemId: number | null;
  keyword: string;
};

export type DetailSplitExactRuleItem = {
  id: number;
  keyword: string;
};

export function planDetailSplitRuleRematches(
  rows: DetailSplitRuleRematchRow[],
  exactItems: DetailSplitExactRuleItem[],
  currentRuleItemIds: number[] = exactItems.map((item) => item.id),
) {
  const validRuleItemIds = new Set(currentRuleItemIds.map(Number).filter(Boolean));
  const ruleItemIdByKeyword = new Map(exactItems
    .filter((item) => Number(item.id) > 0 && item.keyword)
    .map((item) => [item.keyword, Number(item.id)]));
  const staleMatchedIds: number[] = [];
  const detailIdsByRuleItem = new Map<number, number[]>();

  for (const row of rows) {
    const detailId = Number(row.id || 0);
    if (!detailId) continue;
    const staleMatched = row.matchStatus === "matched"
      && !validRuleItemIds.has(Number(row.ruleItemId || 0));
    if (row.matchStatus !== "unmatched" && !staleMatched) continue;
    if (staleMatched) staleMatchedIds.push(detailId);

    const ruleItemId = ruleItemIdByKeyword.get(row.keyword);
    if (!ruleItemId) continue;
    const detailIds = detailIdsByRuleItem.get(ruleItemId) || [];
    detailIds.push(detailId);
    detailIdsByRuleItem.set(ruleItemId, detailIds);
  }

  return {
    staleMatchedIds,
    assignments: Array.from(detailIdsByRuleItem, ([ruleItemId, detailIds]) => ({
      ruleItemId,
      detailIds,
    })),
  };
}
