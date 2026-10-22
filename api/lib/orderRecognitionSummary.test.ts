import { describe, expect, it } from "vitest";
import {
  addOrderRecognitionSummaryDetail,
  deriveFreshOrderRecognitionPhaseSummaries,
  serializeOrderRecognitionSummary,
  summarizeOrderRecognitionFiles,
  summarizeOrderRecognitionGroups,
  type OrderRecognitionSummaryAccumulator,
} from "./orderRecognitionSummary";

describe("order recognition summary", () => {
  it("aggregates matched income and refund details by rule item", () => {
    const accumulator: OrderRecognitionSummaryAccumulator = new Map();

    addOrderRecognitionSummaryDetail(accumulator, {
      matchStatus: "matched",
      ruleItemId: 11,
      totalAmount: "0.01",
      refundAmountSnapshot: "0.00",
    });
    addOrderRecognitionSummaryDetail(accumulator, {
      matchStatus: "matched",
      ruleItemId: 11,
      totalAmount: "0.02",
      refundAmountSnapshot: "0.00",
    });
    addOrderRecognitionSummaryDetail(accumulator, {
      matchStatus: "matched",
      ruleItemId: 11,
      totalAmount: "-5.00",
      refundAmountSnapshot: "5.00",
    });
    addOrderRecognitionSummaryDetail(accumulator, {
      matchStatus: "matched",
      ruleItemId: 12,
      totalAmount: "10.00",
      refundAmountSnapshot: "0.00",
    });

    expect(serializeOrderRecognitionSummary(99, accumulator)).toEqual([
      {
        orderFileId: 99,
        ruleItemId: 11,
        isRefund: false,
        detailCount: 2,
        totalAmount: "0.03",
      },
      {
        orderFileId: 99,
        ruleItemId: 11,
        isRefund: true,
        detailCount: 1,
        totalAmount: "-5.00",
      },
      {
        orderFileId: 99,
        ruleItemId: 12,
        isRefund: false,
        detailCount: 1,
        totalAmount: "10.00",
      },
    ]);
  });

  it("does not include unmatched or pending-split details", () => {
    const accumulator: OrderRecognitionSummaryAccumulator = new Map();

    addOrderRecognitionSummaryDetail(accumulator, {
      matchStatus: "unmatched",
      ruleItemId: null,
      totalAmount: "2.00",
      refundAmountSnapshot: "0.00",
    });
    addOrderRecognitionSummaryDetail(accumulator, {
      matchStatus: "pending_split",
      ruleItemId: null,
      totalAmount: "3.00",
      refundAmountSnapshot: "0.00",
    });

    expect(serializeOrderRecognitionSummary(99, accumulator)).toEqual([]);
  });

  it("derives the complete fresh-file and recognizable group summaries", () => {
    const files = [
      {
        entryCount: 12,
        orderTotalAmount: "120.00",
        refundAmount: "15.00",
        matchedCount: 9,
        unmatchedCount: 1,
        pendingSplitCount: 2,
      },
      {
        entryCount: 3,
        orderTotalAmount: "30.00",
        refundAmount: "0.00",
        matchedCount: 3,
        unmatchedCount: 0,
        pendingSplitCount: 0,
      },
    ];
    const groups = [
      { ruleItemId: 11, isRefund: false, detailCount: 10, totalCents: 14_000 },
      { ruleItemId: 11, isRefund: true, detailCount: 1, totalCents: -1_500 },
      { ruleItemId: 12, isRefund: false, detailCount: 1, totalCents: 0 },
    ];

    expect(summarizeOrderRecognitionFiles(files)).toEqual({
      totalCents: 13_500,
      count: 15,
      matchedCount: 12,
      unmatchedCount: 1,
      pendingSplitCount: 2,
    });
    expect(summarizeOrderRecognitionGroups(groups)).toEqual({
      totalCents: 12_500,
      count: 12,
    });
    expect(deriveFreshOrderRecognitionPhaseSummaries(files, groups)).toEqual({
      fileSummary: {
        totalCents: 13_500,
        count: 15,
        matchedCount: 12,
        unmatchedCount: 1,
        pendingSplitCount: 2,
      },
      recognized: {
        totalCents: 12_500,
        count: 11,
      },
      open: {
        totalCents: 1_000,
        count: 4,
      },
    });
  });
});
