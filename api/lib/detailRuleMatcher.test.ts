import { describe, expect, it } from "vitest";
import { findStaleDetailRuleItemIds } from "./detailRuleMatcher";

describe("detail rule item refresh", () => {
  it("finds stored rule item ids that no longer exist in the current rule", () => {
    expect(findStaleDetailRuleItemIds(
      [4555, 4556, 4555, null],
      [{ id: 5098 }, { id: 5099 }],
    )).toEqual([4555, 4556]);
  });

  it("keeps valid current rule item ids out of the stale set", () => {
    expect(findStaleDetailRuleItemIds(
      [5098, "5099", undefined],
      [{ id: 5098 }, { id: 5099 }],
    )).toEqual([]);
  });

  it("ignores empty and invalid stored identifiers", () => {
    expect(findStaleDetailRuleItemIds(
      [null, undefined, "", 0, "invalid"],
      [{ id: 5098 }],
    )).toEqual([]);
  });
});
