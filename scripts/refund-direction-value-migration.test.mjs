import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

const readLocalMigration = (path) => existsSync(path) ? readFileSync(path, "utf8") : "";
const migrationTest = (name, fn) => test(name, { skip: !migration && "本地迁移目录未提供" }, fn);

const migration = readLocalMigration("database/migrations/migrate-v10.78-refund-direction-value.sql", "utf8");
const schema = readFileSync("database/init-fresh-schema-v10.85.sql", "utf8");

migrationTest("v10.78 先恢复退款单值，再新增收支方向单值并删除 JSON", () => {
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
