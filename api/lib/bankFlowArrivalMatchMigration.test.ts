import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("migrate-v10.81-bank-flow-arrival-match.sql", "utf8");

describe("bank flow arrival match migration", () => {
  it("adds only the persisted counterparty id and match status", () => {
    expect(migration).toMatch(/ADD COLUMN `matched_counterparty_id` BIGINT UNSIGNED NULL/);
    expect(migration).toMatch(/ADD COLUMN `arrival_match_status` ENUM\('unmatched','matched','cancelled'\) NOT NULL DEFAULT 'unmatched'/);
    expect(migration).not.toMatch(/alias_snapshot|recognition_type_snapshot|matched_at/i);
  });

  it("does not add another bank flow index", () => {
    expect(migration).not.toMatch(/\bADD\s+(?:UNIQUE\s+)?(?:KEY|INDEX)\b/i);
    expect(migration).not.toMatch(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\b/i);
  });

  it("only backfills from reliable persisted relationships", () => {
    expect(migration).toMatch(/income_recognition_rules/);
    expect(migration).toMatch(/same_day_counterparty_id/);
    expect(migration).toMatch(/recognition_rules/);
    expect(migration).not.toMatch(/counterparty_match_accounts/);
  });
});
