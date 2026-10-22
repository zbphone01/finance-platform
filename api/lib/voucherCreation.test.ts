import { describe, expect, it } from "vitest";
import {
  getManualVoucherCancellationMatchResultIds,
  getPendingGeneratedVoucherMatchResultIds,
  groupPendingManualVoucherRequirements,
  isVoucherCreationComplete,
  isVoucherScopeFullyCreated,
  isTemplateVoucherRecognitionResult,
  needsInterestSummaryContent,
} from "./voucherCreation";

describe("voucher creation classification", () => {
  it("groups pending manual voucher amounts by income type", () => {
    expect(groupPendingManualVoucherRequirements([
      { id: 1, incomeType: "政府补助", splitAmount: "30.25", voucherStatus: "pending" },
      { id: 2, incomeType: "政府补助", splitAmount: "19.75", voucherStatus: "pending" },
      { id: 3, incomeType: "利息", splitAmount: "8.00", voucherStatus: "pending" },
      { id: 4, incomeType: "其他", splitAmount: "5.00", voucherStatus: "created" },
    ])).toEqual([
      { incomeType: "政府补助", amount: 50, matchResultIds: [1, 2] },
    ]);
  });

  it("keeps template income and refunds in the generated voucher group", () => {
    expect(getPendingGeneratedVoucherMatchResultIds([
      { id: 1, incomeType: "捐赠收入", voucherStatus: "pending" },
      { id: 2, incomeType: "会费收入", voucherStatus: "pending" },
      { id: 3, incomeType: "订单退款", voucherStatus: "pending" },
      { id: 4, incomeType: "利息", voucherStatus: "pending" },
      { id: 5, incomeType: "捐赠收入", voucherStatus: "created" },
    ])).toEqual([1, 2, 3, 4]);
  });

  it("uses templates for arrival refunds without changing detail refund handling", () => {
    expect(isTemplateVoucherRecognitionResult({
      ruleItemId: null,
      orderDetailCountSnapshot: 0,
      incomeType: "订单退款",
    })).toBe(true);
    expect(isTemplateVoucherRecognitionResult({
      ruleItemId: null,
      orderDetailCountSnapshot: 1,
      incomeType: "订单退款",
    })).toBe(false);
    expect(isTemplateVoucherRecognitionResult({
      ruleItemId: 10,
      orderDetailCountSnapshot: 2,
      incomeType: "订单退款",
    })).toBe(false);
    expect(isTemplateVoucherRecognitionResult({
      ruleItemId: 10,
      orderDetailCountSnapshot: 2,
      incomeType: "捐赠收入",
    })).toBe(true);
  });

  it("offers interest summary content only for pending interest results", () => {
    expect(needsInterestSummaryContent([
      { id: 1, incomeType: "利息", voucherStatus: "pending" },
      { id: 2, incomeType: "捐赠收入", voucherStatus: "pending" },
    ])).toBe(true);
    expect(needsInterestSummaryContent([
      { id: 1, incomeType: "利息", voucherStatus: "created" },
      { id: 2, incomeType: "捐赠收入", voucherStatus: "pending" },
    ])).toBe(false);
  });

  it("reports completion only when every recognition result is created", () => {
    expect(isVoucherCreationComplete([
      { id: 1, voucherStatus: "created" },
      { id: 2, voucherStatus: "created" },
    ])).toBe(true);
    expect(isVoucherCreationComplete([
      { id: 1, voucherStatus: "created" },
      { id: 2, voucherStatus: "pending" },
    ])).toBe(false);
  });

  it("reports aggregate voucher completion across sparse per-flow summaries", () => {
    expect(isVoucherScopeFullyCreated([
      { resultCount: 65, pendingVoucherCount: 0 },
      undefined,
      { resultCount: 6, pendingVoucherCount: 0 },
    ])).toBe(true);
    expect(isVoucherScopeFullyCreated([
      { resultCount: 65, pendingVoucherCount: 0 },
      { resultCount: 6, pendingVoucherCount: 1 },
    ])).toBe(false);
    expect(isVoucherScopeFullyCreated([undefined])).toBe(false);
  });

  it("keeps cancellation support for historical manual interest vouchers", () => {
    expect(getManualVoucherCancellationMatchResultIds([
      { id: 1, incomeType: "利息", voucherStatus: "created" },
      { id: 2, incomeType: "利息", voucherStatus: "pending" },
      { id: 3, incomeType: "政府补助", voucherStatus: "created" },
      { id: 4, incomeType: "捐赠收入", voucherStatus: "created" },
    ], "利息")).toEqual([1]);
  });
});
