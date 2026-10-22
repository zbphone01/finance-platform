import { readFileSync } from "node:fs";
import { parse as parseEnv } from "dotenv";
import mysql from "mysql2/promise";

const action = process.env.DATABASE_CONTROL_ACTION || "check";

let fileEnv = {};
try {
  fileEnv = parseEnv(readFileSync(".env"));
} catch (error) {
  console.error(`❌ 无法读取 .env：${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

const rawUrl = String(fileEnv.DATABASE_URL || "").trim();
if (!rawUrl) {
  console.error("❌ .env 缺少 DATABASE_URL，禁止部署。");
  process.exit(1);
}

function redactError(error) {
  let message = error instanceof Error ? error.message : String(error);
  message = message.split(rawUrl).join("[已隐藏连接信息]");
  return message.replace(/mysql(?:2)?:\/\/[^@\s]+@/g, "mysql://***@");
}

function parseDatabaseUrl(value) {
  let parsed;
  try {
    parsed = new URL(value.replace(/^mysql2:/, "mysql:"));
  } catch {
    throw new Error("DATABASE_URL 不是有效的数据库连接地址");
  }
  if (parsed.protocol !== "mysql:") throw new Error("DATABASE_URL 必须使用 mysql:// 或 mysql2:// 协议");
  return {
    username: decodeURIComponent(parsed.username),
    databaseName: decodeURIComponent(parsed.pathname.replace(/^\/+/, "")),
  };
}

async function inspectState(connection) {
  const [objectRows] = await connection.query(
    `SELECT
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'recognition_date_summaries' AND column_name = 'recognized_bank_flow_count' AND data_type = 'int' AND is_nullable = 'NO' AND column_default = '0') AS summaryField,
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'recognition_rules' AND column_name = 'detail_split_order_no_field') AS ruleField,
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'detail_split_files' AND column_name = 'order_no_field') AS fileField,
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'detail_split_files' AND column_name = 'duplicate_count') AS duplicateField,
       EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'detail_split_order_dedup_keys') AS dedupTable`,
  );
  const objects = objectRows[0] || {};
  const prerequisiteComplete = [
    objects.summaryField,
    objects.ruleField,
    objects.fileField,
    objects.duplicateField,
    objects.dedupTable,
  ].every((value) => Number(value) === 1);

  const requiredFlowColumns = [
    "bank_name",
    "reference_no",
    "transaction_time",
    "income",
    "counterparty_account",
    "counterparty_name",
    "summary",
    "purpose",
    "post_script",
    "matched_counterparty_id",
    "arrival_match_status",
  ];
  const [columnRows] = await connection.query(
    `SELECT column_name AS columnName, is_nullable AS isNullable,
            column_default AS columnDefault, data_type AS dataType, column_type AS columnType
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'bank_flows'
        AND column_name IN (?)`,
    [requiredFlowColumns],
  );
  const columns = new Map(columnRows.map((row) => [String(row.columnName), row]));
  const matchId = columns.get("matched_counterparty_id");
  const matchStatus = columns.get("arrival_match_status");
  const unifiedFieldsComplete = requiredFlowColumns.every((name) => columns.has(name));
  const matchFieldsComplete = Boolean(
    matchId
      && matchId.isNullable === "YES"
      && matchId.dataType === "bigint"
      && String(matchId.columnType).toLowerCase() === "bigint unsigned"
      && matchStatus
      && matchStatus.isNullable === "NO"
      && String(matchStatus.columnDefault) === "unmatched"
      && String(matchStatus.columnType).toLowerCase() === "enum('unmatched','matched','cancelled')",
  );

  let matchedWithoutId = 0;
  let idWithoutMatched = 0;
  let orphanCounterparty = 0;
  if (matchFieldsComplete) {
    const [[integrity]] = await connection.query(
      `SELECT
         SUM(CASE WHEN bf.arrival_match_status = 'matched' AND bf.matched_counterparty_id IS NULL THEN 1 ELSE 0 END) AS matchedWithoutId,
         SUM(CASE WHEN bf.arrival_match_status <> 'matched' AND bf.matched_counterparty_id IS NOT NULL THEN 1 ELSE 0 END) AS idWithoutMatched,
         SUM(CASE WHEN bf.matched_counterparty_id IS NOT NULL AND cr.id IS NULL THEN 1 ELSE 0 END) AS orphanCounterparty
       FROM bank_flows bf
       LEFT JOIN counterparty_records cr ON cr.id = bf.matched_counterparty_id`,
    );
    matchedWithoutId = Number(integrity?.matchedWithoutId || 0);
    idWithoutMatched = Number(integrity?.idWithoutMatched || 0);
    orphanCounterparty = Number(integrity?.orphanCounterparty || 0);
  }

  return {
    prerequisiteComplete,
    unifiedFieldsComplete,
    unifiedFieldCount: requiredFlowColumns.filter((name) => columns.has(name)).length,
    requiredUnifiedFieldCount: requiredFlowColumns.length,
    matchFieldsComplete,
    matchedWithoutId,
    idWithoutMatched,
    orphanCounterparty,
    current: prerequisiteComplete
      && unifiedFieldsComplete
      && matchFieldsComplete
      && matchedWithoutId === 0
      && idWithoutMatched === 0
      && orphanCounterparty === 0,
  };
}

function printState(databaseName, authenticatedUser, state) {
  console.log(
    `v10.82 数据库检查结果：数据库=${databaseName}，用户=${authenticatedUser}，`
      + `前置结构=${state.prerequisiteComplete ? "完整" : "不完整"}，`
      + `流水统一字段=${state.unifiedFieldsComplete ? "完整" : `${state.unifiedFieldCount}/${state.requiredUnifiedFieldCount}`}，`
      + `到账匹配字段=${state.matchFieldsComplete ? "完整" : "不完整"}，`
      + `匹配无到账ID=${state.matchedWithoutId}，非匹配残留到账ID=${state.idWithoutMatched}，孤立到账ID=${state.orphanCounterparty}`,
  );
}

async function main() {
  const { username, databaseName } = parseDatabaseUrl(rawUrl);
  if (username !== "finance_user" || databaseName !== "finance_recon") {
    throw new Error(`DATABASE_URL 必须使用 finance_user / finance_recon，实际为 ${username} / ${databaseName}`);
  }
  if (!new Set(["check", "probe", "verify"]).has(action)) {
    throw new Error(`v10.82 无 SQL 迁移，不允许数据库操作：${action}`);
  }

  const connection = await mysql.createConnection(rawUrl.replace(/^mysql2:/, "mysql:"));
  try {
    const [[identity]] = await connection.query(
      "SELECT DATABASE() AS databaseName, CURRENT_USER() AS authenticatedUser",
    );
    const state = await inspectState(connection);
    printState(identity.databaseName, identity.authenticatedUser, state);
    if (!state.current) {
      throw new Error(`v10.82 所需数据库完成态不完整：${JSON.stringify(state)}`);
    }
    console.log("✅ v10.82 无 SQL 迁移；现有日期汇总、明细分账和银行流水统一字段检查通过，可以部署。");
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`❌ v10.82 数据库检查失败：${redactError(error)}`);
  console.error("❌ 数据库状态未通过，禁止部署。");
  process.exitCode = 1;
});
