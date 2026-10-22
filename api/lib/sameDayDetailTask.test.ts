import { describe, expect, it } from "vitest";
import { allocateRecognizedAmountAcrossFlows } from "./sameDayDetailTask";

describe("allocateRecognizedAmountAcrossFlows", () => {
  const flows = [
    { id: 1, income: "100.00" },
    { id: 2, income: "200.00" },
    { id: 3, income: "300.00" },
  ];

  it("按顺序将实际入账金额覆盖到多笔流水", () => {
    expect(allocateRecognizedAmountAcrossFlows(flows, "250.00")).toEqual([
      { flowId: 1, status: "recognized", recognizedAmount: 100, recognitionAvailableAmount: 0 },
      { flowId: 2, status: "partial_matched", recognizedAmount: 150, recognitionAvailableAmount: 50 },
      { flowId: 3, status: "unrecognized", recognizedAmount: 0, recognitionAvailableAmount: 300 },
    ]);
  });

  it("入账金额覆盖全部流水时全部标记已认账", () => {
    expect(allocateRecognizedAmountAcrossFlows(flows, "600.00").map((item) => item.status))
      .toEqual(["recognized", "recognized", "recognized"]);
  });

  it("不受浮点小数影响", () => {
    expect(allocateRecognizedAmountAcrossFlows([
      { id: 1, income: "0.10" },
      { id: 2, income: "0.20" },
    ], "0.30").map((item) => item.status)).toEqual(["recognized", "recognized"]);
  });
});
