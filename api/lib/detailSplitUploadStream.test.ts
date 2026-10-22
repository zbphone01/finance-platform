import { drizzle } from "drizzle-orm/mysql2";
import { describe, expect, it } from "vitest";
import { billDetails } from "@db/schema";
import {
  buildDetailSplitBillNo,
  DETAIL_SPLIT_INSERT_BATCH_SIZE,
  insertDetailSplitRowsInBatches,
  isSuccessfulDetailSplitStatus,
  normalizeDetailSplitOrderNo,
  selectDetailSplitDedupWinners,
} from "./detailSplitUploadStream";

describe("isSuccessfulDetailSplitStatus", () => {
  it("only accepts the exact successful transaction status after cell cleanup", () => {
    expect(isSuccessfulDetailSplitStatus("交易成功")).toBe(true);
    expect(isSuccessfulDetailSplitStatus(" 交易成功 ")).toBe(true);
    expect(isSuccessfulDetailSplitStatus("'交易成功'")).toBe(true);
    expect(isSuccessfulDetailSplitStatus("交易关闭")).toBe(false);
    expect(isSuccessfulDetailSplitStatus("成功")).toBe(false);
    expect(isSuccessfulDetailSplitStatus("")).toBe(false);
  });
});

describe("insertDetailSplitRowsInBatches", () => {
  it("builds a 14135-row detail split insert without overflowing the Drizzle query stack", async () => {
    const db = drizzle.mock({ mode: "planetscale" });
    const rows = Array.from({ length: 14135 }, (_, index) => ({
      taskId: 0,
      ruleId: 27,
      orderFileId: null,
      detailSplitFileId: 1,
      splitSourceDetailId: null,
      billDate: "1970-01-01",
      partitionDate: "1970-01-01",
      lifecycleStatus: "unmatched_package" as const,
      billNo: `SPLIT-1-${index + 2}`,
      description: "测试商品",
      totalAmount: "1.00",
      rawData: { 主订单编号: String(index + 1) },
      matchStatus: "matched" as const,
      ruleItemId: 1,
    }));
    const batchSizes: number[] = [];

    await insertDetailSplitRowsInBatches(rows, async (batch) => {
      batchSizes.push(batch.length);
      expect(() => db.insert(billDetails).values(batch).toSQL()).not.toThrow();
    });

    expect(DETAIL_SPLIT_INSERT_BATCH_SIZE).toBe(5000);
    expect(batchSizes).toEqual([5000, 5000, 4135]);
    expect(batchSizes.reduce((total, size) => total + size, 0)).toBe(rows.length);
  });
});

describe("detail split child order dedup", () => {
  it("uses the package id and original file line as bill_no", () => {
    expect(buildDetailSplitBillNo(15, 238)).toBe("SPLIT-15-238");
  });

  it("normalizes whitespace, quotes and letter case without changing leading zeroes", () => {
    expect(normalizeDetailSplitOrderNo(" ' 001234-ab c ' ")).toBe("001234-ABC");
  });

  it("keeps only the first row that owns the rule-scoped dedup key", () => {
    const candidates = [
      { normalizedOrderNo: "A-1", lineNumber: 2 },
      { normalizedOrderNo: "A-1", lineNumber: 3 },
      { normalizedOrderNo: "B-1", lineNumber: 4 },
      { normalizedOrderNo: "C-1", lineNumber: 5 },
    ];
    expect(selectDetailSplitDedupWinners(candidates, [
      { normalizedOrderNo: "A-1", detailSplitFileId: 15, sourceLineNumber: 2 },
      { normalizedOrderNo: "B-1", detailSplitFileId: 14, sourceLineNumber: 8 },
      { normalizedOrderNo: "C-1", detailSplitFileId: 15, sourceLineNumber: 5 },
    ], 15)).toEqual([
      { normalizedOrderNo: "A-1", lineNumber: 2 },
      { normalizedOrderNo: "C-1", lineNumber: 5 },
    ]);
  });
});
