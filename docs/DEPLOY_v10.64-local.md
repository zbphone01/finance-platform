# v10.64-local 部署说明

## 文件

- `releases/finance-platform-v10.64-local.tar.gz`：包含预构建 `dist/` 的 v10.64 部署包
- `migrate-v10.64-manual-order-work-items.sql`：人工处理订单独立表及归档同步迁移
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.64-local.md`：版本快照

## 重要说明

- 本说明仅适用于从 v10.63 升级到 v10.64；更早版本先按对应历史部署说明补齐到 v10.63。
- 本版本新增 `manual_order_work_items`、`bill_detail_archive_runs.manual_work_items_synced_at` 和 `sync_archived_manual_order_work_items`，必须执行迁移脚本，不执行 `drizzle schema push`。
- 迁移会一次性回填热表和已有月归档表中的人工处理订单。迁移期间必须停止应用，并暂停银行到账上传、订单上传、认账、分账、取消操作和每日归档。
- `manual_order_work_items` 固定包含 4 个索引：主键 1 个、二级索引 3 个。
- v10.64 同版本重发调整“人工处理订单”筛选布局，并修复手动认账选择反馈类型时清空支出资金来源的问题；不新增数据库迁移、npm 依赖、环境变量或运行配置。目标环境已经完整执行 v10.64 迁移时，不要重复执行迁移脚本，只需重新部署本次发布包并完成最终验证。
- 部署包包含本地验证通过的 `dist/boot.js`、`dist/public/index.html` 和前端资源；服务器不执行 TypeScript 检查或应用构建。

## 测试服务器1部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.64-local.tar.gz \
  migrate-v10.64-manual-order-work-items.sql \
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
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon <<'SQL'
SELECT @@event_scheduler AS event_scheduler;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN (
    'bill_details',
    'bill_detail_archive_runs',
    'order_files',
    'recognition_tasks',
    'recognition_rules',
    'system_storage_snapshot'
  )
ORDER BY table_name;

SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = DATABASE()
  AND routine_type = 'PROCEDURE'
  AND routine_name IN (
    'archive_bill_details_daily',
    'archive_bill_details_daily_with_storage_request',
    'sync_archived_match_result_statuses'
  )
ORDER BY routine_name;

SELECT COUNT(*) AS manual_order_table_count
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = 'manual_order_work_items';

SELECT COUNT(*) AS manual_sync_column_count
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'bill_detail_archive_runs'
  AND column_name = 'manual_work_items_synced_at';

SELECT COUNT(*) AS running_archive_count
FROM bill_detail_archive_runs
WHERE status = 'processing';
SQL
```

必须同时满足：

- `event_scheduler` 为 `ON`。
- 依赖表返回 6 行，依赖过程返回 3 行。
- 从未执行 v10.64 迁移时，`manual_order_table_count` 和 `manual_sync_column_count` 都为 `0`。
- `running_archive_count` 为 `0`。

如果新增表或字段已经存在，不要重复执行迁移；直接按“迁移后检查”核对是否完整。新增表和字段只存在一部分时停止部署，先确认是否发生过中断迁移。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

确认应用已停止，并确认没有单独运行的上传、认账、分账或归档脚本。

### 5. 迁移

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.64-manual-order-work-items.sql
```

迁移结束时会输出人工处理订单三类状态数量、归档数量和最近 20 条归档同步时间。命令必须正常退出；不要在迁移执行中重启应用。

### 6. 迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon <<'SQL'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = 'manual_order_work_items';

SELECT column_name, column_type, is_nullable
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'bill_detail_archive_runs'
  AND column_name = 'manual_work_items_synced_at';

SELECT index_name, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS columns_in_index
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'manual_order_work_items'
GROUP BY index_name
ORDER BY index_name;

SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = DATABASE()
  AND routine_type = 'PROCEDURE'
  AND routine_name IN (
    'archive_bill_details_daily_with_storage_request',
    'sync_archived_manual_order_work_items',
    'sync_archived_match_result_statuses'
  )
ORDER BY routine_name;

SHOW CREATE PROCEDURE archive_bill_details_daily_with_storage_request;

SELECT
  COUNT(*) AS manual_order_count,
  SUM(display_status = 'ignored') AS ignored_count,
  SUM(display_status = 'transferred') AS transferred_count,
  SUM(display_status = 'transferred_recognized') AS transferred_recognized_count,
  SUM(storage_location = 'archive') AS archived_count
FROM manual_order_work_items;

SELECT COUNT(*) AS unsynced_completed_archive_count
FROM bill_detail_archive_runs
WHERE status = 'completed'
  AND completed_at IS NOT NULL
  AND (
    manual_work_items_synced_at IS NULL
    OR manual_work_items_synced_at < completed_at
  );
SQL
```

必须确认：

- 新增表和字段各返回 1 行。
- 索引检查只返回 `PRIMARY`、`mowi_summary_date_idx`、`mowi_status_date_idx`、`mowi_rule_status_date_idx` 共 4 行。
- 三个同步相关过程均存在。
- `SHOW CREATE PROCEDURE` 中依次保留 `archive_bill_details_daily()`、`sync_archived_match_result_statuses()`、`sync_archived_manual_order_work_items()` 和磁盘采集请求写入。
- `unsynced_completed_archive_count` 为 `0`。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.64-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认页面右上角显示 `v10.64`，日志没有新增预构建产物、数据库连接、存储过程或启动错误。进入“人工处理订单”验证：

- 列表可以按明细认账规则和状态筛选，“全部状态”位于明细认账规则筛选左侧，打开速度不随归档月表数量明显增长。
- 手动认账先选择支出资金来源，再选择或切换反馈类型时，支出资金来源不会清空，已选捐赠活动和到账户名保持不变，反馈类型片段同步更新。
- “操作原因”为正常字号、内容完整、列宽随内容自动调整，状态列固定在右侧。
- 已归档且未认账的已忽略/已转移明细可以进入原操作流程；已转移/已认账明细仍只读。
- 日期汇总订单明细显示“未认账（不包含待拆分）”，数量不包含待拆分明细，点击后只展示相同口径的订单。

## 测试服务器2部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.64-local.tar.gz \
  migrate-v10.64-manual-order-work-items.sql \
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
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon <<'SQL'
SELECT @@event_scheduler AS event_scheduler;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN (
    'bill_details',
    'bill_detail_archive_runs',
    'order_files',
    'recognition_tasks',
    'recognition_rules',
    'system_storage_snapshot'
  )
ORDER BY table_name;

SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = DATABASE()
  AND routine_type = 'PROCEDURE'
  AND routine_name IN (
    'archive_bill_details_daily',
    'archive_bill_details_daily_with_storage_request',
    'sync_archived_match_result_statuses'
  )
ORDER BY routine_name;

SELECT COUNT(*) AS manual_order_table_count
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = 'manual_order_work_items';

SELECT COUNT(*) AS manual_sync_column_count
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'bill_detail_archive_runs'
  AND column_name = 'manual_work_items_synced_at';

SELECT COUNT(*) AS running_archive_count
FROM bill_detail_archive_runs
WHERE status = 'processing';
SQL
```

必须同时满足：

- `event_scheduler` 为 `ON`。
- 依赖表返回 6 行，依赖过程返回 3 行。
- 从未执行 v10.64 迁移时，`manual_order_table_count` 和 `manual_sync_column_count` 都为 `0`。
- `running_archive_count` 为 `0`。

如果新增表或字段已经存在，不要重复执行迁移；直接按“迁移后检查”核对是否完整。新增表和字段只存在一部分时停止部署，先确认是否发生过中断迁移。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

确认应用已停止，并确认没有单独运行的上传、认账、分账或归档脚本。

### 5. 迁移

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.64-manual-order-work-items.sql
```

迁移结束时会输出人工处理订单三类状态数量、归档数量和最近 20 条归档同步时间。命令必须正常退出；不要在迁移执行中重启应用。

### 6. 迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon <<'SQL'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = 'manual_order_work_items';

SELECT column_name, column_type, is_nullable
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'bill_detail_archive_runs'
  AND column_name = 'manual_work_items_synced_at';

SELECT index_name, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS columns_in_index
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'manual_order_work_items'
GROUP BY index_name
ORDER BY index_name;

SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = DATABASE()
  AND routine_type = 'PROCEDURE'
  AND routine_name IN (
    'archive_bill_details_daily_with_storage_request',
    'sync_archived_manual_order_work_items',
    'sync_archived_match_result_statuses'
  )
ORDER BY routine_name;

SHOW CREATE PROCEDURE archive_bill_details_daily_with_storage_request;

SELECT
  COUNT(*) AS manual_order_count,
  SUM(display_status = 'ignored') AS ignored_count,
  SUM(display_status = 'transferred') AS transferred_count,
  SUM(display_status = 'transferred_recognized') AS transferred_recognized_count,
  SUM(storage_location = 'archive') AS archived_count
FROM manual_order_work_items;

SELECT COUNT(*) AS unsynced_completed_archive_count
FROM bill_detail_archive_runs
WHERE status = 'completed'
  AND completed_at IS NOT NULL
  AND (
    manual_work_items_synced_at IS NULL
    OR manual_work_items_synced_at < completed_at
  );
SQL
```

必须确认：

- 新增表和字段各返回 1 行。
- 索引检查只返回 `PRIMARY`、`mowi_summary_date_idx`、`mowi_status_date_idx`、`mowi_rule_status_date_idx` 共 4 行。
- 三个同步相关过程均存在。
- `SHOW CREATE PROCEDURE` 中依次保留 `archive_bill_details_daily()`、`sync_archived_match_result_statuses()`、`sync_archived_manual_order_work_items()` 和磁盘采集请求写入。
- `unsynced_completed_archive_count` 为 `0`。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.64-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
curl -fsS -H 'Accept: text/html' http://server2.example.com:3001/ > /dev/null
```

确认页面右上角显示 `v10.64`，两次 curl 均成功，日志没有新增预构建产物、数据库连接、存储过程或启动错误。进入“人工处理订单”验证：

- 列表可以按明细认账规则和状态筛选，“全部状态”位于明细认账规则筛选左侧，打开速度不随归档月表数量明显增长。
- 手动认账先选择支出资金来源，再选择或切换反馈类型时，支出资金来源不会清空，已选捐赠活动和到账户名保持不变，反馈类型片段同步更新。
- “操作原因”为正常字号、内容完整、列宽随内容自动调整，状态列固定在右侧。
- 已归档且未认账的已忽略/已转移明细可以进入原操作流程；已转移/已认账明细仍只读。
- 日期汇总订单明细显示“未认账（不包含待拆分）”，数量不包含待拆分明细，点击后只展示相同口径的订单。

## 风险与回退

- 首次历史回填读取既有归档表，执行时间取决于已完成归档日期和人工处理订单数量；迁移未结束前不要启动应用。
- 投影表只负责人工处理订单查询与归档定位，订单事实仍保存在 `bill_details` 或月归档表。
- 已归档明细恢复到热表后会由后续每日归档再次搬迁；排查时同时核对投影位置和订单事实位置。
- 如 v10.64 启动或人工处理订单操作异常，停止应用并使用 `releases/finance-platform-v10.63-local.tar.gz` 重新部署。
- 代码回退时保留 `manual_order_work_items`、新增同步字段和过程；v10.63 不读取这些结构，归档包装过程仍可完成增量位置同步。
- 不要只删除新增表或同步过程，否则当前归档包装过程会调用缺失过程并导致每日归档失败。
- 完全回退数据库必须先恢复 v10.63 的 `archive_bill_details_daily_with_storage_request` 定义，再删除新增过程、字段和表；应另行审核并在停机窗口执行。
