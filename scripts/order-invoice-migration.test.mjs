import fs from "node:fs";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  "migrate-v10.71-order-invoice-fields.sql",
  "utf8",
);

describe("v10.71 order invoice migration", () => {
  it("adds direct invoice values and the file-level field snapshot without permanent indexes", () => {
    expect(migration).toContain(
      "ADD COLUMN invoice_other_order_no_1 VARCHAR(255) NULL DEFAULT NULL AFTER bill_no",
    );
    expect(migration).toContain(
      "ADD COLUMN invoice_other_order_no_2 VARCHAR(255) NULL DEFAULT NULL AFTER invoice_other_order_no_1",
    );
    expect(migration).toContain(
      "ADD COLUMN invoice_order_no_field_snapshot JSON NULL AFTER raw_columns",
    );
    expect(migration).not.toMatch(/\bADD\s+(?:UNIQUE\s+)?(?:KEY|INDEX)\b/i);
    expect(migration).not.toMatch(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i);
  });

  it("uses the Shanghai month boundary and 50000-row batches for recent history", () => {
    expect(migration).toContain(
      "DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'), '%Y-%m-01')",
    );
    expect(migration).toContain("INTERVAL 24 MONTH");
    expect(migration).toContain("detail.bill_date >= cutoff_date");
    expect(migration).toContain("detail.bill_date >= ?");
    expect(migration.match(/LIMIT 50000/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("copies snapshots before dropping the retired projection table at the end", () => {
    const snapshotUpdate = migration.indexOf("UPDATE order_files order_file");
    const backfill = migration.indexOf("CALL backfill_order_invoice_values_v1071()");
    const eventEnabled = migration.indexOf(
      "ALTER EVENT ev_bill_details_archive_old_daily_partitions ENABLE",
    );
    const dropProjection = migration.indexOf(
      "DROP TABLE invoice_recognized_projection_jobs",
    );

    expect(snapshotUpdate).toBeGreaterThan(-1);
    expect(backfill).toBeGreaterThan(snapshotUpdate);
    expect(eventEnabled).toBeGreaterThan(backfill);
    expect(dropProjection).toBeGreaterThan(eventEnabled);
  });

  it("archives with an explicit column list that includes both new values", () => {
    expect(migration).not.toContain("SELECT bd.*");
    expect(migration).toContain(
      "`split_source_detail_id`, `bill_no`, `invoice_other_order_no_1`,",
    );
    expect(migration).toContain(
      "bd.`invoice_other_order_no_1`, bd.`invoice_other_order_no_2`, bd.`bill_date`",
    );
  });
});
