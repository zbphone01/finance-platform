import fs from "node:fs";
import { describe, expect, it } from "vitest";

const readLocalMigration = (path: string, ..._options: unknown[]) => fs.existsSync(path) ? fs.readFileSync(path, "utf8") : "";

const migration = readLocalMigration(
  "database/migrations/migrate-v10.79-keep-unrecognized-bill-details-hot.sql",
  "utf8",
);

describe.skipIf(!migration)("v10.79 unrecognized bill-details hot retention", () => {
  it("archives only recognized rows in bounded batches", () => {
    const batchSection = migration.slice(
      migration.indexOf("SET @select_archive_batch_sql"),
      migration.indexOf("SET @archive_batch_summary_sql"),
    );
    expect(batchSection).toContain("bd.match_result_id IS NOT NULL");
    expect(batchSection).toContain("LIMIT 50000 FOR UPDATE");
    expect(batchSection).not.toContain("NOT EXISTS");
  });

  it("keeps expired unrecognized rows in p_late without adding an index", () => {
    expect(migration).toContain("REORGANIZE PARTITION `p_late`, ");
    expect(migration).toContain("未认账行继续留在热表");
    expect(migration).not.toMatch(/\bADD\s+(?:UNIQUE\s+)?(?:KEY|INDEX)\b/i);
    expect(migration).not.toMatch(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i);
  });

  it("does not let retained rows block later recognized dates", () => {
    const dailyProcedure = migration.slice(
      migration.indexOf("CREATE PROCEDURE archive_bill_details_daily"),
    );
    expect(dailyProcedure).toContain("SELECT MIN(bd.partition_date)");
    expect(dailyProcedure).toContain("bd.match_result_id IS NOT NULL");
    expect(dailyProcedure).toContain("processed_date_count >= 31");
  });

  it("leaves unmatched-package rows and historical archives untouched", () => {
    expect(migration).toContain("target_date < '1970-01-02'");
    expect(migration).not.toMatch(
      /INSERT\s+INTO\s+bill_details\s+SELECT[\s\S]*bill_details_archive_/i,
    );
  });
});
