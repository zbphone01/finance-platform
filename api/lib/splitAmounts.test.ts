import { describe, expect, it } from "vitest";
import {
  calculateManagementFeeAmountByType,
  deriveFlowRecognitionStatus,
  formatCents,
  getSignedRecognitionAvailableCents,
  hasRecognitionProgress,
  isSignedAmountWithinAvailable,
  splitAmountByRatios,
  toCents,
} from "./splitAmounts";

describe("splitAmounts", () => {
  it("统一将金额换算为整数分", () => {
    expect(toCents("10.00")).toBe(1000);
    expect(toCents(9.999)).toBe(1000);
    expect(formatCents(1001)).toBe("10.01");
  });

  it("按整数分精确判断银行流水认账状态", () => {
    expect(deriveFlowRecognitionStatus("10.00", "0.00")).toBe("unrecognized");
    expect(deriveFlowRecognitionStatus("10.00", "0.01")).toBe("partial_matched");
    expect(deriveFlowRecognitionStatus("10.00", "9.99")).toBe("partial_matched");
    expect(deriveFlowRecognitionStatus("10.00", "10.00")).toBe("recognized");
    expect(deriveFlowRecognitionStatus("10.00", "10.01")).toBe("recognized");
    expect(deriveFlowRecognitionStatus("-10.00", "0.00")).toBe("unrecognized");
    expect(deriveFlowRecognitionStatus("-10.00", "-0.01")).toBe("partial_matched");
    expect(deriveFlowRecognitionStatus("-10.00", "-9.99")).toBe("partial_matched");
    expect(deriveFlowRecognitionStatus("-10.00", "-10.00")).toBe("recognized");
    expect(deriveFlowRecognitionStatus("-10.00", "-10.01")).toBe("recognized");
  });

  it("分账后各行整数分合计保持不变", () => {
    const amounts = splitAmountByRatios("10.01", [33.33, 33.33, 33.34]);
    expect(amounts.reduce((sum, amount) => sum + toCents(amount), 0)).toBe(1001);
  });

  it("负数分账后各行合计保持负数总额", () => {
    const amounts = splitAmountByRatios("-10.01", [33.33, 33.33, 33.34]);
    expect(amounts).toEqual(["-3.34", "-3.34", "-3.33"]);
    expect(amounts.reduce((sum, amount) => sum + toCents(amount), 0)).toBe(-1001);
  });

  it("按流水方向计算剩余可认账金额和有效认账金额", () => {
    expect(getSignedRecognitionAvailableCents("10.00", "4.00")).toBe(600);
    expect(getSignedRecognitionAvailableCents("-10.00", "-4.00")).toBe(-600);
    expect(getSignedRecognitionAvailableCents("-10.00", "-11.00")).toBe(0);
    expect(getSignedRecognitionAvailableCents("10.00", "-1.00")).toBe(1000);
    expect(getSignedRecognitionAvailableCents("-10.00", "1.00")).toBe(-1000);
    expect(isSignedAmountWithinAvailable("6.00", "6.00")).toBe(true);
    expect(isSignedAmountWithinAvailable("-4.00", "-6.00")).toBe(true);
    expect(isSignedAmountWithinAvailable("-7.00", "-6.00")).toBe(false);
    expect(hasRecognitionProgress("-10.00", "-0.01")).toBe(true);
    expect(hasRecognitionProgress("-10.00", "0.01")).toBe(false);
  });

  it("固定管理费跟随入账金额方向", () => {
    expect(calculateManagementFeeAmountByType("100.00", "金额", "5.00")).toBe("5.00");
    expect(calculateManagementFeeAmountByType("-100.00", "金额", "5.00")).toBe("-5.00");
  });
});
