# v10.57-local 部署说明

## 文件

- `releases/finance-platform-v10.57-local.tar.gz`：包含预构建 `dist/` 的 v10.57 部署包
- `migrate-v10.57-hot-only-recognition-cancellation.sql`：取消认账热区限制、归档状态字段及历史回填迁移
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.57-local.md`：版本快照

## 重要说明

- 本说明仅适用于从 v10.56 升级到 v10.57；更早版本先按对应历史部署说明补齐到 v10.56。
- 本版本必须执行 `migrate-v10.57-hot-only-recognition-cancellation.sql`，不要执行 `drizzle schema push`。
- 本次重发沿用 v10.57 版本号和迁移脚本，只补充转入订单规则条件刷新与超大热区取消认账分批处理；目标服务器 `v10.57 column count` 已为 `2` 时不要重复迁移，直接部署同名新包。
- 迁移增加 `match_results.has_archived_details` 和 `bill_detail_archive_runs.recognition_status_synced_at`，回填已有归档结果，并重建每日归档包装过程。
- 迁移脚本中的两个 `ALTER TABLE` 不是重复执行语句。迁移前两个新字段都不存在时执行；两个都存在时不要重复执行，直接完成迁移后检查；只存在一个时停止部署并检查上次迁移失败原因。
- 部署后，银行流水取消认账只处理热区订单明细。取消范围内包含已归档明细时，前端隐藏取消按钮，后端接口也会拒绝。
- 部署后，转入的 T+1 订单会在增量认账前按当前规则重新校正失效条件；热区取消认账涉及数十万订单明细时按每批 1000 条构造 SQL，避免调用栈溢出。
- 部署包必须包含本地验证通过的 `dist/boot.js`、`dist/public/index.html` 和前端资源；部署脚本不会在服务器执行 `npm run build`。
- 部署脚本先在独立暂存目录校验产物、依赖、数据库连接和 MySQL Event，再使用本轮固定备份原子切换 `dist`；异常中断或健康检查失败时恢复本轮部署前产物。

## 测试服务器1部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.57-local.tar.gz \
  migrate-v10.57-hot-only-recognition-cancellation.sql \
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
  const tableChecks = [
    ["match_results", "SHOW TABLES LIKE 'match_results'"],
    ["bill_detail_archive_runs", "SHOW TABLES LIKE 'bill_detail_archive_runs'"],
    ["system_storage_snapshot", "SHOW TABLES LIKE 'system_storage_snapshot'"],
  ];
  for (const [name, sql] of tableChecks) {
    const [rows] = await db.query(sql);
    console.log(`${name}: ${rows.length > 0 ? "OK" : "MISSING"}`);
  }

  const [columns] = await db.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND (
        (table_name = 'match_results' AND column_name = 'has_archived_details')
        OR
        (table_name = 'bill_detail_archive_runs' AND column_name = 'recognition_status_synced_at')
      )
    ORDER BY table_name, column_name
  `);
  console.table(columns);
  console.log(`v10.57 column count: ${columns.length}`);

  const [routines] = await db.query(`
    SELECT routine_name
    FROM information_schema.routines
    WHERE routine_schema = DATABASE()
      AND routine_type = 'PROCEDURE'
      AND routine_name IN (
        'archive_bill_details_daily',
        'archive_bill_details_daily_with_storage_request'
      )
    ORDER BY routine_name
  `);
  console.table(routines);

  const [schedulerRows] = await db.query("SHOW VARIABLES LIKE 'event_scheduler'");
  console.table(schedulerRows);

  const [events] = await db.query(`
    SELECT event_name, status, event_definition
    FROM information_schema.events
    WHERE event_schema = DATABASE()
      AND event_name = 'ev_bill_details_archive_old_daily_partitions'
  `);
  console.table(events);
} finally {
  await db.end();
}
NODE
```

必须确认三张表均显示 `OK`，两个归档过程都存在，`event_scheduler=ON`，归档事件为 `ENABLED` 且调用 `archive_bill_details_daily_with_storage_request`。`v10.57 column count` 为 `0` 时继续执行迁移；为 `2` 时不要重复执行迁移，直接进入迁移后检查；为 `1` 时停止部署并检查上次迁移失败原因。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 迁移

仅当迁移前检查的 `v10.57 column count` 为 `0` 时执行：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.57-hot-only-recognition-cancellation.sql
```

迁移命令必须正常结束。出现字段已存在、基础归档过程缺失、归档表缺失或其他 SQL 错误时停止部署，不要启动新版本代码。

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
    SELECT table_name, column_name, column_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND (
        (table_name = 'match_results' AND column_name = 'has_archived_details')
        OR
        (table_name = 'bill_detail_archive_runs' AND column_name = 'recognition_status_synced_at')
      )
    ORDER BY table_name, column_name
  `);
  console.table(columns);

  const [routines] = await db.query(`
    SELECT routine_name
    FROM information_schema.routines
    WHERE routine_schema = DATABASE()
      AND routine_type = 'PROCEDURE'
      AND routine_name IN (
        'archive_bill_details_daily',
        'archive_bill_details_daily_with_storage_request',
        'sync_archived_match_result_statuses'
      )
    ORDER BY routine_name
  `);
  console.table(routines);

  const [wrapperRows] = await db.query(
    "SHOW CREATE PROCEDURE archive_bill_details_daily_with_storage_request",
  );
  const wrapperSql = String(wrapperRows[0]?.["Create Procedure"] || "");
  console.log("wrapper calls archive:", wrapperSql.includes("archive_bill_details_daily()"));
  console.log("wrapper calls status sync:", wrapperSql.includes("sync_archived_match_result_statuses()"));
  console.log("wrapper keeps storage request:", wrapperSql.includes("system_storage_snapshot"));

  const [pendingRuns] = await db.query(`
    SELECT COUNT(*) AS pending_sync_count
    FROM bill_detail_archive_runs
    WHERE status = 'completed'
      AND completed_at IS NOT NULL
      AND (
        recognition_status_synced_at IS NULL
        OR recognition_status_synced_at < completed_at
      )
  `);
  console.table(pendingRuns);

  const [resultCounts] = await db.query(`
    SELECT
      SUM(has_archived_details = 1) AS archived_match_result_count,
      SUM(has_archived_details = 0) AS hot_match_result_count
    FROM match_results
  `);
  console.table(resultCounts);
} finally {
  await db.end();
}
NODE
```

必须确认两个字段都存在：`has_archived_details` 为 `tinyint(1)`、`NOT NULL`、默认值 `0`，`recognition_status_synced_at` 允许为空；三个过程都存在；包装过程的三项检查均为 `true`；`pending_sync_count` 为 `0`。任一条件不满足时停止部署。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.57-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 Event 检查通过、PM2 应用在线、curl 返回成功、页面右上角显示 `v10.57`，且部署后日志没有新增预构建产物缺失、数据库连接、启动失败或 `Maximum call stack size exceeded` 错误。

## 测试服务器2部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.57-local.tar.gz \
  migrate-v10.57-hot-only-recognition-cancellation.sql \
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
  const tableChecks = [
    ["match_results", "SHOW TABLES LIKE 'match_results'"],
    ["bill_detail_archive_runs", "SHOW TABLES LIKE 'bill_detail_archive_runs'"],
    ["system_storage_snapshot", "SHOW TABLES LIKE 'system_storage_snapshot'"],
  ];
  for (const [name, sql] of tableChecks) {
    const [rows] = await db.query(sql);
    console.log(`${name}: ${rows.length > 0 ? "OK" : "MISSING"}`);
  }

  const [columns] = await db.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND (
        (table_name = 'match_results' AND column_name = 'has_archived_details')
        OR
        (table_name = 'bill_detail_archive_runs' AND column_name = 'recognition_status_synced_at')
      )
    ORDER BY table_name, column_name
  `);
  console.table(columns);
  console.log(`v10.57 column count: ${columns.length}`);

  const [routines] = await db.query(`
    SELECT routine_name
    FROM information_schema.routines
    WHERE routine_schema = DATABASE()
      AND routine_type = 'PROCEDURE'
      AND routine_name IN (
        'archive_bill_details_daily',
        'archive_bill_details_daily_with_storage_request'
      )
    ORDER BY routine_name
  `);
  console.table(routines);

  const [schedulerRows] = await db.query("SHOW VARIABLES LIKE 'event_scheduler'");
  console.table(schedulerRows);

  const [events] = await db.query(`
    SELECT event_name, status, event_definition
    FROM information_schema.events
    WHERE event_schema = DATABASE()
      AND event_name = 'ev_bill_details_archive_old_daily_partitions'
  `);
  console.table(events);
} finally {
  await db.end();
}
NODE
```

必须确认三张表均显示 `OK`，两个归档过程都存在，`event_scheduler=ON`，归档事件为 `ENABLED` 且调用 `archive_bill_details_daily_with_storage_request`。`v10.57 column count` 为 `0` 时继续执行迁移；为 `2` 时不要重复执行迁移，直接进入迁移后检查；为 `1` 时停止部署并检查上次迁移失败原因。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 迁移

仅当迁移前检查的 `v10.57 column count` 为 `0` 时执行：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.57-hot-only-recognition-cancellation.sql
```

迁移命令必须正常结束。出现字段已存在、基础归档过程缺失、归档表缺失或其他 SQL 错误时停止部署，不要启动新版本代码。

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
    SELECT table_name, column_name, column_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND (
        (table_name = 'match_results' AND column_name = 'has_archived_details')
        OR
        (table_name = 'bill_detail_archive_runs' AND column_name = 'recognition_status_synced_at')
      )
    ORDER BY table_name, column_name
  `);
  console.table(columns);

  const [routines] = await db.query(`
    SELECT routine_name
    FROM information_schema.routines
    WHERE routine_schema = DATABASE()
      AND routine_type = 'PROCEDURE'
      AND routine_name IN (
        'archive_bill_details_daily',
        'archive_bill_details_daily_with_storage_request',
        'sync_archived_match_result_statuses'
      )
    ORDER BY routine_name
  `);
  console.table(routines);

  const [wrapperRows] = await db.query(
    "SHOW CREATE PROCEDURE archive_bill_details_daily_with_storage_request",
  );
  const wrapperSql = String(wrapperRows[0]?.["Create Procedure"] || "");
  console.log("wrapper calls archive:", wrapperSql.includes("archive_bill_details_daily()"));
  console.log("wrapper calls status sync:", wrapperSql.includes("sync_archived_match_result_statuses()"));
  console.log("wrapper keeps storage request:", wrapperSql.includes("system_storage_snapshot"));

  const [pendingRuns] = await db.query(`
    SELECT COUNT(*) AS pending_sync_count
    FROM bill_detail_archive_runs
    WHERE status = 'completed'
      AND completed_at IS NOT NULL
      AND (
        recognition_status_synced_at IS NULL
        OR recognition_status_synced_at < completed_at
      )
  `);
  console.table(pendingRuns);

  const [resultCounts] = await db.query(`
    SELECT
      SUM(has_archived_details = 1) AS archived_match_result_count,
      SUM(has_archived_details = 0) AS hot_match_result_count
    FROM match_results
  `);
  console.table(resultCounts);
} finally {
  await db.end();
}
NODE
```

必须确认两个字段都存在：`has_archived_details` 为 `tinyint(1)`、`NOT NULL`、默认值 `0`，`recognition_status_synced_at` 允许为空；三个过程都存在；包装过程的三项检查均为 `true`；`pending_sync_count` 为 `0`。任一条件不满足时停止部署。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.57-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 Event 检查通过、PM2 应用在线、curl 返回成功、页面右上角显示 `v10.57`，且部署后日志没有新增预构建产物缺失、数据库连接、启动失败或 `Maximum call stack size exceeded` 错误。

## 功能验证

- 页面右上角显示 `v10.57`。
- 找到全部认账结果仍对应热区订单明细的银行流水，取消认账按钮应继续显示，确认后可以正常取消。
- 找到包含已归档订单明细的已认账银行流水，取消认账按钮应隐藏；普通流水、同日汇总和多日汇总任一取消范围内包含归档明细时，整组都不能取消。
- 已归档的单条手工认账订单明细不显示取消认账入口；未归档的手工认账明细保持原取消能力。
- 对包含已归档明细的取消认账确认接口和提交接口直接发起请求时，后端应返回归档限制提示，不得恢复归档表数据。
- 在人工处理订单或日期汇总订单明细取消忽略、取消转移时，如果原日期认账范围包含归档明细，应提示无法继续；全部明细仍在热区时保持原联动取消流程。
- 回归验证规则条件曾重建的 T+1 转入订单：增量认账应刷新旧 `rule_item_id` 并按当前条件生成入账结果，不应静默停留在部分认账。
- 在业务确认允许实际取消后，用全部明细仍在热区的大批量流水回归取消认账；数十万明细应分批完成，页面与日志不再出现 `Maximum call stack size exceeded`，失败时整笔事务仍需回滚。
- 回归验证热区普通流水、同日汇总、多日汇总取消认账，入账结果锁定、凭证状态、订单明细上传和每日归档流程正常。

## 回退

- 代码可使用 `releases/finance-platform-v10.56-local.tar.gz` 回退；新增字段和过程保持兼容，回退代码时不要删除 `has_archived_details`、`recognition_status_synced_at` 或归档状态同步过程。
- 回退到 v10.56 后，取消认账会恢复扫描和恢复月归档表的旧逻辑。若业务仍要求禁止归档取消，应暂停取消认账操作并尽快恢复 v10.57。
- 单次部署在切换前会把旧运行产物保留为 `backups/dist.rollback.<部署批次>`；启动或健康检查失败时脚本自动恢复该固定回滚点。
- 自动回滚失败时停止重复部署，保留 `dist.failed.<部署批次>` 并人工核查。
