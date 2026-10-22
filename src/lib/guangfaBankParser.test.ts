import { describe, expect, it } from "vitest";
import { resolveGuangfaSignedAmount } from "./guangfaBankParser";

describe("resolveGuangfaSignedAmount", () => {
  it("keeps Guangfa income as a positive amount", () => {
    expect(resolveGuangfaSignedAmount("620.30", "-")).toBe("620.3");
  });

  it("maps Guangfa expense to a negative income amount", () => {
    expect(resolveGuangfaSignedAmount("-", "11,112.00")).toBe("-11112");
    expect(resolveGuangfaSignedAmount("", "434,939.92")).toBe("-434939.92");
  });

  it("uses the signed net amount when both columns contain values", () => {
    expect(resolveGuangfaSignedAmount("100.00", "20.00")).toBe("80");
  });
});
