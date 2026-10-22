import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("migrate-v10.76-refund-judge-values.sql", "utf8");
const deployScript = readFileSync("deploy-update-optimized.sh", "utf8");

test("v10.76 迁移新增 JSON 多值字段并保留旧单值字段", () => {
  assert.match(
    migration,
    /ALTER TABLE recognition_rules[\s\S]*ADD COLUMN refund_judge_values JSON NULL AFTER refund_judge_value/,
  );
  assert.match(migration, /SET refund_judge_values = JSON_ARRAY\(refund_judge_value\)/);
  assert.doesNotMatch(migration, /DROP\s+COLUMN\s+refund_judge_value/i);
});

test("部署脚本检查多值数组数量、旧值回填和首值兼容快照", () => {
  assert.match(deployScript, /check_v1076_refund_judge_values_database\(\)/);
  assert.match(deployScript, /JSON_LENGTH\(refund_judge_values\) NOT BETWEEN 1 AND 3/);
  assert.match(deployScript, /missingBackfillCount/);
  assert.match(deployScript, /mismatchedSnapshotCount/);
  assert.match(
    deployScript,
    /check_v1076_refund_judge_values_database "\$APP_DIR" "migrate" "\$MIGRATION_FILE"/,
  );
  assert.match(
    deployScript,
    /check_v1076_refund_judge_values_database "\$APP_DIR" "verify"[\s\S]*check_v1077_recognized_flow_count_database "\$APP_DIR" "migrate"/,
  );
});
