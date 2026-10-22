import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import mysql from "mysql2/promise";
import { checkFreshDatabase } from "./check-fresh-database.mjs";
import { ensureMysqlEvents } from "./ensure-mysql-events.mjs";

const schema = readFileSync("database/init-fresh-schema-v10.85.sql", "utf8");
test("完整初始化结构不含本机身份、业务数据导出或历史迁移依赖", () => {
  assert.doesNotMatch(schema, /CREATE\s+DEFINER|finance_recon_sandbox|AUTO_INCREMENT=\d+|SOURCE\s+.*migrate-/i);
  assert.doesNotMatch(schema.split("DELIMITER ;;")[0], /\b(?:INSERT|REPLACE)\s+INTO/i);
  assert.match(schema, /cma_record_sort_uq/);
  assert.match(schema, /bd\.match_result_id IS NOT NULL/);
  assert.match(schema, /LIMIT 50000 FOR UPDATE/);
  assert.match(schema, /DATE_SUB\(CURDATE\(\), INTERVAL 59 DAY\)/);
});

test("空库仅用完整 SQL 即可建库，结构守卫可发现缺失索引", { skip: !process.env.FRESH_TEST_ADMIN_URL }, async () => {
  const url = new URL(process.env.FRESH_TEST_ADMIN_URL);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "integration test is local-only");
  const database = `finance_fresh_test_${process.pid}_${Date.now()}`;
  const connection = await mysql.createConnection({ uri: url.href, dateStrings: true });
  let created = false;
  try {
    await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    await connection.changeUser({ database });
    const result = spawnSync("mysql", ["--protocol=TCP", "--default-character-set=utf8mb4", "-h", url.hostname, "-P", url.port || "3306", "-u", decodeURIComponent(url.username), database], {
      input: schema, encoding: "utf8", env: { ...process.env, MYSQL_PWD: decodeURIComponent(url.password) },
    });
    assert.equal(result.status, 0, result.stderr);
    await ensureMysqlEvents({ connection });
    assert.deepEqual(await checkFreshDatabase(connection), { version: "v10.85", tableCount: 47, procedureCount: 10 });
    const [tables] = await connection.query("SELECT table_name name FROM information_schema.tables WHERE table_schema=DATABASE()");
    assert.equal(tables.length, 47);
    for (const { name } of tables) {
      const [[row]] = await connection.query(`SELECT COUNT(*) count FROM \`${name}\``);
      assert.equal(Number(row.count), 0, `${name} must have no imported data`);
    }
    await connection.query("ALTER TABLE counterparty_records DROP INDEX cr_alias_idx");
    await assert.rejects(checkFreshDatabase(connection), /counterparty_records: 索引不一致/);
  } finally {
    if (created) await connection.query(`DROP DATABASE \`${database}\``);
    await connection.end();
  }
});
