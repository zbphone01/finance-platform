import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("migrate-v10.74-rule-exclude-conditions.sql", "utf8");
const deployScript = readFileSync("deploy-update-optimized.sh", "utf8");

test("v10.74 迁移只新增排除条件表并保留旧字段", () => {
  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS `recognition_rule_exclude_conditions`/,
  );
  assert.match(migration, /FOREIGN KEY \(`rule_id`\)[\s\S]*ON DELETE CASCADE/);
  assert.match(migration, /enum\('等于','包含'\)/);
  assert.doesNotMatch(migration, /(?:ALTER|DROP|TRUNCATE)\s+TABLE/i);
});

test("旧单条件按等于方式幂等回填", () => {
  assert.match(migration, /INSERT INTO `recognition_rule_exclude_conditions`/);
  assert.match(migration, /rr\.`exclude_order_field`, '等于', rr\.`exclude_order_keyword`/);
  assert.match(migration, /NOT EXISTS[\s\S]*existing\.`rule_id` = rr\.`id`/);
});

test("部署脚本在显式迁移和普通部署中校验 v10.74", () => {
  assert.match(deployScript, /check_v1074_rule_exclude_database\(\)/);
  assert.match(
    deployScript,
    /check_v1074_rule_exclude_database "\$APP_DIR" "verify"/,
  );
  assert.match(
    deployScript,
    /check_v1074_rule_exclude_database "\$STAGE_DIR" "verify"/,
  );
  assert.match(deployScript, /migrate-v10\.74-rule-exclude-conditions\.sql/);
});
