# v10.59-local 部署说明

## 文件

- `releases/finance-platform-v10.59-local.tar.gz`：包含预构建 `dist/` 的 v10.59 部署包
- `migrate-v10.59-order-recognition-summaries.sql`：订单包认账汇总表和有效标记迁移
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.59-local.md`：版本快照

## 重要说明

- 本部署包为 v10.59 同版本重发修正版，版本号保持 `v10.59`；已部署首版 v10.59 的服务器直接覆盖代码即可。
- 本说明适用于从 v10.58 升级到 v10.59；仍运行 v10.57 的环境也可直接使用。
- 本版本必须执行 `migrate-v10.59-order-recognition-summaries.sql`，不要执行 `drizzle schema push`。
- 迁移只增加轻量字段和空汇总表，不回填、不扫描 `bill_details`。
- 迁移前 `recognition_summary_valid` 字段和 `order_file_recognition_summaries` 表都不存在时执行迁移；两者都存在时不要重复执行；只存在一个时停止部署并检查上次迁移失败原因。
- 已部署首版 v10.59 时，迁移前检查应显示字段和表数量都为 `1`，必须跳过迁移。
- 部署后只有新上传且汇总仍有效的 T+1 订单包首次自动认账读取小表；历史订单包和失效汇总继续使用原明细查询。
- 修正版会在首次自动认账日志中输出 `recognition-performance`。复测时 `precheck` 应显示 `fastUploadSummary:true`，否则说明安全校验触发了旧路径回退。
- 部署包必须包含本地验证通过的 `dist/boot.js`、`dist/public/index.html` 和前端资源；服务器不执行 Vite/esbuild 构建。
- 部署脚本先在独立暂存目录校验产物、依赖、数据库连接和 MySQL Event，再使用本轮固定备份原子切换 `dist`。

## 测试服务器1部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.59-local.tar.gz \
  migrate-v10.59-order-recognition-summaries.sql \
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

if (!process.env.DATABASE_URL) {
  throw new Error("未在项目 .env 中读取到 DATABASE_URL");
}

const db = await mysql.createConnection(process.env.DATABASE_URL);

try {
  const [orderFileTables] = await db.query("SHOW TABLES LIKE 'order_files'");
  if (orderFileTables.length !== 1) {
    throw new Error("缺少 order_files，停止部署");
  }

  const [columns] = await db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'order_files'
      AND column_name = 'recognition_summary_valid'
  `);
  const [summaryTables] = await db.query(
    "SHOW TABLES LIKE 'order_file_recognition_summaries'",
  );

  console.log(`v10.59 column count: ${columns.length}`);
  console.log(`v10.59 table count: ${summaryTables.length}`);

  if (columns.length !== summaryTables.length) {
    throw new Error("v10.59 字段和表状态不一致，停止部署");
  }
} finally {
  await db.end();
}
NODE
```

`v10.59 column count` 和 `v10.59 table count` 都为 `0` 时执行迁移；都为 `1` 时跳过迁移；一项为 `0`、另一项为 `1` 时必须停止部署。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 迁移

仅当迁移前两个数量都为 `0` 时执行：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.59-order-recognition-summaries.sql
```

迁移命令必须正常结束。出现字段已存在、表已存在、外键创建失败或其他 SQL 错误时停止部署。

### 6. 迁移后检查

```bash
node --input-type=module <<'NODE'
import "dotenv/config";
import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) {
  throw new Error("未在项目 .env 中读取到 DATABASE_URL");
}

const db = await mysql.createConnection(process.env.DATABASE_URL);

try {
  const [columns] = await db.query(`
    SELECT column_name, column_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'order_files'
      AND column_name = 'recognition_summary_valid'
  `);
  console.table(columns);

  const [summaryColumns] = await db.query(`
    SELECT column_name, column_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'order_file_recognition_summaries'
    ORDER BY ordinal_position
  `);
  console.table(summaryColumns);

  const [primaryKey] = await db.query(`
    SELECT column_name, seq_in_index
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'order_file_recognition_summaries'
      AND index_name = 'PRIMARY'
    ORDER BY seq_in_index
  `);
  console.table(primaryKey);

  const [foreignKeys] = await db.query(`
    SELECT constraint_name, delete_rule
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'order_file_recognition_summaries'
      AND constraint_name = 'ofrs_order_file_fk'
  `);
  console.table(foreignKeys);

  if (columns.length !== 1 || summaryColumns.length !== 6 || primaryKey.length !== 3) {
    throw new Error("v10.59 表结构检查失败");
  }
  if (foreignKeys.length !== 1 || foreignKeys[0].delete_rule !== "CASCADE") {
    throw new Error("v10.59 外键检查失败");
  }
} finally {
  await db.end();
}
NODE
```

必须确认有效标记字段存在且默认值为 `0`；汇总表有 6 个字段；主键顺序为 `order_file_id、rule_item_id、is_refund`；外键删除规则为 `CASCADE`。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.59-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 Event 检查通过、PM2 应用在线、curl 返回成功、页面右上角显示 `v10.59`，且日志没有新增数据库结构、认账任务或启动错误。

完成同一支付宝文件复测后查看分段耗时：

```bash
pm2 logs finance-platform --lines 300 --nostream | grep 'recognition-performance'
```

应依次看到 `precheck`、`result-writes`、`finalize`；首次新上传 T+1 快路径的三条日志应包含 `"fastUploadSummary":true`。

## 测试服务器2部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.59-local.tar.gz \
  migrate-v10.59-order-recognition-summaries.sql \
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

if (!process.env.DATABASE_URL) {
  throw new Error("未在项目 .env 中读取到 DATABASE_URL");
}

const db = await mysql.createConnection(process.env.DATABASE_URL);

try {
  const [orderFileTables] = await db.query("SHOW TABLES LIKE 'order_files'");
  if (orderFileTables.length !== 1) {
    throw new Error("缺少 order_files，停止部署");
  }

  const [columns] = await db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'order_files'
      AND column_name = 'recognition_summary_valid'
  `);
  const [summaryTables] = await db.query(
    "SHOW TABLES LIKE 'order_file_recognition_summaries'",
  );

  console.log(`v10.59 column count: ${columns.length}`);
  console.log(`v10.59 table count: ${summaryTables.length}`);

  if (columns.length !== summaryTables.length) {
    throw new Error("v10.59 字段和表状态不一致，停止部署");
  }
} finally {
  await db.end();
}
NODE
```

`v10.59 column count` 和 `v10.59 table count` 都为 `0` 时执行迁移；都为 `1` 时跳过迁移；一项为 `0`、另一项为 `1` 时必须停止部署。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 迁移

仅当迁移前两个数量都为 `0` 时执行：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.59-order-recognition-summaries.sql
```

迁移命令必须正常结束。出现字段已存在、表已存在、外键创建失败或其他 SQL 错误时停止部署。

### 6. 迁移后检查

```bash
node --input-type=module <<'NODE'
import "dotenv/config";
import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) {
  throw new Error("未在项目 .env 中读取到 DATABASE_URL");
}

const db = await mysql.createConnection(process.env.DATABASE_URL);

try {
  const [columns] = await db.query(`
    SELECT column_name, column_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'order_files'
      AND column_name = 'recognition_summary_valid'
  `);
  console.table(columns);

  const [summaryColumns] = await db.query(`
    SELECT column_name, column_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'order_file_recognition_summaries'
    ORDER BY ordinal_position
  `);
  console.table(summaryColumns);

  const [primaryKey] = await db.query(`
    SELECT column_name, seq_in_index
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'order_file_recognition_summaries'
      AND index_name = 'PRIMARY'
    ORDER BY seq_in_index
  `);
  console.table(primaryKey);

  const [foreignKeys] = await db.query(`
    SELECT constraint_name, delete_rule
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'order_file_recognition_summaries'
      AND constraint_name = 'ofrs_order_file_fk'
  `);
  console.table(foreignKeys);

  if (columns.length !== 1 || summaryColumns.length !== 6 || primaryKey.length !== 3) {
    throw new Error("v10.59 表结构检查失败");
  }
  if (foreignKeys.length !== 1 || foreignKeys[0].delete_rule !== "CASCADE") {
    throw new Error("v10.59 外键检查失败");
  }
} finally {
  await db.end();
}
NODE
```

必须确认有效标记字段存在且默认值为 `0`；汇总表有 6 个字段；主键顺序为 `order_file_id、rule_item_id、is_refund`；外键删除规则为 `CASCADE`。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform \
ACCESS_HOST=server2.example.com \
./deploy-update-optimized.sh finance-platform-v10.59-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 Event 检查通过、PM2 应用在线、curl 返回成功、页面右上角显示 `v10.59`，且日志没有新增数据库结构、认账任务或启动错误。

完成订单文件复测后查看分段耗时：

```bash
pm2 logs finance-platform --lines 300 --nostream | grep 'recognition-performance'
```

应依次看到 `precheck`、`result-writes`、`finalize`；首次新上传 T+1 快路径的三条日志应包含 `"fastUploadSummary":true`。

## 回退

- 优先使用 `deploy-update-optimized.sh` 本轮部署自动保留的部署前备份恢复。
- 如需使用本地历史包回退，可重新上传并部署 `releases/finance-platform-v10.57-local.tar.gz`。
- 回退代码前执行 `UPDATE order_files SET recognition_summary_valid = 0;`，防止后续再次切换新代码时误用旧汇总状态。
- 新增表和字段对旧代码向后兼容，普通代码回退时保留，不执行 `DROP TABLE` 或 `DROP COLUMN`。
> 同版本重发说明：2026-07-25 最终部署包已去除 macOS `._*` AppleDouble 元数据。若 Step 1/8 提示包含禁止文件，请重新上传本说明对应的最终包，不要继续使用先前的同名压缩包。
