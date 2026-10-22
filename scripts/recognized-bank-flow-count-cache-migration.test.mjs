import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

const readLocalMigration = (path) => existsSync(path) ? readFileSync(path, "utf8") : "";
const migrationTest = (name, fn) => test(name, { skip: !migration && "本地迁移目录未提供" }, fn);

const migration = readLocalMigration("database/migrations/migrate-v10.77-recognized-bank-flow-count-cache.sql", "utf8");
const schema = readFileSync("database/init-fresh-schema-v10.85.sql", "utf8");
const summarySource = readFileSync("api/lib/recognitionDateSummary.ts", "utf8");
const taskRouterSource = readFileSync("api/taskRouter.ts", "utf8");
const getByIdStart = taskRouterSource.indexOf("  getById: authedQuery");
const getByIdEnd = taskRouterSource.indexOf("  uploadBankFlowsAndCreateTasks:", getByIdStart);
const getByIdSource = taskRouterSource.slice(getByIdStart, getByIdEnd);

migrationTest("v10.77 迁移新增并回填已认账收入流水条数缓存", () => {
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
