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
  console.error("❌ .env 缺少 DATABASE_URL，禁止迁移和部署。");
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
  const [[prerequisite]] = await connection.query(
    `SELECT
       EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'counterparty_records') AS recordsTable,
       EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'counterparty_match_accounts') AS matchTable,
       EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'detail_split_order_dedup_keys') AS v1080Table,
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'bank_flows' AND column_name = 'matched_counterparty_id') AS v1081MatchId,
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'bank_flows' AND column_name = 'arrival_match_status') AS v1081MatchStatus`,
  );
  const prerequisiteComplete = [
    prerequisite?.recordsTable,
    prerequisite?.matchTable,
    prerequisite?.v1080Table,
    prerequisite?.v1081MatchId,
    prerequisite?.v1081MatchStatus,
  ].every((value) => Number(value) === 1);
  if (!prerequisiteComplete) {
    return { kind: "invalid-prerequisite", prerequisiteComplete };
  }

  const legacyNames = ["bank_name", "account_no", "account_name", "summary", "purpose", "post_script"];
  const [legacyRows] = await connection.query(
    `SELECT column_name AS columnName
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'counterparty_records'
        AND column_name IN (${legacyNames.map(() => "?").join(", ")})`,
    legacyNames,
  );
  const legacyColumns = new Set(legacyRows.map((row) => String(row.columnName)));
  const legacyColumnCount = legacyColumns.size;
  const [[oldIndexRow]] = await connection.query(
    `SELECT COUNT(*) AS count
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'counterparty_records'
        AND index_name = 'cr_account_no_idx'`,
  );
  const oldIndexPresent = Number(oldIndexRow?.count || 0) > 0;

  const [childColumnRows] = await connection.query(
    `SELECT column_name AS columnName
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'counterparty_match_accounts'
        AND column_name IN ('id','counterparty_record_id','bank_name','account_no','account_name','summary','purpose','post_script','is_active','sort_order')`,
  );
  const childColumnsComplete = childColumnRows.length === 10;

  const [sortIndexRows] = await connection.query(
    `SELECT non_unique AS nonUnique, seq_in_index AS seqInIndex, column_name AS columnName
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'counterparty_match_accounts'
        AND index_name = 'cma_record_sort_uq'
      ORDER BY seq_in_index`,
  );
  const sortUniqueComplete = sortIndexRows.length === 2
    && sortIndexRows.every((row) => Number(row.nonUnique) === 0)
    && String(sortIndexRows[0].columnName) === "counterparty_record_id"
    && String(sortIndexRows[1].columnName) === "sort_order";

  const [fkRows] = await connection.query(
    `SELECT rc.delete_rule AS deleteRule, kcu.column_name AS columnName,
            kcu.referenced_table_name AS referencedTable, kcu.referenced_column_name AS referencedColumn
       FROM information_schema.referential_constraints rc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_schema = rc.constraint_schema
        AND kcu.table_name = rc.table_name
        AND kcu.constraint_name = rc.constraint_name
      WHERE rc.constraint_schema = DATABASE()
        AND rc.table_name = 'counterparty_match_accounts'
        AND rc.constraint_name = 'cma_record_fk'`,
  );
  const foreignKeyComplete = fkRows.length === 1
    && String(fkRows[0].deleteRule).toUpperCase() === "CASCADE"
    && String(fkRows[0].columnName) === "counterparty_record_id"
    && String(fkRows[0].referencedTable) === "counterparty_records"
    && String(fkRows[0].referencedColumn) === "id";

  const [[integrity]] = await connection.query(
    `SELECT
       SUM(CASE WHEN cr.id IS NULL THEN 1 ELSE 0 END) AS orphanChildren,
       COUNT(DISTINCT CASE WHEN cma.is_active = 1
         AND COALESCE(cma.bank_name, '') = ''
         AND COALESCE(cma.account_no, '') = ''
         AND COALESCE(cma.account_name, '') = ''
         AND COALESCE(cma.summary, '') = ''
         AND COALESCE(cma.purpose, '') = ''
         AND COALESCE(cma.post_script, '') = '' THEN cma.id END) AS emptyActiveMatchers
     FROM counterparty_match_accounts cma
     LEFT JOIN counterparty_records cr ON cr.id = cma.counterparty_record_id`,
  );
  const [[duplicateRow]] = await connection.query(
    `SELECT COUNT(*) AS count FROM (
       SELECT counterparty_record_id, sort_order
       FROM counterparty_match_accounts
       GROUP BY counterparty_record_id, sort_order
       HAVING COUNT(*) > 1
     ) duplicates`,
  );
  const [[missingRow]] = await connection.query(
    `SELECT
       SUM(CASE WHEN all_match.counterparty_record_id IS NULL THEN 1 ELSE 0 END) AS noChildRecords,
       SUM(CASE WHEN all_match.counterparty_record_id IS NOT NULL AND active_match.counterparty_record_id IS NULL THEN 1 ELSE 0 END) AS childButNoActiveRecords
     FROM counterparty_records cr
     LEFT JOIN (SELECT DISTINCT counterparty_record_id FROM counterparty_match_accounts) all_match
       ON all_match.counterparty_record_id = cr.id
     LEFT JOIN (SELECT DISTINCT counterparty_record_id FROM counterparty_match_accounts WHERE is_active = 1) active_match
       ON active_match.counterparty_record_id = cr.id`,
  );
  let unbackfillableRecords = 0;
  if (legacyColumnCount === legacyNames.length) {
    const [[backfillRow]] = await connection.query(
      `SELECT COUNT(*) AS count
         FROM counterparty_records cr
        WHERE NOT EXISTS (
          SELECT 1 FROM counterparty_match_accounts cma WHERE cma.counterparty_record_id = cr.id
        )
          AND COALESCE(cr.bank_name, '') = ''
          AND COALESCE(cr.account_no, '') = ''
          AND COALESCE(cr.account_name, '') = ''
          AND COALESCE(cr.summary, '') = ''
          AND COALESCE(cr.purpose, '') = ''
          AND COALESCE(cr.post_script, '') = ''`,
    );
    unbackfillableRecords = Number(backfillRow?.count || 0);
  }

  const orphanChildren = Number(integrity?.orphanChildren || 0);
  const emptyActiveMatchers = Number(integrity?.emptyActiveMatchers || 0);
  const duplicateSortOrders = Number(duplicateRow?.count || 0);
  const noChildRecords = Number(missingRow?.noChildRecords || 0);
  const childButNoActiveRecords = Number(missingRow?.childButNoActiveRecords || 0);
  const integrityComplete = orphanChildren === 0
    && emptyActiveMatchers === 0
    && duplicateSortOrders === 0
    && childButNoActiveRecords === 0
    && unbackfillableRecords === 0;
  const constraintsEitherAbsentOrComplete = (sortIndexRows.length === 0 || sortUniqueComplete)
    && (fkRows.length === 0 || foreignKeyComplete);
  const kind = legacyColumnCount === 0
    && !oldIndexPresent
    && childColumnsComplete
    && sortUniqueComplete
    && foreignKeyComplete
    && integrityComplete
    && noChildRecords === 0
      ? "current"
      : legacyColumnCount === legacyNames.length
        && oldIndexPresent
        && childColumnsComplete
        && integrityComplete
        && constraintsEitherAbsentOrComplete
          ? "needs-migration"
          : "invalid";
  return {
    kind,
    prerequisiteComplete,
    legacyColumnCount,
    oldIndexPresent,
    childColumnsComplete,
    sortUniqueComplete,
    foreignKeyComplete,
    orphanChildren,
    emptyActiveMatchers,
    duplicateSortOrders,
    noChildRecords,
    childButNoActiveRecords,
    unbackfillableRecords,
  };
}

function printState(databaseName, authenticatedUser, state) {
  console.log(
    `v10.84 数据库检查结果：数据库=${databaseName}，用户=${authenticatedUser}，`
      + `v10.83前置=${state.prerequisiteComplete ? "完整" : "不完整"}，`
      + `主表旧条件字段=${state.legacyColumnCount ?? "未知"}/6，旧索引=${state.oldIndexPresent ? "存在" : "不存在"}，`
      + `子表排序唯一键=${state.sortUniqueComplete ? "完整" : "未完成"}，外键=${state.foreignKeyComplete ? "完整" : "未完成"}，`
      + `孤立子项=${state.orphanChildren ?? "未知"}，空启用条件=${state.emptyActiveMatchers ?? "未知"}，`
      + `重复排序=${state.duplicateSortOrders ?? "未知"}，无子项主记录=${state.noChildRecords ?? "未知"}，`
      + `有子项但无启用条件=${state.childButNoActiveRecords ?? "未知"}，不可回填=${state.unbackfillableRecords ?? "未知"}`,
  );
}

async function main() {
  const { username, databaseName } = parseDatabaseUrl(rawUrl);
  if (username !== "finance_user" || databaseName !== "finance_recon") {
    throw new Error(`DATABASE_URL 必须使用 finance_user / finance_recon，实际为 ${username} / ${databaseName}`);
  }
  if (!new Set(["check", "probe", "verify"]).has(action)) {
    throw new Error(`v10.84 无 SQL 迁移，不允许数据库操作：${action}`);
  }
  const connection = await mysql.createConnection(rawUrl.replace(/^mysql2:/, "mysql:"));
  try {
    const [[identity]] = await connection.query("SELECT DATABASE() AS databaseName, CURRENT_USER() AS authenticatedUser");
    const state = await inspectState(connection);
    printState(identity.databaseName, identity.authenticatedUser, state);
    if (state.kind !== "current") {
      throw new Error(`v10.84 所需的 v10.83 数据库完成态不完整：${JSON.stringify(state)}`);
    }
    console.log("✅ v10.84 无 SQL 迁移；v10.83 到账匹配条件唯一来源结构与数据完整性检查通过，可以部署。");
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`❌ v10.84 数据库检查失败：${redactError(error)}`);
  console.error("❌ 数据库状态未通过，禁止部署。");
  process.exitCode = 1;
});
