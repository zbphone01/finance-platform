import { describe, expect, it } from "vitest";
import {
  assertBankFlowRecognitionEligible,
  getBankFlowDirection,
  isBankFlowRecognitionEligible,
} from "./bankFlowRecognitionEligibility";

describe("bank flow recognition eligibility", () => {
  it("classifies positive amounts as recognizable income", () => {
    expect(getBankFlowDirection("100.00")).toBe("income");
    expect(isBankFlowRecognitionEligible("0.01")).toBe(true);
  });

  it("classifies negative amounts as view-only expense", () => {
    expect(getBankFlowDirection("-100.00")).toBe("expense");
    expect(isBankFlowRecognitionEligible("-0.01")).toBe(false);
    expect(() => assertBankFlowRecognitionEligible("-10.00"))
      .toThrow("支出流水仅供查看，不支持认账");
  });

  it("does not allow zero or invalid amounts to enter recognition", () => {
    expect(getBankFlowDirection("0.00")).toBe("zero");
    expect(getBankFlowDirection("invalid")).toBe("zero");
    expect(isBankFlowRecognitionEligible(null)).toBe(false);
  });
});
