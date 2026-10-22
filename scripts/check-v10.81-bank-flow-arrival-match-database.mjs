import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { parse as parseEnv } from "dotenv";
import mysql from "mysql2/promise";

const action = process.env.DATABASE_CONTROL_ACTION || "check";
const migrationFile = process.env.DATABASE_MIGRATION_FILE || "";
const appDir = process.env.DATABASE_APP_DIR || process.cwd();
const expectedMigrationName = "migrate-v10.81-bank-flow-arrival-match.sql";

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

function parseSqlStatements(source) {
  const statements = [];
  let buffer = [];
  for (const line of source.split(/\r?\n/)) {
    buffer.push(line);
    const joined = buffer.join("\n").trimEnd();
    if (joined.endsWith(";")) {
      const statement = joined.slice(0, -1).trim();
      if (statement) statements.push(statement);
      buffer = [];
    }
  }
  if (buffer.join("\n").trim()) throw new Error("迁移文件末尾存在未结束 SQL");
  return statements;
}

async function inspectState(connection) {
  const [prerequisiteRows] = await connection.query(
    `SELECT
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'recognition_rules' AND column_name = 'detail_split_order_no_field') AS ruleField,
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'detail_split_files' AND column_name = 'order_no_field') AS fileField,
       EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'detail_split_files' AND column_name = 'duplicate_count') AS duplicateField,
       EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'detail_split_order_dedup_keys') AS dedupTable`,
  );
  const prerequisite = prerequisiteRows[0] || {};
  const prerequisiteComplete = [
    prerequisite.ruleField,
    prerequisite.fileField,
    prerequisite.duplicateField,
    prerequisite.dedupTable,
  ].every((value) => Number(value) === 1);

  const [columnRows] = await connection.query(
    `SELECT column_name AS columnName, is_nullable AS isNullable,
            column_default AS columnDefault, data_type AS dataType, column_type AS columnType
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'bank_flows'
        AND column_name IN ('matched_counterparty_id', 'arrival_match_status')`,
  );
  const columns = new Map(columnRows.map((row) => [String(row.columnName), row]));
  const matchId = columns.get("matched_counterparty_id");
  const matchStatus = columns.get("arrival_match_status");
  const fieldsComplete = Boolean(
    matchId
      && matchId.isNullable === "YES"
      && matchId.dataType === "bigint"
      && String(matchId.columnType).toLowerCase() === "bigint unsigned"
      && matchStatus
      && matchStatus.isNullable === "NO"
      && String(matchStatus.columnDefault) === "unmatched"
      && String(matchStatus.columnType).toLowerCase() === "enum('unmatched','matched','cancelled')",
  );
  const presentCount = [matchId, matchStatus].filter(Boolean).length;

  let matchedWithoutId = 0;
  let idWithoutMatched = 0;
  let orphanCounterparty = 0;
  if (fieldsComplete) {
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

  const integrityComplete = matchedWithoutId === 0 && idWithoutMatched === 0 && orphanCounterparty === 0;
  const kind = !prerequisiteComplete
    ? "invalid-prerequisite"
    : fieldsComplete && integrityComplete
      ? "current"
      : presentCount === 0
        ? "needs-migration"
        : "invalid";
  return {
    kind,
    prerequisiteComplete,
    fieldsComplete,
    presentCount,
    matchedWithoutId,
    idWithoutMatched,
    orphanCounterparty,
  };
}

function printState(databaseName, authenticatedUser, state) {
  console.log(
    `v10.81 数据库检查结果：数据库=${databaseName}，用户=${authenticatedUser}，`
      + `v10.80前置=${state.prerequisiteComplete ? "完整" : "不完整"}，`
      + `流水匹配字段=${state.fieldsComplete ? "完整" : `${state.presentCount}/2`}，`
      + `匹配无到账ID=${state.matchedWithoutId}，非匹配残留到账ID=${state.idWithoutMatched}，孤立到账ID=${state.orphanCounterparty}`,
  );
}

async function main() {
  const { username, databaseName } = parseDatabaseUrl(rawUrl);
  if (username !== "finance_user" || databaseName !== "finance_recon") {
    throw new Error(`DATABASE_URL 必须使用 finance_user / finance_recon，实际为 ${username} / ${databaseName}`);
  }

  const connection = await mysql.createConnection(rawUrl.replace(/^mysql2:/, "mysql:"));
  try {
    const [[identity]] = await connection.query(
      "SELECT DATABASE() AS databaseName, CURRENT_USER() AS authenticatedUser",
    );
    const before = await inspectState(connection);
    printState(identity.databaseName, identity.authenticatedUser, before);
    if (before.kind === "invalid-prerequisite") {
      throw new Error("v10.80 数据库前置结构不完整，不能直接执行 v10.81 迁移");
    }
    if (before.kind === "invalid") {
      throw new Error(`v10.81 字段或匹配状态处于不完整状态：${JSON.stringify(before)}`);
    }

    if (action === "check") {
      if (before.kind === "current") {
        console.log("✅ v10.81 银行流水到账信息匹配迁移已完成，无需再次迁移，可以部署。");
        return;
      }
      if (!existsSync(migrationFile)) throw new Error(`需要迁移，但服务器缺少 ${migrationFile}`);
      console.log("✅ v10.81 数据库前置检查通过：可新增银行流水到账信息匹配字段并可靠回填历史数据。");
      console.log("下一步执行：");
      console.log(`APP_DIR=${appDir} ./deploy-update-optimized.sh --check-and-migrate-database`);
      return;
    }

    if (action === "probe") {
      if (before.kind === "current") {
        console.log("✅ v10.81 银行流水到账信息匹配迁移已完成，无需再次迁移，可以部署。");
        return;
      }
      if (!existsSync(migrationFile)) throw new Error(`需要迁移，但服务器缺少 ${migrationFile}`);
      console.log("✅ v10.81 数据库前置检查通过，需要执行当前版本迁移。");
      process.exitCode = 10;
      return;
    }

    if (action === "verify") {
      if (before.kind !== "current") throw new Error("v10.81 银行流水到账信息匹配迁移尚未完成");
      console.log("✅ v10.81 流水匹配字段、状态一致性和到账信息引用检查通过。");
      return;
    }
    if (action !== "migrate") throw new Error(`未知数据库操作：${action}`);
    if (before.kind === "current") {
      console.log("✅ v10.81 银行流水到账信息匹配迁移已完成，无需再次迁移，可以部署。");
      return;
    }
    if (basename(migrationFile) !== expectedMigrationName) {
      throw new Error(`迁移文件必须为 ${expectedMigrationName}`);
    }
    if (!existsSync(migrationFile)) throw new Error(`迁移文件不存在：${migrationFile}`);
    const statements = parseSqlStatements(readFileSync(migrationFile, "utf8"));
    const migrationSql = statements.join("\n");
    if (
      !/ALTER\s+TABLE\s+`?bank_flows`?[\s\S]*ADD\s+COLUMN\s+`?matched_counterparty_id`?/i.test(migrationSql)
      || !/ADD\s+COLUMN\s+`?arrival_match_status`?[\s\S]*ENUM\s*\(\s*'unmatched'\s*,\s*'matched'\s*,\s*'cancelled'\s*\)/i.test(migrationSql)
      || !/income_recognition_rules/i.test(migrationSql)
      || !/same_day_counterparty_id/i.test(migrationSql)
      || !/recognition_rules/i.test(migrationSql)
      || /\b(?:ADD\s+(?:UNIQUE\s+)?(?:KEY|INDEX)|CREATE\s+(?:UNIQUE\s+)?INDEX)\b/i.test(migrationSql)
      || /alias_snapshot|recognition_type_snapshot|matched_at/i.test(migrationSql)
      || /(?:DROP|TRUNCATE)\s+TABLE/i.test(migrationSql)
    ) {
      throw new Error("迁移文件内容与 v10.81 两字段固化、可靠历史回填和不新增索引的预期不一致");
    }
    for (const statement of statements) await connection.query(statement);
    const after = await inspectState(connection);
    printState(identity.databaseName, identity.authenticatedUser, after);
    if (after.kind !== "current") throw new Error(`迁移后回读失败：${JSON.stringify(after)}`);
    console.log("✅ v10.81 银行流水到账信息匹配迁移完成并回读通过，可以部署。");
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(`❌ v10.81 数据库检查或迁移失败：${redactError(error)}`);
  console.error("❌ 数据库状态未通过，禁止迁移和部署。");
  process.exitCode = 1;
});

