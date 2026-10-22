import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const deployScript = readFileSync("deploy-update-optimized.sh", "utf8");
const databaseChecker = readFileSync("scripts/check-v10.85-rule-condition-editor-database.mjs", "utf8");
const deployDoc = readFileSync("docs/DEPLOY_v10.85-local.md", "utf8");
const financeReconSkill = readFileSync("docs/finance-recon-SKILL.md", "utf8");
const testServer1Key = "/home/deploy/Documents/测试服务器1密钥/codex.pem";

test("数据库检查与当前版本清单必须使用固定入口", () => {
  assert.match(deployScript, /--check-database/);
  assert.match(deployScript, /--check-and-migrate-database/);
  assert.match(deployScript, /DATABASE_ACTION="check"/);
  assert.match(deployScript, /DATABASE_ACTION="check-and-migrate"/);
  assert.match(databaseChecker, /new Set\(\["check", "probe", "verify"\]\)/);
  assert.match(deployScript, /CURRENT_RELEASE_VERSION="v10\.85"/);
  assert.match(deployScript, /CURRENT_RELEASE_BASELINE_VERSION="v10\.84"/);
  assert.match(deployScript, /CURRENT_RELEASE_MIGRATION_FILE=""/);
  assert.match(deployScript, /CURRENT_RELEASE_DATABASE_CHECKER="check_v1085_rule_condition_editor_database"/);
});

test("数据库控制入口拒绝额外参数和未知选项", () => {
  const extraAutoMigrationArgument = spawnSync(
    "bash",
    ["deploy-update-optimized.sh", "--check-and-migrate-database", "unexpected.sql"],
    { encoding: "utf8" },
  );
  assert.equal(extraAutoMigrationArgument.status, 2);
  assert.match(extraAutoMigrationArgument.stderr, /--check-and-migrate-database 不接受其他参数/);

  const unknownOption = spawnSync("bash", ["deploy-update-optimized.sh", "--unknown"], { encoding: "utf8" });
  assert.equal(unknownOption.status, 2);
  assert.match(unknownOption.stderr, /未知参数/);
});

test("v10.85 检查器只验证 v10.84 所需完成态且不执行 SQL", () => {
  assert.match(databaseChecker, /v10\.85 无 SQL 迁移/);
  assert.match(databaseChecker, /v10\.83 到账匹配条件唯一来源结构与数据完整性检查通过/);
  assert.match(databaseChecker, /v10\.85 无 SQL 迁移，不允许数据库操作/);
  assert.match(databaseChecker, /legacyColumnCount/);
  assert.match(databaseChecker, /cma_record_sort_uq/);
  assert.match(databaseChecker, /cma_record_fk/);
  assert.match(databaseChecker, /orphanChildren/);
  assert.match(databaseChecker, /emptyActiveMatchers/);
  assert.match(databaseChecker, /duplicateSortOrders/);
  assert.doesNotMatch(databaseChecker, /process\.exitCode = 10/);
  assert.doesNotMatch(databaseChecker, /ALTER\s+TABLE/i);
  assert.doesNotMatch(databaseChecker, /UPDATE\s+`?(?:bank_flows|counterparty_records|counterparty_match_accounts)/i);
});

test("数据库控制保留迁移保护但当前无迁移不会进入写路径", () => {
  assert.match(deployScript, /ensure_migration_processes_stopped/);
  assert.match(deployScript, /finance-platform ticket-platform/);
  assert.match(deployScript, /run_current_release_database_check "\$APP_DIR" "probe"/);
  assert.match(deployScript, /run_current_release_database_check "\$APP_DIR" "migrate"/);
  assert.match(deployScript, /else\n    probe_status="\$\?"\n  fi\n  if \[ "\$probe_status" -ne 10 \]/);
  assert.match(deployScript, /run_current_release_database_check[\s\S]*"\$STAGE_DIR"[\s\S]*"verify"/);
  assert.match(databaseChecker, /new Set\(\["check", "probe", "verify"\]\)/);
  assert.doesNotMatch(databaseChecker, /"migrate"/);
});

test("部署脚本只保留当前版本数据库检查器", () => {
  for (const legacyChecker of [
    "check_v1071_database",
    "check_v1072_invoice_only_database",
    "check_v1074_rule_exclude_database",
    "check_summary_cache_database",
    "check_v1075_bank_flow_income_database",
    "check_v1076_refund_judge_values_database",
    "check_v1077_recognized_flow_count_database",
    "check_v1078_refund_direction_database",
    "check_v1079_keep_unrecognized_database",
    "check_v1080_detail_split_order_dedup_database",
    "check_v1081_bank_flow_arrival_match_database",
    "check_v1082_bank_flow_display_database",
    "check_v1083_counterparty_match_accounts_database",
    "check_v1084_counterparty_match_accounts_database",
  ]) {
    assert.doesNotMatch(deployScript, new RegExp(legacyChecker));
  }
  assert.equal((deployScript.match(/check_v1085_rule_condition_editor_database/g) ?? []).length, 2);
  assert.match(deployScript, /scripts\/check-v10\.85-rule-condition-editor-database\.mjs/);
  assert.equal((deployScript.match(/check_runtime_dependencies "\$STAGE_DIR"/g) ?? []).length, 1);
  assert.equal((deployScript.match(/trap cleanup_stage EXIT/g) ?? []).length, 1);
  assert.equal((deployScript.match(/^pm2 status$/gm) ?? []).length, 1);
  assert.deepEqual(
    Array.from(deployScript.matchAll(/info "Step (\d)\/8:/g), (match) => Number(match[1])),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  assert.match(financeReconSkill, /必须以当前 `deploy-update-optimized\.sh` 为固定基线做最小版本替换/);
  assert.match(financeReconSkill, /主流程固定保持 8 个阶段及顺序/);
});

test("部署脚本区分 PM2 应用存在与原运行状态", () => {
  assert.match(deployScript, /APP_EXISTS=0\nAPP_WAS_RUNNING=0/);
  assert.match(deployScript, /APP_PIDS="\$\(pm2 pid "\$PM2_NAME"/);
  assert.match(deployScript, /if \[ "\$APP_WAS_RUNNING" -eq 1 \]; then\n  pm2 stop "\$PM2_NAME"/);
  assert.match(deployScript, /if \[ "\$APP_EXISTS" -eq 1 \] && \[ "\$APP_WAS_RUNNING" -eq 1 \]; then[\s\S]*pm2 restart/);
  assert.match(deployScript, /if \[ "\$APP_EXISTS" -eq 1 \]; then\n  NODE_ENV=production PORT="\$APP_PORT" pm2 restart/);
});

test("两台服务器部署文档使用无迁移版本的统一检查入口", () => {
  assert.equal((deployDoc.match(/--check-and-migrate-database/g) ?? []).length, 2);
  assert.doesNotMatch(deployDoc, /--migrate-database/);
  assert.doesNotMatch(deployDoc, /node --input-type=module/);
  assert.doesNotMatch(deployDoc, /mysql\s+.*-p/);
  assert.equal((deployDoc.match(/^### 3\. 检查并迁移$/gm) ?? []).length, 2);
  assert.equal((deployDoc.match(/本版无 SQL 迁移/g) ?? []).length, 3);
  assert.doesNotMatch(deployDoc, /migrate-v10\.85/);
  assert.doesNotMatch(deployDoc, /pm2 stop/);
  assert.doesNotMatch(deployDoc, /db:events:ensure -- --check-only/);
  assert.doesNotMatch(deployDoc, /127\.0\.0\.1:3001/);
  assert.equal((deployDoc.match(/^pm2 status$/gm) ?? []).length, 4);
  assert.equal((deployDoc.match(/http:\/\/server2\.example\.com:3001\//g) ?? []).length, 1);
});

test("默认部署包更新为 v10.85 并明确 v10.84 基线", () => {
  assert.match(deployScript, /TAR_INPUT="\$\{1:-finance-platform-v10\.85-local\.tar\.gz\}"/);
  assert.match(deployDoc, /上一实际部署包 `v10\.84-local`/);
  assert.match(deployDoc, /finance-platform-v10\.85-local\.tar\.gz/);
});

test("测试服务器1上传和登录固定使用当前密钥", () => {
  assert.equal(deployDoc.split(`TEST_SERVER1_KEY="${testServer1Key}"`).length - 1, 2);
  assert.equal(deployDoc.split('chmod 600 "$TEST_SERVER1_KEY"').length - 1, 2);
  assert.match(deployDoc, /scp -i "\$TEST_SERVER1_KEY"/);
  assert.match(deployDoc, /ssh -i "\$TEST_SERVER1_KEY" ubuntu@server1\.example\.com/);
  assert.doesNotMatch(deployDoc, /Desktop\/资金池测试文件1\/测试服务器1密钥/);
  assert.match(financeReconSkill, new RegExp(testServer1Key));
  assert.match(financeReconSkill, /“上传”步骤必须定义 `TEST_SERVER1_KEY`/);
  assert.match(financeReconSkill, /“登录”步骤必须再次完整定义和检查该密钥/);
});
