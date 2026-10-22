# v10.61-local 部署说明

## 文件

- `releases/finance-platform-v10.61-local.tar.gz`：包含预构建 `dist/` 的 v10.61 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.61-local.md`：版本快照

## 重要说明

- 本说明仅适用于从 v10.60 升级到 v10.61；更早版本先按对应历史部署说明补齐到 v10.60。
- 本版本没有数据库结构迁移，不执行 SQL，也不执行 `drizzle schema push`。
- 部署前后只读检查用于确认 v10.60 增量表、明细分账表和关键字段存在；检查不修改数据库。
- 部署包包含本地验证通过的 `dist/boot.js`、`dist/public/index.html` 和前端资源，服务器不执行 TypeScript 检查或应用构建。
- 部署完成后，明细分账文件必须包含 `订单状态` 列，且只有状态为“交易成功”的行会入库。

## 测试服务器1部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.61-local.tar.gz \
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
    "bill_details",
    "detail_split_files",
    "recognition_tasks",
    "order_recognition_summary_deltas",
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
        (table_name = 'bill_details' AND column_name IN (
          'detail_split_file_id',
          'split_source_detail_id',
          'match_status',
          'match_result_id',
          'raw_data'
        ))
        OR
        (table_name = 'detail_split_files' AND column_name IN (
          'recognition_phase',
          'match_field',
          'recognition_keyword_field'
        ))
      )
    ORDER BY table_name, column_name
  `);
  console.table(columns);
  if (columns.length !== 8) throw new Error("明细分账关键字段不完整，停止部署");
} finally {
  await db.end();
}
NODE
```

必须确认四张表均显示 `OK`，字段检查返回 8 行；否则停止部署，先按 v10.60 及历史部署说明补齐数据库。

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
  const [tables] = await db.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name IN (
        'bill_details',
        'detail_split_files',
        'recognition_tasks',
        'order_recognition_summary_deltas'
      )
    ORDER BY table_name
  `);
  console.table(tables);
  if (tables.length !== 4) throw new Error("数据库只读复查失败");
} finally {
  await db.end();
}
NODE
```

检查必须返回 4 行；本步骤只读，不应产生结构变化。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.61-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认页面右上角显示 `v10.61`，日志没有新增预构建产物缺失、数据库连接、启动或后台队列错误。上传一份包含“交易成功”和其他状态的明细分账小文件，确认只入库交易成功行，上传弹窗关闭后后台继续完成匹配、入库和自动拆分认账。

## 测试服务器2部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.61-local.tar.gz \
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
    "bill_details",
    "detail_split_files",
    "recognition_tasks",
    "order_recognition_summary_deltas",
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
        (table_name = 'bill_details' AND column_name IN (
          'detail_split_file_id',
          'split_source_detail_id',
          'match_status',
          'match_result_id',
          'raw_data'
        ))
        OR
        (table_name = 'detail_split_files' AND column_name IN (
          'recognition_phase',
          'match_field',
          'recognition_keyword_field'
        ))
      )
    ORDER BY table_name, column_name
  `);
  console.table(columns);
  if (columns.length !== 8) throw new Error("明细分账关键字段不完整，停止部署");
} finally {
  await db.end();
}
NODE
```

必须确认四张表均显示 `OK`，字段检查返回 8 行；否则停止部署，先按 v10.60 及历史部署说明补齐数据库。

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
  const [tables] = await db.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name IN (
        'bill_details',
        'detail_split_files',
        'recognition_tasks',
        'order_recognition_summary_deltas'
      )
    ORDER BY table_name
  `);
  console.table(tables);
  if (tables.length !== 4) throw new Error("数据库只读复查失败");
} finally {
  await db.end();
}
NODE
```

检查必须返回 4 行；本步骤只读，不应产生结构变化。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.61-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
curl -fsS -H 'Accept: text/html' http://server2.example.com:3001/ > /dev/null
```

确认页面右上角显示 `v10.61`，两次 curl 均成功，日志没有新增预构建产物缺失、数据库连接、启动或后台队列错误。上传一份包含“交易成功”和其他状态的明细分账小文件，确认只入库交易成功行，上传弹窗关闭后后台继续完成匹配、入库和自动拆分认账。

## 风险与回退

- 部署前暂停新的订单明细和明细分账上传，等待现有上传、匹配、入库及认账队列执行完成后再停止应用。
- 如 v10.61 启动或后台任务异常，停止应用并使用 `releases/finance-platform-v10.60-local.tar.gz` 重新部署。
- 本版本没有数据库结构变化，回退代码时不执行数据库回滚。
- 回退后明细分账恢复旧的上传等待、前端自动触发和状态处理逻辑；恢复上传前确认没有 v10.61 遗留的执行中分账任务。
