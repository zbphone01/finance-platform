# v10.62-local 部署说明

## 文件

- `releases/finance-platform-v10.62-local.tar.gz`：包含预构建 `dist/` 的 v10.62 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.62-local.md`：版本快照

## 重要说明

- 本说明仅适用于从 v10.61 升级到 v10.62；更早版本先按对应历史部署说明补齐到 v10.61。
- 本版本没有数据库结构迁移，不执行 SQL，也不执行 `drizzle schema push`。
- “修改认账”权限沿用现有 `role_permissions` 表，不需要插入初始化数据；财务缺少显式配置时默认允许，运营默认不允许，管理员始终允许。
- 部署包包含本地验证通过的 `dist/boot.js`、`dist/public/index.html` 和前端资源，服务器不执行 TypeScript 检查或应用构建。
- 部署前应暂停取消认账、锁定、制单和修改认账操作，等待当前请求结束后再停止应用。

## 测试服务器1部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.62-local.tar.gz \
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
    "match_results",
    "voucher_result_lines",
    "voucher_receipt_channels",
    "role_permissions",
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
        (table_name = 'match_results' AND column_name IN (
          'voucher_status',
          'voucher_receipt_channel_code',
          'management_fee_type',
          'management_fee_value',
          'management_fee_amount'
        ))
        OR
        (table_name = 'voucher_result_lines' AND column_name = 'match_result_id')
        OR
        (table_name = 'role_permissions' AND column_name IN ('permission_key', 'allowed'))
      )
    ORDER BY table_name, column_name
  `);
  console.table(columns);
  if (columns.length !== 8) throw new Error("修改认账依赖字段不完整，停止部署");
} finally {
  await db.end();
}
NODE
```

必须确认四张表均显示 `OK`，字段检查返回 8 行；否则停止部署，先按 v10.61 及历史部署说明补齐数据库。

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
    "match_results",
    "voucher_result_lines",
    "voucher_receipt_channels",
    "role_permissions",
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
        (table_name = 'match_results' AND column_name IN (
          'voucher_status',
          'voucher_receipt_channel_code',
          'management_fee_type',
          'management_fee_value',
          'management_fee_amount'
        ))
        OR
        (table_name = 'voucher_result_lines' AND column_name = 'match_result_id')
        OR
        (table_name = 'role_permissions' AND column_name IN ('permission_key', 'allowed'))
      )
    ORDER BY table_name, column_name
  `);
  console.table(columns);
  if (columns.length !== 8) throw new Error("部署后数据库只读复查失败");
} finally {
  await db.end();
}
NODE
```

检查结果必须与迁移前一致；本步骤只读，不应产生结构或数据变化。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.62-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认页面右上角显示 `v10.62`，日志没有新增预构建产物缺失、数据库连接或启动错误。使用财务账号检查“修改认账”权限和独立页面：未锁定、未制单的入账明细可以进入修改页，入账时间、流水号和入账金额只读，保存后只更新当前记录属性；已制单行不显示三点菜单。选择一条可取消的大订单认账，确认回滚成功后弹窗立即关闭，页面随后刷新为未认账状态。

## 测试服务器2部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.62-local.tar.gz \
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
    "match_results",
    "voucher_result_lines",
    "voucher_receipt_channels",
    "role_permissions",
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
        (table_name = 'match_results' AND column_name IN (
          'voucher_status',
          'voucher_receipt_channel_code',
          'management_fee_type',
          'management_fee_value',
          'management_fee_amount'
        ))
        OR
        (table_name = 'voucher_result_lines' AND column_name = 'match_result_id')
        OR
        (table_name = 'role_permissions' AND column_name IN ('permission_key', 'allowed'))
      )
    ORDER BY table_name, column_name
  `);
  console.table(columns);
  if (columns.length !== 8) throw new Error("修改认账依赖字段不完整，停止部署");
} finally {
  await db.end();
}
NODE
```

必须确认四张表均显示 `OK`，字段检查返回 8 行；否则停止部署，先按 v10.61 及历史部署说明补齐数据库。

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
    "match_results",
    "voucher_result_lines",
    "voucher_receipt_channels",
    "role_permissions",
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
        (table_name = 'match_results' AND column_name IN (
          'voucher_status',
          'voucher_receipt_channel_code',
          'management_fee_type',
          'management_fee_value',
          'management_fee_amount'
        ))
        OR
        (table_name = 'voucher_result_lines' AND column_name = 'match_result_id')
        OR
        (table_name = 'role_permissions' AND column_name IN ('permission_key', 'allowed'))
      )
    ORDER BY table_name, column_name
  `);
  console.table(columns);
  if (columns.length !== 8) throw new Error("部署后数据库只读复查失败");
} finally {
  await db.end();
}
NODE
```

检查结果必须与迁移前一致；本步骤只读，不应产生结构或数据变化。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.62-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
curl -fsS -H 'Accept: text/html' http://server2.example.com:3001/ > /dev/null
```

确认页面右上角显示 `v10.62`，两次 curl 均成功，日志没有新增预构建产物缺失、数据库连接或启动错误。使用财务账号检查“修改认账”权限和独立页面：未锁定、未制单的入账明细可以进入修改页，入账时间、流水号和入账金额只读，保存后只更新当前记录属性；已制单行不显示三点菜单。选择一条可取消的大订单认账，确认回滚成功后弹窗立即关闭，页面随后刷新为未认账状态。

## 风险与回退

- 部署前暂停取消认账、锁定、制单和修改认账操作，等待现有请求完成后再停止应用。
- 如 v10.62 启动、取消认账或修改认账异常，停止应用并使用 `releases/finance-platform-v10.61-local.tar.gz` 重新部署。
- 本版本没有数据库结构变化，回退代码时不执行数据库回滚。
- 回退到 v10.61 后不再提供修改认账入口，取消认账恢复为等待全部刷新完成后才返回的旧交互。
