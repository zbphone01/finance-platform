import { describe, expect, it } from "vitest";
import { calculatePartialTransferAmount, resolvePartialTransferPendingTaskIds } from "./partialTransferAmount";

describe("partial transfer amount", () => {
  it("uses the full available amount when there are no pending split orders", () => {
    expect(calculatePartialTransferAmount(10000, 0)).toEqual({
      recognitionAvailableCents: 10000,
      pendingSplitCents: 0,
      transferTargetCents: 10000,
      pendingSplitMatchesAvailable: false,
      pendingSplitExceedsAvailable: false,
    });
  });

  it("subtracts pending split orders from the transfer target", () => {
    expect(calculatePartialTransferAmount(10000, 6000).transferTargetCents).toBe(4000);
  });

  it("blocks recommendations when pending split equals the available amount", () => {
    const result = calculatePartialTransferAmount(10000, 10000);
    expect(result.transferTargetCents).toBe(0);
    expect(result.pendingSplitMatchesAvailable).toBe(true);
    expect(result.pendingSplitExceedsAvailable).toBe(false);
  });

  it("does not return a negative target when pending split exceeds the available amount", () => {
    const result = calculatePartialTransferAmount(10000, 12000);
    expect(result.transferTargetCents).toBe(0);
    expect(result.pendingSplitMatchesAvailable).toBe(false);
    expect(result.pendingSplitExceedsAvailable).toBe(true);
  });
});

describe("partial transfer pending task scope", () => {
  it("uses only the current task for single-flow matching", () => {
    expect(resolvePartialTransferPendingTaskIds(36)).toEqual([36]);
  });

  it("uses all related tasks for aggregate matching", () => {
    expect(resolvePartialTransferPendingTaskIds(36, [20, 21, 36, 20])).toEqual([36, 20, 21]);
  });
});
