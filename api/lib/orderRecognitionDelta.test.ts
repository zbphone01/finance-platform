import { describe, expect, it } from "vitest";
import {
  aggregateRecognitionSummaryDeltaRows,
  buildRecognitionSummaryDeltaRows,
  subtractRecognitionSummaryDeltaGroups,
} from "./orderRecognitionDelta";

const activeDetail = {
  taskId: 10,
  ruleId: 20,
  orderFileId: 30,
  partitionDate: "2026-06-11",
  detailSplitFileId: null,
  operationStatus: "active",
  matchResultId: null,
  matchStatus: "matched",
  ruleItemId: 40,
  totalAmount: "12.34",
  refundAmountSnapshot: "0.00",
  orderFileUploadStatus: "completed",
  detailPackageType: "T+1",
  recognitionSummaryValid: true,
};

describe("order recognition summary deltas", () => {
  it("turns removal from a valid source file into positive deduction rows", () => {
    expect(buildRecognitionSummaryDeltaRows(activeDetail, -1)).toEqual([
      expect.objectContaining({
        deltaType: "source_deduction",
        summaryKind: "file_total",
        detailCount: 1,
        totalCents: 1234,
      }),
      expect.objectContaining({
        deltaType: "source_deduction",
        summaryKind: "rule_item",
        ruleItemId: 40,
        isRefund: false,
        detailCount: 1,
        totalCents: 1234,
      }),
    ]);
  });

  it("turns a transferred refund into target file and refund-group additions", () => {
    expect(buildRecognitionSummaryDeltaRows({
      ...activeDetail,
      taskId: 11,
      partitionDate: "2026-06-12",
      operationStatus: "transferred",
      totalAmount: "-5.00",
      refundAmountSnapshot: "5.00",
    }, 1)).toEqual([
      expect.objectContaining({
        deltaType: "target_transfer_in",
        summaryKind: "file_total",
        detailCount: 1,
        totalCents: -500,
      }),
      expect.objectContaining({
        deltaType: "target_transfer_in",
        summaryKind: "rule_item",
        isRefund: true,
        detailCount: 1,
        totalCents: -500,
      }),
    ]);
  });

  it("does not create source deltas for an already invalid upload snapshot", () => {
    expect(buildRecognitionSummaryDeltaRows({
      ...activeDetail,
      recognitionSummaryValid: false,
    }, -1)).toEqual([]);
  });

  it("aggregates total and rule-item delta rows separately", () => {
    const result = aggregateRecognitionSummaryDeltaRows([
      { summaryKind: "file_total", ruleItemId: 0, isRefund: 0, detailCount: 2, totalAmount: "15.00" },
      { summaryKind: "rule_item", ruleItemId: 40, isRefund: 0, detailCount: 1, totalAmount: "20.00" },
      { summaryKind: "rule_item", ruleItemId: 40, isRefund: 1, detailCount: 1, totalAmount: "-5.00" },
    ]);
    expect(result.count).toBe(2);
    expect(result.totalCents).toBe(1500);
    expect(Array.from(result.groups.values())).toEqual([
      { ruleItemId: 40, isRefund: false, detailCount: 1, totalCents: 2000 },
      { ruleItemId: 40, isRefund: true, detailCount: 1, totalCents: -500 },
    ]);
  });

  it("subtracts grouped deductions and rejects groups missing from the upload snapshot", () => {
    const base = new Map([
      ["40|0", { ruleItemId: 40, isRefund: false, detailCount: 3, totalCents: 3000 }],
    ]);
    const deductions = new Map([
      ["40|0", { ruleItemId: 40, isRefund: false, detailCount: 1, totalCents: 1000 }],
    ]);
    expect(Array.from(subtractRecognitionSummaryDeltaGroups(base, deductions)!.values())).toEqual([
      { ruleItemId: 40, isRefund: false, detailCount: 2, totalCents: 2000 },
    ]);
    expect(subtractRecognitionSummaryDeltaGroups(base, new Map([
      ["41|0", { ruleItemId: 41, isRefund: false, detailCount: 1, totalCents: 100 }],
    ]))).toBeNull();
    expect(subtractRecognitionSummaryDeltaGroups(base, new Map([
      ["40|0", { ruleItemId: 40, isRefund: false, detailCount: 3, totalCents: 2999 }],
    ]))).toBeNull();
  });
});
