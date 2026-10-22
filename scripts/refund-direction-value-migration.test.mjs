import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("migrate-v10.78-refund-direction-value.sql", "utf8");
const schema = readFileSync("database/init-fresh-schema-v9.78.sql", "utf8");
const deployScript = readFileSync("deploy-update-optimized.sh", "utf8");

test("v10.78 先恢复退款单值，再新增收支方向单值并删除 JSON", () => {
  const restoreIndex = migration.indexOf("SET refund_judge_value");
  const dropIndex = migration.indexOf("DROP COLUMN refund_judge_values");
  assert.ok(restoreIndex >= 0 && dropIndex > restoreIndex);
  assert.match(migration, /JSON_EXTRACT\(refund_judge_values, '\$\[0\]'\)/);
  assert.match(migration, /JSON_LENGTH\(refund_judge_values\) = 1/);
  assert.match(migration, /ADD COLUMN refund_direction_judge_value VARCHAR\(500\) NULL AFTER refund_judge_value/);
  assert.doesNotMatch(migration, /DROP\s+COLUMN\s+refund_judge_value\b/i);
});

test("新建库只保留两个单值字段", () => {
  assert.match(
    schema,
    /`refund_judge_value` varchar\(500\)[\s\S]*`refund_direction_judge_value` varchar\(500\)/,
  );
  assert.doesNotMatch(schema, /`refund_judge_values` json/);
});

test("部署守卫拒绝多值数组，并在当前部署中验证 v10.78", () => {
  assert.match(deployScript, /check_v1078_refund_direction_database\(\)/);
  assert.match(deployScript, /JSON_LENGTH\(refund_judge_values\) > 1/);
  assert.match(deployScript, /multiValueCount/);
  assert.match(
    deployScript,
    /check_v1077_recognized_flow_count_database "\$APP_DIR" "verify"[\s\S]*check_v1078_refund_direction_database "\$APP_DIR" "migrate"/,
  );
  assert.match(
    deployScript,
    /check_v1078_refund_direction_database "\$STAGE_DIR" "verify"/,
  );
});
