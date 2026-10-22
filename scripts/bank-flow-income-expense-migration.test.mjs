import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("migrate-v10.75-bank-flow-income-expense-view.sql", "utf8");
const schema = readFileSync("database/init-fresh-schema-v9.78.sql", "utf8");
const deployScript = readFileSync("deploy-update-optimized.sh", "utf8");
const summarySource = readFileSync("api/lib/recognitionDateSummary.ts", "utf8");

test("v10.75 迁移新增收入总额缓存并回填纯支出任务", () => {
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

test("部署脚本校验 v10.75 收入汇总、纯支出状态和迁移顺序", () => {
  assert.match(deployScript, /check_v1075_bank_flow_income_database\(\)/);
  assert.match(deployScript, /bank_flow_income_total AS DECIMAL\(18,2\)/);
  assert.match(deployScript, /countMismatchCount/);
  assert.match(deployScript, /pureExpensePendingCount/);
  assert.match(
    deployScript,
    /check_v1074_rule_exclude_database "\$APP_DIR" "verify"[\s\S]*check_v1075_bank_flow_income_database "\$APP_DIR" "migrate"/,
  );
  assert.match(
    deployScript,
    /check_v1075_bank_flow_income_database "\$STAGE_DIR" "verify"/,
  );
});
