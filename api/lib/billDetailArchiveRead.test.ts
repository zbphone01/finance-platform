import { describe, expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  getBillDetailForManualRecognition,
  hasArchivedDetailSplitFileRows,
  hasArchivedOrderPackage,
  listDetailSplitFileBillDetails,
  listTaskDateBillDetails,
} from "./billDetailArchiveRead";

const input = {
  partitionDate: "2026-05-10",
  packageBillDate: "2026-05-09",
  detailPackageType: "T+1" as const,
  ruleId: 20,
};

describe("archived order package existence", () => {
  it("returns false when the date has no completed archive", async () => {
    const db = { execute: async () => [[]] };
    await expect(hasArchivedOrderPackage(db, input)).resolves.toBe(false);
  });

  it("returns true when the same date, rule and package type exists", async () => {
    const responses = [
      [[{ archiveTable: "bill_details_archive_202605" }]],
      [[{ packageExists: 1 }]],
    ];
    const db = { execute: async () => responses.shift() || [[]] };
    await expect(hasArchivedOrderPackage(db, input)).resolves.toBe(true);
  });

  it("returns false when the archive table contains no matching package", async () => {
    const responses = [
      [[{ archiveTable: "bill_details_archive_202605" }]],
      [[]],
      [[]],
    ];
    const db = { execute: async () => responses.shift() || [[]] };
    await expect(hasArchivedOrderPackage(db, input)).resolves.toBe(false);
  });

  it("supports historical source rows whose rule id only exists on the order file", async () => {
    const responses = [
      [[{ archiveTable: "bill_details_archive_202605" }]],
      [[]],
      [[{ packageExists: 1 }]],
    ];
    const db = { execute: async () => responses.shift() || [[]] };
    await expect(hasArchivedOrderPackage(db, input)).resolves.toBe(true);
  });
});

describe("task date order detail scope", () => {
  const dialect = new MySqlDialect();

  async function captureItemQuery(status?: "recognized" | "unrecognized" | "unrecognized_all" | "pending_split" | "transferred_in") {
    const statements: string[] = [];
    const db = {
      execute: async (query: any) => {
        statements.push(dialect.sqlToQuery(query).sql);
        return [[]];
      },
    };
    await listTaskDateBillDetails(db, {
      summaryDate: "2026-05-10",
      orderDate: "2026-05-09",
      detailPackageType: "T+1",
      targetRuleIds: [20],
      status,
      page: 1,
      pageSize: 20,
    });
    return statements[1];
  }

  it("excludes ignored details and includes transferred details by target partition", async () => {
    const query = await captureItemQuery();
    expect(query).toContain("COALESCE(bd.operation_status, 'active') <> 'ignored'");
    expect(query).toContain("(bd.bill_date = ? OR bd.operation_status = 'transferred')");
  });

  it("includes unrecognized transferred details in the unrecognized scope", async () => {
    const query = await captureItemQuery("unrecognized_all");
    expect(query).toContain("COALESCE(bd.operation_status, 'active') IN ('active', 'transferred')");
  });

  it("filters all details transferred into the target date partition", async () => {
    const query = await captureItemQuery("transferred_in");
    expect(query).toContain("bd.partition_date = ?");
    expect(query).toContain("bd.operation_status = 'transferred'");
    expect(query).not.toContain("bd.match_result_id IS NULL AND bd.operation_status = 'transferred'");
  });
});

describe("manual recognition detail routing", () => {
  it("falls back to the monthly archive and marks the row archived", async () => {
    const responses = [
      [[{ archiveTable: "bill_details_archive_202605" }]],
      [[]],
      [[{
        id: 123,
        partitionDate: "2026-05-10",
        totalAmount: "88.00",
        matchResultId: null,
      }]],
    ];
    const db = { execute: async () => responses.shift() || [[]] };

    await expect(getBillDetailForManualRecognition(db, {
      detailId: 123,
      partitionDate: "2026-05-10",
    })).resolves.toMatchObject({
      id: 123,
      partitionDate: "2026-05-10",
      archived: true,
    });
  });
});

describe("detail-split archive routing", () => {
  it("keeps archived split rows visible in the batch detail page", async () => {
    const responses = [
      [[{ tableName: "bill_details_archive_202605" }]],
      [[]],
      [[{ detailCount: 0 }]],
      [[{ id: 456, partitionDate: "2026-05-10", matchResultId: null }]],
      [[{ detailCount: 1 }]],
    ];
    const db = { execute: async () => responses.shift() || [[]] };

    await expect(listDetailSplitFileBillDetails(db, {
      detailSplitFileId: 9,
      matchStatus: "unrecognized",
      page: 1,
      pageSize: 100,
    })).resolves.toMatchObject({
      items: [{ id: 456, archived: true }],
      total: 1,
    });
  });

  it("detects archived split rows before destructive batch operations", async () => {
    const responses = [
      [[{ tableName: "bill_details_archive_202605" }]],
      [[{ rowExists: 1 }]],
    ];
    const db = { execute: async () => responses.shift() || [[]] };
    await expect(hasArchivedDetailSplitFileRows(db, 9)).resolves.toBe(true);
  });
});
