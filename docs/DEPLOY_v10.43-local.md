# v10.43-local 部署说明

## 文件

- `releases/finance-platform-v10.43-local.tar.gz`：v10.43 部署包
- `migrate-v10.41-counterparty-match-summary.sql`：v10.40 环境升级时的前置迁移
- `migrate-v10.42-latest-system-storage-snapshot.sql`：v10.40 环境升级时的前置迁移
- `migrate-v10.43-bill-details-rolling-hot-partitions.sql`：全量历史归档与滚动热分区迁移
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.43-local.md`：版本快照

## 重要说明

- 从 v10.42 升级必须先在维护窗口执行 v10.43 迁移，再部署代码包。
- 从 v10.40 升级必须先依次执行 v10.41、v10.42 迁移，再执行 v10.43。
- 首次执行 v10.43 会归档全部 60 天前订单明细并重组 `bill_details` 分区，可能产生明显磁盘 IO 和 DDL 等待。
- 迁移前必须确认 `event_scheduler=ON`、v10.27 月归档过程存在、60 天前没有 processing 认账任务或明细分账任务。
- 建议停止 PM2 应用或进入业务维护状态，并完成数据库备份或云盘快照。
- 部署脚本不会自动执行 SQL；构建完成后会校验并补建缺失的 MySQL Event。迁移未完成时部署会停止。
- 检查、停止服务、备份、迁移、部署和验证必须逐步执行；每一步返回 shell 提示符并确认结果后再进入下一步，不要把多个阶段用 `&&` 或一次粘贴串联。
- 本版不新增 npm 依赖，不执行 `drizzle schema push`。

## 测试服务器1部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.43-local.tar.gz \
  migrate-v10.41-counterparty-match-summary.sql \
  migrate-v10.42-latest-system-storage-snapshot.sql \
  migrate-v10.43-bill-details-rolling-hot-partitions.sql \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 登录服务器并检查文件

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
sha256sum finance-platform-v10.43-local.tar.gz
ls -lh migrate-v10.43-bill-details-rolling-hot-partitions.sql deploy-update-optimized.sh
```

发布包 SHA-256 应与交付时提供的值一致，再继续下一步。

### 3. 迁移前检查

```bash
df -P /var/lib/mysql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW VARIABLES LIKE 'event_scheduler'; SHOW PROCEDURE STATUS WHERE Db = DATABASE() AND Name IN ('ensure_bill_details_archive_tables_around','archive_bill_details_daily','archive_bill_details_daily_with_storage_request'); SELECT COUNT(*) AS old_processing_tasks FROM recognition_tasks WHERE bill_date <= DATE_SUB(CURDATE(), INTERVAL 60 DAY) AND status = 'processing'; SELECT COUNT(*) AS old_processing_split_rows FROM bill_details bd INNER JOIN detail_split_files dsf ON dsf.id = bd.detail_split_file_id WHERE bd.partition_date <= DATE_SUB(CURDATE(), INTERVAL 60 DAY) AND (dsf.upload_status = 'processing' OR dsf.recognition_phase IN ('finding_tasks','recognizing'));"
```

确认 `event_scheduler=ON`、月归档过程存在，并且两个 processing 数量均为 0。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 备份数据库

```bash
backup_file="backup_before_v10.43_$(date +%Y%m%d_%H%M%S).sql"
echo "$backup_file"
mysqldump --protocol=TCP -h localhost -u finance_user -p --no-tablespaces --single-transaction --quick --routines --events --triggers finance_recon > "$backup_file"
```

`mysqldump` 正常执行时可能只显示密码警告，之后长时间没有输出。等待命令结束并重新出现 shell 提示符，不要在备份期间执行迁移。

### 6. 检查备份

```bash
backup_file=$(ls -1t backup_before_v10.43_*.sql | head -1)
ls -lh "$backup_file"
tail -n 5 "$backup_file"
grep -- "-- Dump completed on" "$backup_file"
```

必须看到 `-- Dump completed on ...`，否则该文件不能用于恢复，不得继续迁移。

### 7. 执行数据库迁移

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.43-bill-details-rolling-hot-partitions.sql
```

等待迁移命令结束并返回 shell 提示符，再进行检查。

### 8. 迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW PROCEDURE STATUS WHERE Db = DATABASE() AND Name IN ('ensure_bill_details_rolling_partitions','archive_bill_details_day','archive_bill_details_daily','archive_bill_details_daily_with_storage_request'); SHOW EVENTS WHERE Db = DATABASE() AND Name IN ('ev_bill_details_rolling_partitions','ev_bill_details_archive_old_daily_partitions'); SELECT partition_name, partition_description, table_rows FROM information_schema.partitions WHERE table_schema = DATABASE() AND table_name = 'bill_details' ORDER BY partition_ordinal_position; SELECT archive_date, archive_table, status, source_count, archive_count, source_total, archive_total, error_message, completed_at FROM bill_detail_archive_runs ORDER BY archive_date DESC LIMIT 20;"
```

### 9. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.43-local.tar.gz
```

### 10. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
```

## 测试服务器2部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.43-local.tar.gz \
  migrate-v10.41-counterparty-match-summary.sql \
  migrate-v10.42-latest-system-storage-snapshot.sql \
  migrate-v10.43-bill-details-rolling-hot-partitions.sql \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

### 2. 登录服务器并检查文件

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
sha256sum finance-platform-v10.43-local.tar.gz
ls -lh migrate-v10.43-bill-details-rolling-hot-partitions.sql deploy-update-optimized.sh
```

发布包 SHA-256 应与交付时提供的值一致，再继续下一步。

### 3. 迁移前检查

```bash
df -P /var/lib/mysql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW VARIABLES LIKE 'event_scheduler'; SHOW PROCEDURE STATUS WHERE Db = DATABASE() AND Name IN ('ensure_bill_details_archive_tables_around','archive_bill_details_daily','archive_bill_details_daily_with_storage_request'); SELECT COUNT(*) AS old_processing_tasks FROM recognition_tasks WHERE bill_date <= DATE_SUB(CURDATE(), INTERVAL 60 DAY) AND status = 'processing'; SELECT COUNT(*) AS old_processing_split_rows FROM bill_details bd INNER JOIN detail_split_files dsf ON dsf.id = bd.detail_split_file_id WHERE bd.partition_date <= DATE_SUB(CURDATE(), INTERVAL 60 DAY) AND (dsf.upload_status = 'processing' OR dsf.recognition_phase IN ('finding_tasks','recognizing'));"
```

确认 `event_scheduler=ON`、月归档过程存在，并且两个 processing 数量均为 0。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 备份数据库

```bash
backup_file="backup_before_v10.43_$(date +%Y%m%d_%H%M%S).sql"
echo "$backup_file"
mysqldump --protocol=TCP -h localhost -u finance_user -p --no-tablespaces --single-transaction --quick --routines --events --triggers finance_recon > "$backup_file"
```

`mysqldump` 正常执行时可能只显示密码警告，之后长时间没有输出。等待命令结束并重新出现 shell 提示符，不要在备份期间执行迁移。

### 6. 检查备份

```bash
backup_file=$(ls -1t backup_before_v10.43_*.sql | head -1)
ls -lh "$backup_file"
tail -n 5 "$backup_file"
grep -- "-- Dump completed on" "$backup_file"
```

必须看到 `-- Dump completed on ...`，否则该文件不能用于恢复，不得继续迁移。

### 7. 执行数据库迁移

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.43-bill-details-rolling-hot-partitions.sql
```

等待迁移命令结束并返回 shell 提示符，再进行检查。

### 8. 迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW PROCEDURE STATUS WHERE Db = DATABASE() AND Name IN ('ensure_bill_details_rolling_partitions','archive_bill_details_day','archive_bill_details_daily','archive_bill_details_daily_with_storage_request'); SHOW EVENTS WHERE Db = DATABASE() AND Name IN ('ev_bill_details_rolling_partitions','ev_bill_details_archive_old_daily_partitions'); SELECT partition_name, partition_description, table_rows FROM information_schema.partitions WHERE table_schema = DATABASE() AND table_name = 'bill_details' ORDER BY partition_ordinal_position; SELECT archive_date, archive_table, status, source_count, archive_count, source_total, archive_total, error_message, completed_at FROM bill_detail_archive_runs ORDER BY archive_date DESC LIMIT 20;"
```

### 9. 部署代码

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.43-local.tar.gz
```

### 10. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号显示 `v10.43`。
- 日期汇总详情中，T+1 第一列显示“订单日期”，打包明细第一列显示“匹配日期”。
- 已归档历史明细带“已归档”标识，不能忽略、转移或删除归档分账包。
- 普通归档未认账明细可执行单条手动认账，并可通过统一取消认账入口回滚。
- 同一到账汇总组全部认账结果已制单时，组内流水均正确显示“已制单”。
- 修改明细认账规则后重新执行认账，旧规则项引用能够按最新规则重新匹配。
- `npm run --silent db:events:ensure -- --check-only` 返回两个 Event 校验通过。
- `system_storage_snapshot` 在归档成功后产生新的采集请求，Node 服务更新数据盘使用量。

## Event 创建阶段中断后的续跑

如果 v10.43 已完成历史归档和 `p_late` 初始化，但在创建 Event 时出现 `Illegal mix of collations`：

不要重复执行旧版迁移文件，也不要手工移动归档数据。按以下独立步骤续跑。

### 1. 检查当前数据库状态

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW PROCEDURE STATUS WHERE Db = DATABASE() AND Name IN ('ensure_bill_details_rolling_partitions','archive_bill_details_day','archive_bill_details_daily','archive_bill_details_daily_with_storage_request'); SHOW EVENTS WHERE Db = DATABASE() AND Name IN ('ev_bill_details_rolling_partitions','ev_bill_details_archive_old_daily_partitions'); SELECT partition_name, partition_description FROM information_schema.partitions WHERE table_schema = DATABASE() AND table_name = 'bill_details' AND partition_name IN ('p_late','p_future');"
```

确认存储过程和 `p_late`、`p_future` 已存在。两个 Event 可以暂时缺失。

### 2. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 3. 备份当前数据库状态

```bash
backup_file="backup_after_v10.43_partial_$(date +%Y%m%d_%H%M%S).sql"
echo "$backup_file"
mysqldump --protocol=TCP -h localhost -u finance_user -p --no-tablespaces --single-transaction --quick --routines --events --triggers finance_recon > "$backup_file"
```

等待命令结束并返回 shell 提示符。

### 4. 检查备份

```bash
backup_file=$(ls -1t backup_after_v10.43_partial_*.sql | head -1)
ls -lh "$backup_file"
tail -n 5 "$backup_file"
grep -- "-- Dump completed on" "$backup_file"
```

### 5. 直接部署修正版代码

测试服务器1：

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.43-local.tar.gz
```

测试服务器2：

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.43-local.tar.gz
```

不要再执行 `migrate-v10.43-bill-details-rolling-hot-partitions.sql`。部署脚本第 8 步会根据现有存储过程和分区结构补建两个缺失 Event。

### 6. 最终检查

```bash
npm run --silent db:events:ensure -- --check-only
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW EVENTS WHERE Db = DATABASE() AND Name IN ('ev_bill_details_rolling_partitions','ev_bill_details_archive_old_daily_partitions'); SELECT archive_date, archive_table, status, source_count, archive_count, source_total, archive_total, error_message, completed_at FROM bill_detail_archive_runs ORDER BY archive_date DESC LIMIT 20;"
pm2 status
```

## 回退

- 代码可使用 `finance-platform-v10.42-local.tar.gz` 回退。
- v10.43 已完成的数据归档和分区 DDL 不能通过回退代码撤销；如必须恢复旧分区结构，应停止应用和 Event，并从迁移前数据库备份恢复。
- 如果迁移执行中断，先保持应用停止，检查 `bill_detail_archive_runs`、存储过程和 Event 状态；修复阻塞原因后优先重跑同一迁移。
