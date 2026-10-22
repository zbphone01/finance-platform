import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("migrate-v10.72-invoice-only-orders.sql", "utf8");
const deployScript = readFileSync("deploy-update-optimized.sh", "utf8");

test("v10.72 迁移只创建三张独立不认账表", () => {
  for (const tableName of [
    "invoice_only_rules",
    "invoice_only_order_files",
    "invoice_only_order_details",
  ]) {
    assert.ok(migration.includes(`CREATE TABLE IF NOT EXISTS \`${tableName}\``));
  }
  assert.doesNotMatch(
    migration,
    /(?:ALTER|DROP|TRUNCATE)\s+TABLE\s+`?(?:recognition_rules|order_files|bill_details)`?/i,
  );
});

test("不认账订单明细使用合并时间和最小索引", () => {
  const detailTable = migration.match(
    /CREATE TABLE IF NOT EXISTS `invoice_only_order_details` \(([\s\S]*?)\) ENGINE=/,
  )?.[1] ?? "";
  assert.match(detailTable, /`order_datetime` datetime NOT NULL/);
  assert.doesNotMatch(detailTable, /`(?:order_date|order_time)`/);
  assert.match(detailTable, /KEY `iood_order_file_idx` \(`order_file_id`\)/);
  assert.doesNotMatch(detailTable, /KEY `[^`]+` \(`(?:bill_no|invoice_other_order_no_1|invoice_other_order_no_2|order_datetime)`/);
});

test("部署脚本在普通部署前验证 v10.72 完成态", () => {
  assert.match(deployScript, /migrate-v10\.72-invoice-only-orders\.sql/);
  assert.match(deployScript, /check_v1072_invoice_only_database "\$STAGE_DIR" "verify"/);
  assert.match(deployScript, /invoice_only_order_files WHERE upload_status = 'processing'/);
});
