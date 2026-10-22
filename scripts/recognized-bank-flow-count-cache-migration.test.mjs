import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("migrate-v10.77-recognized-bank-flow-count-cache.sql", "utf8");
const schema = readFileSync("database/init-fresh-schema-v9.78.sql", "utf8");
const summarySource = readFileSync("api/lib/recognitionDateSummary.ts", "utf8");
const taskRouterSource = readFileSync("api/taskRouter.ts", "utf8");
const deployScript = readFileSync("deploy-update-optimized.sh", "utf8");
const getByIdStart = taskRouterSource.indexOf("  getById: authedQuery");
const getByIdEnd = taskRouterSource.indexOf("  uploadBankFlowsAndCreateTasks:", getByIdStart);
const getByIdSource = taskRouterSource.slice(getByIdStart, getByIdEnd);

test("v10.77 迁移新增并回填已认账收入流水条数缓存", () => {
  assert.match(
    migration,
    /ALTER TABLE recognition_date_summaries[\s\S]*ADD COLUMN recognized_bank_flow_count INT NOT NULL DEFAULT 0[\s\S]*AFTER bank_flow_count/,
  );
  assert.match(
    migration,
    /bf\.income > 0 AND bf\.recognition_status = 'recognized'/,
  );
  assert.match(
    migration,
    /rds\.recognized_bank_flow_count = COALESCE\(refreshed\.recognized_bank_flow_count, 0\)/,
  );
  assert.match(
    schema,
    /`bank_flow_count` int NOT NULL DEFAULT '0',[\s\S]*`recognized_bank_flow_count` int NOT NULL DEFAULT '0'/,
  );
});

test("日期汇总刷新使用现有收入流水聚合维护缓存条数", () => {
  assert.match(
    summarySource,
    /recognizedCount: sql<number>`SUM\(CASE WHEN \$\{bankFlows\.recognitionStatus\} = 'recognized' THEN 1 ELSE 0 END\)`/,
  );
  assert.match(summarySource, /recognizedBankFlowCount,[\s\S]*billDetailTotal/);
  assert.match(
    summarySource,
    /bankFlowCount: values\.bankFlowCount,[\s\S]*recognizedBankFlowCount: values\.recognizedBankFlowCount/,
  );
});

test("getById 只读取日期汇总缓存并不再现算已认账流水数", () => {
  assert.notEqual(getByIdStart, -1);
  assert.notEqual(getByIdEnd, -1);
  assert.match(getByIdSource, /getRecognitionDateSummaryByBillDate\(task\.billDate\)/);
  assert.match(
    getByIdSource,
    /recognizedBankFlowCount: Number\(summary\?\.recognizedBankFlowCount \?\? 0\)/,
  );
  assert.doesNotMatch(getByIdSource, /getFreshRecognitionDateSummaryByBillDate/);
  assert.doesNotMatch(getByIdSource, /\.from\(bankFlows\)/);
  assert.doesNotMatch(getByIdSource, /refreshRecognitionDateSummary/);
});

test("部署脚本校验 v10.77 字段、回填与前置迁移", () => {
  assert.match(deployScript, /check_v1077_recognized_flow_count_database\(\)/);
  assert.match(deployScript, /recognized_bank_flow_count <> COALESCE\(expected\.expectedCount, 0\)/);
  assert.match(
    deployScript,
    /check_v1076_refund_judge_values_database "\$APP_DIR" "verify"[\s\S]*check_v1077_recognized_flow_count_database "\$APP_DIR" "migrate"/,
  );
  assert.match(
    deployScript,
    /check_v1077_recognized_flow_count_database "\$STAGE_DIR" "verify"/,
  );
});
