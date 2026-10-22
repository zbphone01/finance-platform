import { describe, expect, it } from "vitest";
import {
  getDetailSplitBindingDates,
  isDetailSplitGroupAmountMatch,
  isDetailSplitGroupReady,
  planDetailSplitRuleRematches,
} from "./detailSplitMatching";

describe("getDetailSplitBindingDates", () => {
  it("keeps the source order date separate from its recognition partition date", () => {
    expect(getDetailSplitBindingDates({
      billDate: "2026-08-01",
      partitionDate: "2026-08-02",
    })).toEqual({
      billDate: "2026-08-01",
      partitionDate: "2026-08-02",
    });
  });
});

describe("isDetailSplitGroupAmountMatch", () => {
  it("accepts a single successful split detail when its amount equals the pending source", () => {
    expect(
      isDetailSplitGroupAmountMatch({ ids: [101], totalCents: 8880 }, "88.80")
    ).toBe(true);
  });

  it("keeps supporting multiple split details whose total equals the pending source", () => {
    expect(
      isDetailSplitGroupAmountMatch({ ids: [101, 102], totalCents: 8880 }, "88.80")
    ).toBe(true);
  });

  it("rejects empty or amount-mismatched groups", () => {
    expect(
      isDetailSplitGroupAmountMatch({ ids: [], totalCents: 8880 }, "88.80")
    ).toBe(false);
    expect(
      isDetailSplitGroupAmountMatch({ ids: [101], totalCents: 8879 }, "88.80")
    ).toBe(false);
  });

  it("does not keep the previous one-cent tolerance", () => {
    expect(
      isDetailSplitGroupAmountMatch({ ids: [101], totalCents: 8879 }, "88.80")
    ).toBe(false);
    expect(
      isDetailSplitGroupAmountMatch({ ids: [101], totalCents: 8881 }, "88.80")
    ).toBe(false);
  });
});

describe("isDetailSplitGroupReady", () => {
  it("requires every unique child detail to match a recognition condition", () => {
    expect(isDetailSplitGroupReady({
      ids: [101, 102],
      totalCents: 8880,
      allRecognizable: false,
    }, "88.80")).toBe(false);
    expect(isDetailSplitGroupReady({
      ids: [101, 102],
      totalCents: 8880,
      allRecognizable: true,
    }, "88.80")).toBe(true);
  });
});

describe("planDetailSplitRuleRematches", () => {
  it("rematches unrecognized split rows whose historical rule item was deleted", () => {
    expect(planDetailSplitRuleRematches([
      { id: 101, matchStatus: "matched", ruleItemId: 4449, keyword: "活动A" },
      { id: 102, matchStatus: "matched", ruleItemId: 5179, keyword: "活动A" },
      { id: 103, matchStatus: "unmatched", ruleItemId: null, keyword: "活动B" },
      { id: 104, matchStatus: "matched", ruleItemId: null, keyword: "未配置活动" },
    ], [
      { id: 5179, keyword: "活动A" },
      { id: 5182, keyword: "活动B" },
    ], [5179, 5182])).toEqual({
      staleMatchedIds: [101, 104],
      assignments: [
        { ruleItemId: 5179, detailIds: [101] },
        { ruleItemId: 5182, detailIds: [103] },
      ],
    });
  });
});
