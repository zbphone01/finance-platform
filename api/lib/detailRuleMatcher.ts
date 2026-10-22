export type DetailRuleMatchItem = {
  id: number;
  detailKeyword?: string | null;
  keywordField?: string | null;
  keywordMatchType?: string | null;
};

type ReadFieldValue<Row> = (row: Row, keywordField: string) => unknown;

type ContainsMatchItem = {
  item: DetailRuleMatchItem;
  keyword: string;
};

type CombinedSplitMatchItem = ContainsMatchItem & {
  keywordMatchType: string;
};

export type MultiSplitMatchConfig = {
  conditionRecognitionEnabled?: boolean | null;
  enabled?: boolean | null;
  keywordField?: string | null;
  keyword?: string | null;
};

export type DetailRuleMatchResult = {
  item: DetailRuleMatchItem | null;
  status: "matched" | "pending_split";
};

export function findStaleDetailRuleItemIds(
  storedRuleItemIds: Array<number | string | null | undefined>,
  currentItems: Array<Pick<DetailRuleMatchItem, "id">>,
) {
  const currentItemIds = new Set(
    currentItems.map((item) => Number(item.id)).filter((id) => Number.isSafeInteger(id) && id > 0),
  );
  const storedItemIds = new Set(
    storedRuleItemIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0),
  );
  return Array.from(storedItemIds).filter((id) => !currentItemIds.has(id));
}

function cleanMatchCell(value: unknown) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^[`'"]+/, "")
    .replace(/[`'"]+$/, "")
    .trim();
}

function normalizeMatchSpaces(value: string) {
  return cleanMatchCell(value).replace(/\s+/g, " ");
}

function buildCombinedKeyword(keyword: string, multiSplitKeyword: string) {
  return normalizeMatchSpaces(`${keyword} ${multiSplitKeyword}`);
}

export function createDetailRuleItemMatcher<Row>(
  items: DetailRuleMatchItem[],
  readFieldValue: ReadFieldValue<Row>,
  multiSplitConfig?: MultiSplitMatchConfig,
) {
  const exactByField = new Map<string, Map<string, DetailRuleMatchItem>>();
  const containsByField = new Map<string, ContainsMatchItem[]>();
  const combinedExactSplitItems: CombinedSplitMatchItem[] = [];
  const combinedContainsSplitItems: CombinedSplitMatchItem[] = [];
  const multiSplitKeywordField = cleanMatchCell(multiSplitConfig?.keywordField);
  const multiSplitKeyword = cleanMatchCell(multiSplitConfig?.keyword);
  const hasMultiSplitFastPath = Boolean(multiSplitConfig?.enabled && multiSplitKeywordField && multiSplitKeyword);
  const matchAllItem = multiSplitConfig?.conditionRecognitionEnabled === false ? items[0] || null : null;

  for (const item of items) {
    const keywordField = cleanMatchCell(item.keywordField);
    const keyword = cleanMatchCell(item.detailKeyword);
    if (!keywordField || !keyword) continue;

    if (hasMultiSplitFastPath && keywordField === multiSplitKeywordField) {
      const combinedItem = {
        item,
        keyword,
        keywordMatchType: item.keywordMatchType || "等于",
      };
      if (item.keywordMatchType === "包含") {
        combinedContainsSplitItems.push(combinedItem);
      } else {
        combinedExactSplitItems.push(combinedItem);
      }
    }

    if (item.keywordMatchType === "包含") {
      const containsItems = containsByField.get(keywordField) || [];
      containsItems.push({ item, keyword });
      containsByField.set(keywordField, containsItems);
      continue;
    }

    const exactItems = exactByField.get(keywordField) || new Map<string, DetailRuleMatchItem>();
    if (!exactItems.has(keyword)) exactItems.set(keyword, item);
    exactByField.set(keywordField, exactItems);
  }

  return (row: Row): DetailRuleMatchResult | null => {
    if (matchAllItem) return { item: matchAllItem, status: "matched" };

    for (const [keywordField, exactItems] of exactByField) {
      const fieldValue = cleanMatchCell(readFieldValue(row, keywordField));
      const exactItem = exactItems.get(fieldValue);
      if (exactItem) return { item: exactItem, status: "matched" };
    }

    if (hasMultiSplitFastPath) {
      const fieldValue = cleanMatchCell(readFieldValue(row, multiSplitKeywordField));
      const normalizedFieldValue = normalizeMatchSpaces(fieldValue);
      for (const splitItem of combinedExactSplitItems) {
        const combinedKeyword = buildCombinedKeyword(splitItem.keyword, multiSplitKeyword);
        if (normalizedFieldValue === combinedKeyword) return { item: null, status: "pending_split" };
      }
      for (const splitItem of combinedContainsSplitItems) {
        const combinedKeyword = buildCombinedKeyword(splitItem.keyword, multiSplitKeyword);
        if (normalizedFieldValue.includes(combinedKeyword)) return { item: null, status: "pending_split" };
      }
    }

    for (const [keywordField, containsItems] of containsByField) {
      const fieldValue = cleanMatchCell(readFieldValue(row, keywordField));
      if (!fieldValue) continue;
      const containsItem = containsItems.find((item) => fieldValue.includes(item.keyword));
      if (containsItem) return { item: containsItem.item, status: "matched" };
    }

    return null;
  };
}
