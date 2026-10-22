import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("migrate-v10.80-detail-split-order-dedup.sql", "utf8");

describe("detail split order dedup migration", () => {
  it("adds the rule field, file snapshot, duplicate count and rule-scoped unique key", () => {
    expect(migration).toMatch(/detail_split_order_no_field/);
    expect(migration).toMatch(/order_no_field/);
    expect(migration).toMatch(/duplicate_count/);
    expect(migration).toMatch(/CREATE TABLE `detail_split_order_dedup_keys`/);
    expect(migration).toMatch(/PRIMARY KEY \(`rule_id`, `normalized_order_no`\)/);
  });

  it("releases dedup keys only when the detail split package is deleted", () => {
    expect(migration).toMatch(/FOREIGN KEY \(`detail_split_file_id`\)[\s\S]*REFERENCES `detail_split_files` \(`id`\) ON DELETE CASCADE/);
    expect(migration).not.toMatch(/INSERT INTO `detail_split_order_dedup_keys`/);
  });
});
