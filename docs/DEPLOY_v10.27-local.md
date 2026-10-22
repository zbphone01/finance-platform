# v10.27-local 部署说明

## 文件

- `releases/finance-platform-v10.27-local.tar.gz`：v10.27 部署包
- `migrate-v10.26-order-detail-auto-partitions.sql`：订单明细未来日分区自动维护
- `migrate-v10.27-order-detail-monthly-archives.sql`：订单明细 60 天热数据月归档表
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.27-local.md`：版本快照

## 重要说明

- 从 v10.25 升级到 v10.27，需要上传代码包和 v10.26、v10.27 两个迁移脚本，先执行迁移，再部署代码包。
- 如果目标环境尚未部署 v10.25，需要先按 v10.25 部署说明补齐历史迁移。
- 两个迁移都依赖 MySQL Event Scheduler；执行前请确认 `event_scheduler=ON`。如果返回 `OFF`，需要先执行 `SET GLOBAL event_scheduler = ON;`，并建议在 MySQL 配置中持久化 `event_scheduler=ON`。
- v10.27 归档会每日 03:10 处理 `CURDATE() - INTERVAL 60 DAY` 的热表日分区，归档成功后清空热表对应日分区。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.27-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.26-order-detail-auto-partitions.sql \
  migrate-v10.27-order-detail-monthly-archives.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

迁移前检查、执行和复查：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW VARIABLES LIKE 'event_scheduler'; SHOW EVENTS LIKE 'ev_bill_details_next_month_partitions'; SHOW EVENTS LIKE 'ev_bill_details_archive_old_daily_partitions'; SHOW TABLES LIKE 'bill_detail_archive_runs'; SHOW TABLES LIKE 'bill_details_archive_%';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.26-order-detail-auto-partitions.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.27-order-detail-monthly-archives.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW EVENTS LIKE 'ev_bill_details_next_month_partitions'; SHOW EVENTS LIKE 'ev_bill_details_archive_old_daily_partitions'; SHOW TABLES LIKE 'bill_detail_archive_runs'; SHOW TABLES LIKE 'bill_details_archive_%'; SELECT archive_date, archive_table, partition_name, status, source_count, archive_count, error_message, completed_at FROM bill_detail_archive_runs ORDER BY archive_date DESC LIMIT 10;"
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.27-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.27-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.26-order-detail-auto-partitions.sql \
  migrate-v10.27-order-detail-monthly-archives.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

迁移前检查、执行和复查：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW VARIABLES LIKE 'event_scheduler'; SHOW EVENTS LIKE 'ev_bill_details_next_month_partitions'; SHOW EVENTS LIKE 'ev_bill_details_archive_old_daily_partitions'; SHOW TABLES LIKE 'bill_detail_archive_runs'; SHOW TABLES LIKE 'bill_details_archive_%';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.26-order-detail-auto-partitions.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.27-order-detail-monthly-archives.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW EVENTS LIKE 'ev_bill_details_next_month_partitions'; SHOW EVENTS LIKE 'ev_bill_details_archive_old_daily_partitions'; SHOW TABLES LIKE 'bill_detail_archive_runs'; SHOW TABLES LIKE 'bill_details_archive_%'; SELECT archive_date, archive_table, partition_name, status, source_count, archive_count, error_message, completed_at FROM bill_detail_archive_runs ORDER BY archive_date DESC LIMIT 10;"
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.27-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.27-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.27-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.27-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.27-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号应显示 `v10.27`。
- `SHOW EVENTS LIKE 'ev_bill_details_next_month_partitions';` 应能看到每月 5 日自动建未来日分区任务。
- `SHOW EVENTS LIKE 'ev_bill_details_archive_old_daily_partitions';` 应能看到每日 03:10 自动归档任务。
- `SHOW TABLES LIKE 'bill_details_archive_%';` 应能看到以目标日期前后月份创建的月归档表。
- 日期汇总详情中 60 天内订单明细应正常读取热表。
- 已归档日期在 `bill_detail_archive_runs.status='completed'` 后，日期汇总详情和订单明细包详情应能从对应月归档表读取明细。

## 回退

- 代码可通过上一版部署包 `finance-platform-v10.25-local.tar.gz` 回退。
- 如需暂停自动分区和归档任务，可执行：

```sql
DROP EVENT IF EXISTS ev_bill_details_next_month_partitions;
DROP EVENT IF EXISTS ev_bill_details_archive_old_daily_partitions;
```

- 如需删除存储过程，可执行：

```sql
DROP PROCEDURE IF EXISTS ensure_bill_details_next_month_partitions;
DROP PROCEDURE IF EXISTS ensure_bill_details_archive_month_table;
DROP PROCEDURE IF EXISTS ensure_bill_details_archive_tables_around;
DROP PROCEDURE IF EXISTS archive_bill_details_day;
DROP PROCEDURE IF EXISTS archive_bill_details_daily;
```

- 已归档的数据不会因删除 Event 或存储过程自动恢复；如需恢复某日数据，应先确认热表对应日分区存在，再从 `bill_details_archive_YYYYMM` 按 `partition_date` 插回 `bill_details`。
