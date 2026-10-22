import { describe, expect, it } from "vitest";
import { findVarianceAdjustmentSuggestion } from "./varianceAdjustment";

const row = (id: number, amount: number) => ({ id, amount: amount.toFixed(2) });

describe("variance adjustment suggestion", () => {
  it("prefers a direct ignore match", () => {
    const result = findVarianceAdjustmentSuggestion(
      [row(1, 0.41), row(2, 2)],
      [row(3, 1.59)],
      41,
    );
    expect(result.ignoreItems.map((item) => item.id)).toEqual([1]);
    expect(result.transferItems).toEqual([]);
  });

  it("prefers an ignore-only combination before transferring ignored orders", () => {
    const result = findVarianceAdjustmentSuggestion(
      [row(1, 0.2), row(2, 0.21), row(3, 2)],
      [row(4, 1.59)],
      41,
    );
    expect(result.ignoreItems.map((item) => item.id)).toEqual([1, 2]);
    expect(result.transferItems).toEqual([]);
  });

  it("combines an ignored and transferred order by their net amount", () => {
    const result = findVarianceAdjustmentSuggestion(
      [row(1, 2)],
      [row(2, 0.59), row(3, 1.59), row(4, 2.59)],
      41,
    );
    expect(result.ignoreItems.map((item) => item.id)).toEqual([1]);
    expect(result.transferItems.map((item) => item.id)).toEqual([3]);
  });

  it("supports multiple orders on both sides of the net adjustment", () => {
    const result = findVarianceAdjustmentSuggestion(
      [row(1, 1), row(2, 1)],
      [row(3, 0.5), row(4, 1.09)],
      41,
    );
    expect(result.ignoreItems.map((item) => item.id)).toEqual([1, 2]);
    expect(result.transferItems.map((item) => item.id)).toEqual([3, 4]);
  });

  it("returns no suggestion when the variance cannot be flattened", () => {
    const result = findVarianceAdjustmentSuggestion(
      [row(1, 1)],
      [row(2, 0.5)],
      41,
    );
    expect(result.ignoreItems).toEqual([]);
    expect(result.transferItems).toEqual([]);
  });
});
