import { describe, expect, it } from "vitest";
import {
  isSignedAmountWithinAvailable,
  sanitizeSignedDecimalInput,
  toSignedAmountCents,
} from "./signedAmount";

describe("signed amount input", () => {
  it("keeps a leading minus sign and removes invalid characters", () => {
    expect(sanitizeSignedDecimalInput("-1,234.56")).toBe("-1234.56");
    expect(sanitizeSignedDecimalInput("12.3.4")).toBe("12.34");
    expect(sanitizeSignedDecimalInput("-10", false)).toBe("10");
  });

  it("compares requested amounts in the direction of the available amount", () => {
    expect(toSignedAmountCents("-10.01")).toBe(-1001);
    expect(isSignedAmountWithinAvailable("-4.00", "-6.00")).toBe(true);
    expect(isSignedAmountWithinAvailable("-7.00", "-6.00")).toBe(false);
    expect(isSignedAmountWithinAvailable("4.00", "-6.00")).toBe(false);
  });
});
