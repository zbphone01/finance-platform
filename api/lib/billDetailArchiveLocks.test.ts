import { describe, expect, it } from "vitest";
import { isBillDetailArchiveEligibleDate } from "./billDetailArchiveLocks";

describe("bill detail archive date boundary", () => {
  it("treats the exact 60-day cutoff as archive eligible", () => {
    expect(isBillDetailArchiveEligibleDate("2026-05-17", "2026-07-16")).toBe(true);
  });

  it("keeps the most recent 60 calendar days in the rolling hot window", () => {
    expect(isBillDetailArchiveEligibleDate("2026-05-18", "2026-07-16")).toBe(false);
    expect(isBillDetailArchiveEligibleDate("2026-07-16", "2026-07-16")).toBe(false);
  });
});
