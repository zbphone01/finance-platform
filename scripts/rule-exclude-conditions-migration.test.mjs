import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

const readLocalMigration = (path) => existsSync(path) ? readFileSync(path, "utf8") : "";
const migrationTest = (name, fn) => test(name, { skip: !migration && "本地迁移目录未提供" }, fn);

const migration = readLocalMigration("database/migrations/migrate-v10.74-rule-exclude-conditions.sql", "utf8");

migrationTest("v10.74 迁移只新增排除条件表并保留旧字段", () => {
  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS `recognition_rule_exclude_conditions`/,
  );
  assert.match(migration, /FOREIGN KEY \(`rule_id`\)[\s\S]*ON DELETE CASCADE/);
  assert.match(migration, /enum\('等于','包含'\)/);
  assert.doesNotMatch(migration, /(?:ALTER|DROP|TRUNCATE)\s+TABLE/i);
});

migrationTest("旧单条件按等于方式幂等回填", () => {
  assert.match(migration, /INSERT INTO `recognition_rule_exclude_conditions`/);
  assert.match(migration, /rr\.`exclude_order_field`, '等于', rr\.`exclude_order_keyword`/);
  assert.match(migration, /NOT EXISTS[\s\S]*existing\.`rule_id` = rr\.`id`/);
});
