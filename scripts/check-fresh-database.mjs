import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";
import mysql from "mysql2/promise";
import { ensureMysqlEvents } from "./ensure-mysql-events.mjs";

const manifest = JSON.parse(readFileSync(new URL("../database/fresh-schema-v10.85.json", import.meta.url), "utf8"));
const schemaSql = readFileSync(new URL("../database/init-fresh-schema-v10.85.sql", import.meta.url), "utf8");
const normalizeType = (value) => String(value).toLowerCase().replace(/\b(tinyint|smallint|mediumint|int|bigint)\(\d+\)/g, "$1");
const normalizeBody = (value) => String(value).replace(/^\s*--[^\n]*$/gm, "").replace(/`/g, "").replace(/\s+/g, " ").trim();

export async function checkFreshDatabase(connection, { checkEvents = true } = {}) {
  const issues = [];
  for (const [name, expected] of Object.entries(manifest.tables)) {
    const [columns] = await connection.query(
      "SELECT COLUMN_NAME name,COLUMN_TYPE type,IS_NULLABLE nullable FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ORDER BY ORDINAL_POSITION", [name],
    );
    const normalizeColumns = (rows) => rows.map((row) => ({ ...row, type: normalizeType(row.type) }));
    if (JSON.stringify(normalizeColumns(columns)) !== JSON.stringify(normalizeColumns(expected.columns))) issues.push(`${name}: 字段类型、顺序或可空性不一致`);
    const [indexes] = await connection.query(
      "SELECT INDEX_NAME name,NON_UNIQUE nonUnique,SEQ_IN_INDEX position,COLUMN_NAME columnName,SUB_PART prefixLength FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? ORDER BY INDEX_NAME,SEQ_IN_INDEX", [name],
    );
    if (JSON.stringify(indexes) !== JSON.stringify(expected.indexes)) issues.push(`${name}: 索引不一致`);
    const [foreignKeys] = await connection.query(
      "SELECT k.CONSTRAINT_NAME name,k.COLUMN_NAME columnName,k.REFERENCED_TABLE_NAME referencedTable,k.REFERENCED_COLUMN_NAME referencedColumn,r.DELETE_RULE deleteRule,r.UPDATE_RULE updateRule FROM information_schema.key_column_usage k JOIN information_schema.referential_constraints r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME=? ORDER BY k.CONSTRAINT_NAME,k.ORDINAL_POSITION", [name],
    );
    if (JSON.stringify(foreignKeys) !== JSON.stringify(expected.foreignKeys)) issues.push(`${name}: 外键不一致`);
  }
  for (const name of manifest.procedures) {
    let actual;
    try {
      const [rows] = await connection.query(`SHOW CREATE PROCEDURE \`${name}\``);
      actual = rows[0]?.["Create Procedure"]?.replace(/CREATE DEFINER=`[^`]+`@`[^`]+` /, "CREATE ");
    } catch (error) {
      if (error.code !== "ER_SP_DOES_NOT_EXIST") throw error;
    }
    const expected = schemaSql.match(new RegExp("(CREATE PROCEDURE `" + name + "`\\([^\\n]*\\)\\n[\\s\\S]*?);;"))?.[1];
    if (!actual || !expected || normalizeBody(actual) !== normalizeBody(expected)) issues.push(`${name}: 存储过程缺失、定义不可读或不一致`);
  }
  const [partitions] = await connection.query(
    "SELECT PARTITION_NAME name,PARTITION_DESCRIPTION boundary FROM information_schema.partitions WHERE table_schema=DATABASE() AND table_name='bill_details'",
  );
  const [[today]] = await connection.query("SELECT CONCAT('p', DATE_FORMAT(CURDATE(), '%Y%m%d')) partitionName");
  if (!partitions.some((row) => row.name === "p_late")
    || !partitions.some((row) => row.name === "p_future" && row.boundary === "MAXVALUE")
    || !partitions.some((row) => row.name === today.partitionName)) issues.push("bill_details: 迟到、未来或当日分区缺失");
  if (issues.length) throw new Error(`全新部署结构检查失败：\n${issues.join("\n")}`);
  if (checkEvents) await ensureMysqlEvents({ connection, checkOnly: true });
  return { version: manifest.version, tableCount: Object.keys(manifest.tables).length, procedureCount: manifest.procedures.length };
}

async function main() {
  config({ quiet: true });
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 未配置");
  const connection = await mysql.createConnection({ uri: process.env.DATABASE_URL.replace(/^mysql2:/, "mysql:"), dateStrings: true });
  try {
    const result = await checkFreshDatabase(connection);
    console.log(`全新部署 ${result.version} 结构验证通过：${result.tableCount} 张表、${result.procedureCount} 个存储过程、滚动分区及 2 个 Event。`);
  } finally {
    await connection.end();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    const message = String(error?.message || error).split(process.env.DATABASE_URL || "[unconfigured]").join("[已隐藏连接信息]").replace(/mysql(?:2)?:\/\/[^@\s]+@/g, "mysql://***@");
    console.error(message);
    process.exitCode = 1;
  });
}
