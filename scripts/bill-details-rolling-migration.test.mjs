import fs from "node:fs";
import { describe, expect, it } from "vitest";

const readLocalMigration = (path, ..._options) => fs.existsSync(path) ? fs.readFileSync(path, "utf8") : "";

const migration = readLocalMigration(
  "database/migrations/migrate-v10.43-bill-details-rolling-hot-partitions.sql",
  "utf8",
);
const recognitionSummaryCleanupMigration = readLocalMigration(
  "database/migrations/migrate-v10.60-archive-order-recognition-summaries.sql",
  "utf8",
);
const recognitionSummaryDeltaMigration = readLocalMigration(
  "database/migrations/migrate-v10.60-order-recognition-summary-deltas.sql",
  "utf8",
);

describe.skipIf(!migration)("v10.43 rolling bill-details migration", () => {
  it("does not introduce a new index definition", () => {
    expect(migration).not.toMatch(/\bADD\s+(?:UNIQUE\s+)?(?:KEY|INDEX)\b/i);
    expect(migration).not.toMatch(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i);
  });

  it("archives full date batches without a recognized-only predicate", () => {
    const batchSection = migration.slice(
      migration.indexOf("SET @select_archive_batch_sql"),
      migration.indexOf("SET @archive_batch_summary_sql"),
    );
    expect(batchSection).toContain("WHERE partition_date = ?");
    expect(batchSection).not.toContain("match_result_id");
  });

  it("merges every cleared expired daily partition after p_late", () => {
    expect(migration).toContain("GROUP_CONCAT(");
    expect(migration).toContain("partition_name REGEXP '^p[0-9]{8}$'");
    expect(migration).toContain("REORGANIZE PARTITION `p_late`, ");
    expect(migration).toContain("expired_partition_list");
  });

  it("creates daily rolling and archive events", () => {
    expect(migration).toContain("CREATE EVENT ev_bill_details_rolling_partitions");
    expect(migration).toContain("CREATE EVENT ev_bill_details_archive_old_daily_partitions");
  });

  it("calculates event starts without collation-sensitive datetime IF expressions", () => {
    expect(migration).toContain("CAST('02:30:00' AS TIME)");
    expect(migration).toContain("CAST('03:10:00' AS TIME)");
    expect(migration).not.toContain("IF(\n  NOW() < @today_partition_event_at");
    expect(migration).not.toContain("IF(\n  NOW() < @this_day_archive_event_at");
  });
});

describe.skipIf(!migration)("v10.60 archived order recognition summary cleanup", () => {
  it("carries source and target delta keys through the locked archive batch", () => {
    expect(recognitionSummaryCleanupMigration).toContain(
      "(id, partition_date, order_file_id, task_id, rule_id, operation_status)",
    );
    expect(recognitionSummaryCleanupMigration).toContain(
      "SELECT id, partition_date, order_file_id, task_id, rule_id, operation_status",
    );
    expect(recognitionSummaryCleanupMigration).toContain(
      "KEY tmp_archive_order_file_idx (order_file_id)",
    );
    expect(recognitionSummaryCleanupMigration).toContain(
      "KEY tmp_archive_transfer_idx (task_id, rule_id, partition_date, operation_status)",
    );
  });

  it("invalidates and deletes upload summaries after archive verification but before commit", () => {
    const insertVerification = recognitionSummaryCleanupMigration.indexOf(
      "archive batch insert verification failed",
    );
    const deleteVerification = recognitionSummaryCleanupMigration.indexOf(
      "archive batch delete verification failed",
    );
    const invalidateSummary = recognitionSummaryCleanupMigration.indexOf(
      "SET archived_file.recognition_summary_valid = 0",
    );
    const deleteSummary = recognitionSummaryCleanupMigration.indexOf(
      "FROM order_file_recognition_summaries recognition_summary",
    );
    const deleteSourceDelta = recognitionSummaryCleanupMigration.indexOf(
      "FROM order_recognition_summary_deltas source_delta",
    );
    const deleteTargetDelta = recognitionSummaryCleanupMigration.indexOf(
      "FROM order_recognition_summary_deltas transfer_delta",
    );
    const commit = recognitionSummaryCleanupMigration.indexOf(
      "COMMIT;\n    SET archived_any_batch = 1",
    );

    expect(insertVerification).toBeGreaterThan(-1);
    expect(deleteVerification).toBeGreaterThan(insertVerification);
    expect(invalidateSummary).toBeGreaterThan(deleteVerification);
    expect(deleteSummary).toBeGreaterThan(invalidateSummary);
    expect(deleteSourceDelta).toBeGreaterThan(deleteSummary);
    expect(deleteTargetDelta).toBeGreaterThan(deleteSourceDelta);
    expect(commit).toBeGreaterThan(deleteTargetDelta);
  });

  it("keeps snapshot cleanup in the rollback-protected archive procedure", () => {
    const procedure = recognitionSummaryCleanupMigration.slice(
      recognitionSummaryCleanupMigration.indexOf(
        "CREATE PROCEDURE archive_bill_details_day",
      ),
    );
    expect(procedure).toContain("DECLARE EXIT HANDLER FOR SQLEXCEPTION");
    expect(procedure).toContain("ROLLBACK;");
    expect(procedure).toContain("RESIGNAL;");
    expect(procedure).not.toMatch(/\bADD\s+(?:UNIQUE\s+)?(?:KEY|INDEX)\b/i);
    expect(procedure).not.toMatch(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i);
  });
});

describe.skipIf(!migration)("v10.60 order recognition summary delta table", () => {
  it("stores source deductions and target transfer-ins in one grouped table", () => {
    expect(recognitionSummaryDeltaMigration).toContain(
      "delta_type ENUM('source_deduction', 'target_transfer_in')",
    );
    expect(recognitionSummaryDeltaMigration).toContain(
      "summary_kind ENUM('file_total', 'rule_item')",
    );
    expect(recognitionSummaryDeltaMigration).toContain(
      "KEY orsd_target_idx (delta_type, task_id, rule_id, partition_date)",
    );
  });

  it("does not scan or backfill historical bill details", () => {
    expect(recognitionSummaryDeltaMigration).not.toMatch(/\bINSERT\s+INTO\s+order_recognition_summary_deltas\s+SELECT\b/i);
    expect(recognitionSummaryDeltaMigration).not.toMatch(/\bUPDATE\s+bill_details\b/i);
  });
});
