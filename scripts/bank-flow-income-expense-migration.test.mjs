import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

const readLocalMigration = (path) => existsSync(path) ? readFileSync(path, "utf8") : "";
const migrationTest = (name, fn) => test(name, { skip: !migration && "本地迁移目录未提供" }, fn);

const migration = readLocalMigration("database/migrations/migrate-v10.75-bank-flow-income-expense-view.sql", "utf8");
const schema = readFileSync("database/init-fresh-schema-v10.85.sql", "utf8");
const summarySource = readFileSync("api/lib/recognitionDateSummary.ts", "utf8");

migrationTest("v10.75 迁移新增收入总额缓存并回填纯支出任务", () => {
  assert.match(
    migration,
    /ALTER TABLE recognition_date_summaries[\s\S]*ADD COLUMN bank_flow_income_total DECIMAL\(18,2\) NOT NULL DEFAULT 0\.00/,
  );
  assert.match(migration, /CREATE TEMPORARY TABLE tmp_v1075_task_flow_direction/);
  assert.match(migration, /SUM\(CASE WHEN bf\.income > 0 THEN bf\.income ELSE 0 END\)/);
  assert.match(migration, /COALESCE\(SUM\(tf\.income_flow_count\), 0\) AS bank_flow_count/);
  assert.match(migration, /rds\.bank_flow_count = refreshed\.bank_flow_count/);
  assert.match(
    migration,
    /UPDATE recognition_tasks rt[\s\S]*tf\.income_flow_count = 0[\s\S]*rt\.status = 'pending_details'/,
  );
  assert.match(schema, /`bank_flow_income_total` decimal\(18,2\) NOT NULL DEFAULT '0\.00'/);
  assert.match(
    summarySource,
    /bankFlowCount: Array\.from\(incomeFlowSummaryByTaskId\.values\(\)\)[\s\S]*reduce\(\(sum, item\) => sum \+ item\.count, 0\)/,
  );
});
