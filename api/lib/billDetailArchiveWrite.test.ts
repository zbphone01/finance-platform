import { describe, expect, it } from "vitest";
import {
  BILL_DETAIL_COLUMN_NAMES,
  isBillDetailArchiveTableName,
  listArchivedRecognitionPartitionDates,
  listBillDetailArchiveTableNames,
  restoreArchivedDetailToHotTable,
  restoreArchivedRecognitionDetailsToHotTable,
} from "./billDetailArchiveWrite";

describe("bill detail archive write helpers", () => {
  it("keeps invoice order values in the explicit archive/restore column order", () => {
    const billNoIndex = BILL_DETAIL_COLUMN_NAMES.indexOf("bill_no");
    expect(BILL_DETAIL_COLUMN_NAMES.slice(billNoIndex, billNoIndex + 4)).toEqual([
      "bill_no",
      "invoice_other_order_no_1",
      "invoice_other_order_no_2",
      "bill_date",
    ]);
  });

  it("accepts only monthly bill detail archive table names", () => {
    expect(isBillDetailArchiveTableName("bill_details_archive_202605")).toBe(true);
    expect(isBillDetailArchiveTableName("bill_details_archive_20265")).toBe(false);
    expect(isBillDetailArchiveTableName("bill_details_archive_202605_backup")).toBe(false);
    expect(isBillDetailArchiveTableName("bill_details; DROP TABLE users")).toBe(false);
  });

  it("filters unexpected information-schema rows", async () => {
    const db = {
      execute: async () => [[
        { tableName: "bill_details_archive_202604" },
        { tableName: "bill_details_archive_202605" },
        { tableName: "bill_details_archive_202605_backup" },
      ]],
    };
    await expect(listBillDetailArchiveTableNames(db)).resolves.toEqual([
      "bill_details_archive_202604",
      "bill_details_archive_202605",
    ]);
  });

  it("collects unique archive dates for recognition results", async () => {
    const db = {
      execute: async () => [[
        { id: 10, partitionDate: "2026-04-01" },
        { id: 10, partitionDate: "2026-04-01" },
        { id: 10, partitionDate: "invalid" },
      ]],
    };
    await expect(listArchivedRecognitionPartitionDates(
      db,
      ["bill_details_archive_202604"],
      [12, 13],
    )).resolves.toEqual(["2026-04-01"]);
  });

  it("restores and removes only archived rows linked to target results", async () => {
    const calls: unknown[] = [];
    const db = {
      execute: async (query: unknown) => {
        calls.push(query);
        return [[]];
      },
    };
    await restoreArchivedRecognitionDetailsToHotTable(
      db,
      ["bill_details_archive_202604", "bill_details_archive_202604_backup"],
      [12, 13],
    );
    expect(calls).toHaveLength(4);
  });

  it("restores one archived detail before deleting its archive copy", async () => {
    const calls: unknown[] = [];
    const responses = [
      [[{ count: 1 }]],
      [[]],
      [[{ count: 1 }]],
      [[]],
    ];
    const db = {
      execute: async (query: unknown) => {
        calls.push(query);
        return responses.shift() || [[]];
      },
    };

    await expect(restoreArchivedDetailToHotTable(db, {
      detailId: 123,
      partitionDate: "2026-05-10",
    })).resolves.toBe(true);
    expect(calls).toHaveLength(4);
  });

  it("does not delete anything when the monthly archive table is absent", async () => {
    const calls: unknown[] = [];
    const db = {
      execute: async (query: unknown) => {
        calls.push(query);
        return [[{ count: 0 }]];
      },
    };

    await expect(restoreArchivedDetailToHotTable(db, {
      detailId: 123,
      partitionDate: "2026-05-10",
    })).resolves.toBe(false);
    expect(calls).toHaveLength(1);
  });
});
