import { describe, expect, it } from "vitest";
import {
  createManualSplit,
  createManualSplitForAmount,
  serializeManualRecognitionSplits,
  updateManualFundSourceFeedback,
  validateManualRecognitionSplits,
} from "./ManualRecognitionForm";

function createValidSplit() {
  return {
    ...createManualSplit("100"),
    incomeType: "其他",
    incomeAttr: "非限定性收入",
  };
}

describe("manual recognition signed amounts", () => {
  it("defaults negative recognition amounts to order refund", () => {
    expect(createManualSplitForAmount("-100.00", "income")).toMatchObject({
      incomeType: "订单退款",
      donationSource: "银行直捐",
    });
    expect(createManualSplitForAmount("100.00", "income")).toMatchObject({
      incomeType: "",
      donationSource: "",
    });
  });

  it("validates and serializes order refunds with donation-income attributes", () => {
    const split = {
      ...createManualSplitForAmount("-100.00", "income"),
      incomeAttr: "非限定性收入",
      incomeDept: "01_项目部",
      budgetCode: "1.1-测试预算",
      incomeProject: "PM001_测试项目",
      feedbackType: "反馈",
      region: "北京市",
      managementFeeValue: "5",
      managementFeeRatio: "5",
      expenseFundSource: "非限定性_反馈_退款活动",
    };
    expect(validateManualRecognitionSplits([split], "-100.00")).toBeNull();
    expect(serializeManualRecognitionSplits([split])[0]).toMatchObject({
      incomeType: "订单退款",
      donationSource: "银行直捐",
      feedbackType: "反馈",
      region: "北京市",
      expenseFundSource: "非限定性_反馈_退款活动",
    });
  });

  it("requires a donation source for manually recognized order refunds", () => {
    const split = {
      ...createManualSplitForAmount("-100.00", "income"),
      donationSource: "",
    };
    expect(validateManualRecognitionSplits([split], "-100.00")).toEqual({
      message: "分账 1 捐赠来源必填",
    });
  });

  it("accepts percentage splits for a negative recognition amount", () => {
    expect(validateManualRecognitionSplits([createValidSplit()], "-100.00")).toBeNull();
  });

  it("accepts negative fixed splits whose sum equals the negative recognition amount", () => {
    const first = { ...createValidSplit(), splitForm: "金额" as const, splitRatio: "0", splitAmount: "-40.00" };
    const second = { ...createValidSplit(), splitForm: "金额" as const, splitRatio: "0", splitAmount: "-60.00" };
    expect(validateManualRecognitionSplits([first, second], "-100.00")).toBeNull();
    expect(serializeManualRecognitionSplits([first, second]).map((split) => split.splitAmount))
      .toEqual(["-40", "-60"]);
  });

  it("rejects fixed splits in the opposite direction", () => {
    const split = { ...createValidSplit(), splitForm: "金额" as const, splitRatio: "0", splitAmount: "100.00" };
    expect(validateManualRecognitionSplits([split], "-100.00")).toEqual({
      message: "各分账金额必须与认账金额方向一致且不能为0",
      presentation: "dialog",
    });
  });
});

describe("manual recognition fund source feedback", () => {
  it("keeps the selected activity when feedback is selected afterwards", () => {
    expect(updateManualFundSourceFeedback(
      "非限定性_测试到账户名_春季_捐赠",
      "非限定性收入",
      "",
      "反馈",
      "测试到账户名",
    )).toBe("非限定性_反馈_测试到账户名_春季_捐赠");
  });

  it("updates the feedback segment without clearing the selected activity", () => {
    expect(updateManualFundSourceFeedback(
      "限定性_反馈_测试到账户名_公益活动",
      "限定性收入",
      "反馈",
      "重点反馈",
      "测试到账户名",
    )).toBe("限定性_重点反馈_测试到账户名_公益活动");
  });
});
