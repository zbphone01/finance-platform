# v10.60-local 部署说明

## 文件

- `releases/finance-platform-v10.60-local.tar.gz`：包含预构建 `dist/` 的部署包
- `migrate-v10.60-order-recognition-summary-deltas.sql`：增量汇总表迁移
- `migrate-v10.60-archive-order-recognition-summaries.sql`：归档快照及增量自动清理过程
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.60-local.md`：版本快照

## 重要说明

- 本说明只适用于从 v10.59 升级到 v10.60。
- 必须按顺序执行两个迁移：先创建增量表，再替换归档过程；不要执行 `drizzle schema push`。
- 两个迁移都不回填或扫描历史 `bill_details`。归档过程只在后续正常归档批次中清理关联快照和增量。
- 增量表已经存在时不要重复执行建表迁移；归档过程迁移可在确认增量表结构完整后重新执行。
- 部署包包含预构建 `dist/`，服务器不执行 TypeScript 检查或前端构建。

## 测试服务器1部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.60-local.tar.gz \
  migrate-v10.60-order-recognition-summary-deltas.sql \
  migrate-v10.60-archive-order-recognition-summaries.sql \
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
  const [baseColumn] = await db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'order_files'
      AND column_name = 'recognition_summary_valid'
  `);
  const [baseTable] = await db.query(
    "SHOW TABLES LIKE 'order_file_recognition_summaries'",
  );
  const [deltaTable] = await db.query(
    "SHOW TABLES LIKE 'order_recognition_summary_deltas'",
  );
  const [archiveDependencies] = await db.query(`
    SELECT routine_name
    FROM information_schema.routines
    WHERE routine_schema = DATABASE()
      AND routine_type = 'PROCEDURE'
      AND routine_name IN (
        'ensure_bill_details_archive_tables_around',
        'archive_bill_details_day'
      )
  `);
  console.log({
    baseColumn: baseColumn.length,
    baseTable: baseTable.length,
    deltaTable: deltaTable.length,
    archiveDependencies: archiveDependencies.length,
  });
  if (baseColumn.length !== 1 || baseTable.length !== 1 || archiveDependencies.length !== 2) {
    throw new Error("v10.59 或归档依赖不完整，停止部署");
  }
  if (deltaTable.length > 1) throw new Error("增量表状态异常，停止部署");
} finally {
  await db.end();
}
NODE
```

`deltaTable: 0` 时执行建表迁移；`deltaTable: 1` 时先跳过建表迁移并在迁移后检查中确认结构。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 迁移

仅当迁移前 `deltaTable: 0` 时执行：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.60-order-recognition-summary-deltas.sql
```

增量表存在且建表命令正常结束后，执行归档过程迁移：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.60-archive-order-recognition-summaries.sql
```

任一命令报错时停止部署，不要启动新代码。

### 6. 迁移后检查

```bash
node --input-type=module <<'NODE'
import "dotenv/config";
import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) throw new Error("未读取到 DATABASE_URL");
const db = await mysql.createConnection(process.env.DATABASE_URL);
try {
  const [columns] = await db.query(`
    SELECT column_name, column_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'order_recognition_summary_deltas'
    ORDER BY ordinal_position
  `);
  const [primaryKey] = await db.query(`
    SELECT column_name, seq_in_index
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'order_recognition_summary_deltas'
      AND index_name = 'PRIMARY'
    ORDER BY seq_in_index
  `);
  const [indexes] = await db.query(`
    SELECT DISTINCT index_name
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'order_recognition_summary_deltas'
      AND index_name IN ('orsd_source_idx', 'orsd_target_idx')
  `);
  const [foreignKeys] = await db.query(`
    SELECT constraint_name AS constraintName, delete_rule AS deleteRule
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'order_recognition_summary_deltas'
      AND constraint_name = 'orsd_order_file_fk'
  `);
  const [procedures] = await db.query(
    "SHOW CREATE PROCEDURE archive_bill_details_day",
  );
  const body = String(procedures[0]?.["Create Procedure"] || "");
  console.log({
    columns: columns.length,
    primaryKey: primaryKey.length,
    indexes: indexes.length,
    foreignKeys: foreignKeys.length,
    archiveDeletesBase: body.includes("order_file_recognition_summaries"),
    archiveDeletesDeltas: body.includes("order_recognition_summary_deltas"),
  });
  if (columns.length !== 11 || primaryKey.length !== 8 || indexes.length !== 2) {
    throw new Error("增量表结构检查失败");
  }
  if (foreignKeys.length !== 1 || foreignKeys[0].deleteRule !== "CASCADE") {
    throw new Error("增量表外键检查失败");
  }
  if (
    procedures.length !== 1
    || !body.includes("order_file_recognition_summaries")
    || !body.includes("order_recognition_summary_deltas")
  ) {
    throw new Error("归档清理过程检查失败");
  }
} finally {
  await db.end();
}
NODE
```

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.60-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认页面版本为 `v10.60`。复测忽略或转移后的自动认账时：

```bash
pm2 logs finance-platform --lines 400 --nostream | grep 'recognition-performance'
```

命中增量路径时，`precheck` 或 `finalize` 日志应出现 `"fastSummaryDeltas":true`。

## 测试服务器2部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.60-local.tar.gz \
  migrate-v10.60-order-recognition-summary-deltas.sql \
  migrate-v10.60-archive-order-recognition-summaries.sql \
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
  const [baseColumn] = await db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'order_files'
      AND column_name = 'recognition_summary_valid'
  `);
  const [baseTable] = await db.query(
    "SHOW TABLES LIKE 'order_file_recognition_summaries'",
  );
  const [deltaTable] = await db.query(
    "SHOW TABLES LIKE 'order_recognition_summary_deltas'",
  );
  const [archiveDependencies] = await db.query(`
    SELECT routine_name
    FROM information_schema.routines
    WHERE routine_schema = DATABASE()
      AND routine_type = 'PROCEDURE'
      AND routine_name IN (
        'ensure_bill_details_archive_tables_around',
        'archive_bill_details_day'
      )
  `);
  console.log({
    baseColumn: baseColumn.length,
    baseTable: baseTable.length,
    deltaTable: deltaTable.length,
    archiveDependencies: archiveDependencies.length,
  });
  if (baseColumn.length !== 1 || baseTable.length !== 1 || archiveDependencies.length !== 2) {
    throw new Error("v10.59 或归档依赖不完整，停止部署");
  }
  if (deltaTable.length > 1) throw new Error("增量表状态异常，停止部署");
} finally {
  await db.end();
}
NODE
```

`deltaTable: 0` 时执行建表迁移；`deltaTable: 1` 时先跳过建表迁移并在迁移后检查中确认结构。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 迁移

仅当迁移前 `deltaTable: 0` 时执行：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.60-order-recognition-summary-deltas.sql
```

增量表存在且建表命令正常结束后，执行归档过程迁移：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.60-archive-order-recognition-summaries.sql
```

任一命令报错时停止部署，不要启动新代码。

### 6. 迁移后检查

```bash
node --input-type=module <<'NODE'
import "dotenv/config";
import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) throw new Error("未读取到 DATABASE_URL");
const db = await mysql.createConnection(process.env.DATABASE_URL);
try {
  const [columns] = await db.query(`
    SELECT column_name, column_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'order_recognition_summary_deltas'
    ORDER BY ordinal_position
  `);
  const [primaryKey] = await db.query(`
    SELECT column_name, seq_in_index
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'order_recognition_summary_deltas'
      AND index_name = 'PRIMARY'
    ORDER BY seq_in_index
  `);
  const [indexes] = await db.query(`
    SELECT DISTINCT index_name
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'order_recognition_summary_deltas'
      AND index_name IN ('orsd_source_idx', 'orsd_target_idx')
  `);
  const [foreignKeys] = await db.query(`
    SELECT constraint_name AS constraintName, delete_rule AS deleteRule
    FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'order_recognition_summary_deltas'
      AND constraint_name = 'orsd_order_file_fk'
  `);
  const [procedures] = await db.query(
    "SHOW CREATE PROCEDURE archive_bill_details_day",
  );
  const body = String(procedures[0]?.["Create Procedure"] || "");
  console.log({
    columns: columns.length,
    primaryKey: primaryKey.length,
    indexes: indexes.length,
    foreignKeys: foreignKeys.length,
    archiveDeletesBase: body.includes("order_file_recognition_summaries"),
    archiveDeletesDeltas: body.includes("order_recognition_summary_deltas"),
  });
  if (columns.length !== 11 || primaryKey.length !== 8 || indexes.length !== 2) {
    throw new Error("增量表结构检查失败");
  }
  if (foreignKeys.length !== 1 || foreignKeys[0].deleteRule !== "CASCADE") {
    throw new Error("增量表外键检查失败");
  }
  if (
    procedures.length !== 1
    || !body.includes("order_file_recognition_summaries")
    || !body.includes("order_recognition_summary_deltas")
  ) {
    throw new Error("归档清理过程检查失败");
  }
} finally {
  await db.end();
}
NODE
```

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform \
ACCESS_HOST=server2.example.com \
./deploy-update-optimized.sh finance-platform-v10.60-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认页面版本为 `v10.60`。复测忽略或转移后的自动认账时：

```bash
pm2 logs finance-platform --lines 400 --nostream | grep 'recognition-performance'
```

命中增量路径时，`precheck` 或 `finalize` 日志应出现 `"fastSummaryDeltas":true`。

## 回退

- 优先使用 `deploy-update-optimized.sh` 本轮部署前备份恢复 v10.59 代码。
- 普通代码回退时保留 `order_recognition_summary_deltas`，旧代码不会读写该表。
- 普通代码回退不要删除增量表，因为已替换的归档过程仍依赖它。
- 如必须删除增量表，先在维护窗口恢复 v10.59 的 `archive_bill_details_day` 定义，确认归档过程不再引用增量表后再执行 `DROP TABLE order_recognition_summary_deltas`。
