import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

const readLocalMigration = (path) => existsSync(path) ? readFileSync(path, "utf8") : "";
const migrationTest = (name, fn) => test(name, { skip: !migration && "本地迁移目录未提供" }, fn);

const migration = readLocalMigration("database/migrations/migrate-v10.76-refund-judge-values.sql", "utf8");

migrationTest("v10.76 迁移新增 JSON 多值字段并保留旧单值字段", () => {
  assert.match(
    migration,
    /ALTER TABLE recognition_rules[\s\S]*ADD COLUMN refund_judge_values JSON NULL AFTER refund_judge_value/,
  );
  assert.match(migration, /SET refund_judge_values = JSON_ARRAY\(refund_judge_value\)/);
  assert.doesNotMatch(migration, /DROP\s+COLUMN\s+refund_judge_value/i);
});
