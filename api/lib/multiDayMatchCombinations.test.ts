import { describe, expect, it } from "vitest";
import { findMultiDayAmountSolutions } from "./multiDayMatchCombinations";

const row = (id: number, amount: number) => ({ id, amount: amount.toFixed(2) });

describe("multi-day bank flow combinations", () => {
  it("prefers a unique direct flow over combinations", () => {
    const result = findMultiDayAmountSolutions([row(1, 100), row(2, 40), row(3, 60)], 10000);
    expect(result.map((items) => items.map((item) => item.id))).toEqual([[1]]);
  });

  it("returns at most three direct alternatives", () => {
    const result = findMultiDayAmountSolutions([row(1, 100), row(2, 100), row(3, 100), row(4, 100)], 10000);
    expect(result.map((items) => items.map((item) => item.id))).toEqual([[1], [2], [3]]);
  });

  it("finds up to three multi-flow alternatives", () => {
    const result = findMultiDayAmountSolutions([
      row(1, 40), row(2, 60), row(3, 30), row(4, 70), row(5, 20), row(6, 80), row(7, 10), row(8, 90),
    ], 10000);
    expect(result).toHaveLength(3);
    expect(result.every((items) => items.reduce((sum, item) => sum + Number(item.amount), 0) === 100)).toBe(true);
  });

  it("requires a newly-added or current-day flow when a trigger is supplied", () => {
    const result = findMultiDayAmountSolutions(
      [row(1, 40), row(2, 60), row(3, 30), row(4, 70)],
      10000,
      { requiredCandidateIds: [3] },
    );
    expect(result.map((items) => items.map((item) => item.id))).toEqual([[3, 4]]);
  });

  it("returns no solution when the amount cannot be matched", () => {
    expect(findMultiDayAmountSolutions([row(1, 40), row(2, 50)], 10000)).toEqual([]);
  });
});
