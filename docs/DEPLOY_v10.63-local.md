# v10.63-local 部署说明

## 文件

- `releases/finance-platform-v10.63-local.tar.gz`：包含预构建 `dist/` 的 v10.63 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.63-local.md`：版本快照

## 重要说明

- 本说明仅适用于从 v10.62 升级到 v10.63；更早版本先按对应历史部署说明补齐到 v10.62。
- 本版本没有数据库结构迁移，不执行 SQL，也不执行 `drizzle schema push`。
- 本版本复用现有银行流水、入账结果和凭证表字段；迁移前后只做结构完整性检查。
- 部署包包含本地验证通过的 `dist/boot.js`、`dist/public/index.html` 和前端资源，服务器不执行 TypeScript 检查或应用构建。
- 部署前暂停银行到账上传、认账、分账、取消认账、锁定和制单操作，等待当前请求结束后再停止应用。

## 测试服务器1部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.63-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 登录服务器

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
```

### 3. 迁移前检查

```bash
node --input-type=module <<'NODE'
import "dotenv/config";
import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) throw new Error("未读取到 DATABASE_URL");
const db = await mysql.createConnection(process.env.DATABASE_URL);
try {
  const requiredTables = [
    "bank_flows",
    "match_results",
    "voucher_results",
    "voucher_result_flows",
    "voucher_result_lines",
    "voucher_template_settings",
  ];
  for (const table of requiredTables) {
    const [rows] = await db.query(`SHOW TABLES LIKE '${table}'`);
    console.log(`${table}: ${rows.length === 1 ? "OK" : "MISSING"}`);
    if (rows.length !== 1) throw new Error(`${table} 不存在，停止部署`);
  }

  const [columns] = await db.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND (
        (table_name = 'bank_flows' AND column_name IN (
          'task_id',
          'bank_name',
          'income',
          'recognition_status'
        ))
        OR
        (table_name = 'match_results' AND column_name IN (
          'bank_flow_id',
          'rule_item_id',
          'income_type',
          'donation_source',
          'management_fee_type',
          'management_fee_value',
          'management_fee_amount',
          'total_amount',
          'split_amount',
          'voucher_status',
          'order_detail_count_snapshot'
        ))
        OR
        (table_name = 'voucher_result_lines' AND column_name = 'match_result_id')
      )
    ORDER BY table_name, column_name
  `);
  console.table(columns);
  if (columns.length !== 16) {
    throw new Error("广发支出认账及退款制单依赖字段不完整，停止部署");
  }
} finally {
  await db.end();
}
NODE
```

必须确认六张表均显示 `OK`，字段检查返回 16 行；否则停止部署，先按 v10.62 及历史部署说明补齐数据库。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 迁移

本版本没有数据库迁移脚本，不执行 SQL，不执行 `drizzle schema push`。

### 6. 迁移后检查

```bash
node --input-type=module <<'NODE'
import "dotenv/config";
import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) throw new Error("未读取到 DATABASE_URL");
const db = await mysql.createConnection(process.env.DATABASE_URL);
try {
  const requiredTables = [
    "bank_flows",
    "match_results",
    "voucher_results",
    "voucher_result_flows",
    "voucher_result_lines",
    "voucher_template_settings",
  ];
  for (const table of requiredTables) {
    const [rows] = await db.query(`SHOW TABLES LIKE '${table}'`);
    console.log(`${table}: ${rows.length === 1 ? "OK" : "MISSING"}`);
    if (rows.length !== 1) throw new Error(`${table} 不存在，停止部署`);
  }

  const [columns] = await db.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND (
        (table_name = 'bank_flows' AND column_name IN (
          'task_id',
          'bank_name',
          'income',
          'recognition_status'
        ))
        OR
        (table_name = 'match_results' AND column_name IN (
          'bank_flow_id',
          'rule_item_id',
          'income_type',
          'donation_source',
          'management_fee_type',
          'management_fee_value',
          'management_fee_amount',
          'total_amount',
          'split_amount',
          'voucher_status',
          'order_detail_count_snapshot'
        ))
        OR
        (table_name = 'voucher_result_lines' AND column_name = 'match_result_id')
      )
    ORDER BY table_name, column_name
  `);
  console.table(columns);
  if (columns.length !== 16) throw new Error("部署后数据库只读复查失败");
} finally {
  await db.end();
}
NODE
```

检查结果必须与迁移前一致；本步骤只读，不应产生结构或数据变化。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.63-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认页面右上角显示 `v10.63`，日志没有新增预构建产物缺失、数据库连接或启动错误。上传一份含收入和支出的广发到账文件，确认支出在银行流水“收入”列显示负数，日期汇总金额按净额展示，支出未进入订单明细匹配。对负数流水执行手动认账，确认收入类型默认“订单退款”、捐赠属性可正常填写、入账结果为负数；再使用 `捐赠收入-到账认账模版` 制单，确认项目资金和管理费等凭证金额保持负数。

## 测试服务器2部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.63-local.tar.gz \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

### 2. 登录服务器

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
```

### 3. 迁移前检查

```bash
node --input-type=module <<'NODE'
import "dotenv/config";
import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) throw new Error("未读取到 DATABASE_URL");
const db = await mysql.createConnection(process.env.DATABASE_URL);
try {
  const requiredTables = [
    "bank_flows",
    "match_results",
    "voucher_results",
    "voucher_result_flows",
    "voucher_result_lines",
    "voucher_template_settings",
  ];
  for (const table of requiredTables) {
    const [rows] = await db.query(`SHOW TABLES LIKE '${table}'`);
    console.log(`${table}: ${rows.length === 1 ? "OK" : "MISSING"}`);
    if (rows.length !== 1) throw new Error(`${table} 不存在，停止部署`);
  }

  const [columns] = await db.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND (
        (table_name = 'bank_flows' AND column_name IN (
          'task_id',
          'bank_name',
          'income',
          'recognition_status'
        ))
        OR
        (table_name = 'match_results' AND column_name IN (
          'bank_flow_id',
          'rule_item_id',
          'income_type',
          'donation_source',
          'management_fee_type',
          'management_fee_value',
          'management_fee_amount',
          'total_amount',
          'split_amount',
          'voucher_status',
          'order_detail_count_snapshot'
        ))
        OR
        (table_name = 'voucher_result_lines' AND column_name = 'match_result_id')
      )
    ORDER BY table_name, column_name
  `);
  console.table(columns);
  if (columns.length !== 16) {
    throw new Error("广发支出认账及退款制单依赖字段不完整，停止部署");
  }
} finally {
  await db.end();
}
NODE
```

必须确认六张表均显示 `OK`，字段检查返回 16 行；否则停止部署，先按 v10.62 及历史部署说明补齐数据库。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 迁移

本版本没有数据库迁移脚本，不执行 SQL，不执行 `drizzle schema push`。

### 6. 迁移后检查

```bash
node --input-type=module <<'NODE'
import "dotenv/config";
import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) throw new Error("未读取到 DATABASE_URL");
const db = await mysql.createConnection(process.env.DATABASE_URL);
try {
  const requiredTables = [
    "bank_flows",
    "match_results",
    "voucher_results",
    "voucher_result_flows",
    "voucher_result_lines",
    "voucher_template_settings",
  ];
  for (const table of requiredTables) {
    const [rows] = await db.query(`SHOW TABLES LIKE '${table}'`);
    console.log(`${table}: ${rows.length === 1 ? "OK" : "MISSING"}`);
    if (rows.length !== 1) throw new Error(`${table} 不存在，停止部署`);
  }

  const [columns] = await db.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND (
        (table_name = 'bank_flows' AND column_name IN (
          'task_id',
          'bank_name',
          'income',
          'recognition_status'
        ))
        OR
        (table_name = 'match_results' AND column_name IN (
          'bank_flow_id',
          'rule_item_id',
          'income_type',
          'donation_source',
          'management_fee_type',
          'management_fee_value',
          'management_fee_amount',
          'total_amount',
          'split_amount',
          'voucher_status',
          'order_detail_count_snapshot'
        ))
        OR
        (table_name = 'voucher_result_lines' AND column_name = 'match_result_id')
      )
    ORDER BY table_name, column_name
  `);
  console.table(columns);
  if (columns.length !== 16) throw new Error("部署后数据库只读复查失败");
} finally {
  await db.end();
}
NODE
```

检查结果必须与迁移前一致；本步骤只读，不应产生结构或数据变化。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.63-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
curl -fsS -H 'Accept: text/html' http://server2.example.com:3001/ > /dev/null
```

确认页面右上角显示 `v10.63`，两次 curl 均成功，日志没有新增预构建产物缺失、数据库连接或启动错误。上传一份含收入和支出的广发到账文件，确认支出在银行流水“收入”列显示负数，日期汇总金额按净额展示，支出未进入订单明细匹配。对负数流水执行手动认账，确认收入类型默认“订单退款”、捐赠属性可正常填写、入账结果为负数；再使用 `捐赠收入-到账认账模版` 制单，确认项目资金和管理费等凭证金额保持负数。

## 风险与回退

- 部署前暂停银行到账上传、认账、分账、取消认账、锁定和制单操作，等待现有请求完成后再停止应用。
- 同日同时存在收入和支出时，日期汇总显示正负数净额；排查金额时同时核对单笔流水明细。
- 到账退款独立制单依赖 `捐赠收入-到账认账模版`，发布后应使用负数退款结果核对凭证摘要、科目和借贷方向。
- 如 v10.63 启动、负数认账或退款制单异常，停止应用并使用 `releases/finance-platform-v10.62-local.tar.gz` 重新部署。
- 本版本没有数据库结构变化，回退代码时不执行数据库回滚。
- 回退到 v10.62 后，广发支出、负数认账默认退款和到账退款独立制单能力不再提供。
