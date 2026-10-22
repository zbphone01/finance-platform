# v10.31-local 部署说明

## 文件

- `migrate-v10.31-bill-details-index-canary.sql`：订单明细去重影子索引和索引不可见灰度迁移
- `migrate-v10.31-recognized-order-backfill-archive.sql`：仅归档已认账订单并补归档历史已认账热表数据
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.31-local.md`：版本快照
- 发布时生成：`releases/finance-platform-v10.31-local.tar.gz`

## 重要说明

- 从 v10.30 升级到 v10.31，需要依次执行两个 v10.31 迁移，再部署代码包。
- 更旧环境必须先补齐 v10.26、v10.27、v10.28、v10.29、v10.30 历史迁移。
- 迁移会在 `bill_details` 上新增一个唯一索引。测试服务器1按当前数据估算约增加 374 MiB，构建期间有明显磁盘 IO，必须低峰期执行。
- 四个候选索引只改为 `INVISIBLE`，本版不会释放约 495.2 MiB 的索引空间，也不会减少写入维护成本。
- 新建归档月表会继承主表的影子唯一索引和候选索引可见性；现有归档月表只调整四个候选索引为 `INVISIBLE`，不补建影子唯一索引。
- 执行前必须确认没有长事务或长 SQL 占用 `bill_details`，并确认磁盘空间充足。
- 归档迁移不立即搬迁历史数据，只会重建每日 03:10 的归档事件和存储过程。新过程仅搬迁 `match_result_id IS NOT NULL` 的已认账行，未认账行继续留在热表。
- 每日先归档刚满 60 天日期的已认账行，再补归档一个更早且存在已认账热表行的日期。每 50000 行提交一个事务；首次补归档仍会产生持续的磁盘 IO，应持续观察 MySQL undo、磁盘和任务运行时间。
- 补归档不执行归档订单号滤重，也不因同日期、同规则、同包类型已有归档行而跳过；它按热表复合主键直接搬迁。任何主键或唯一键冲突都会回滚当前批次并保留热表数据。

## 本地迁移

```bash
cd /home/deploy/Documents/资金池认账
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW INDEX FROM bill_details WHERE Key_name IN ('bd_rule_partition_date_bill_no_uq','bd_rule_bill_date_bill_no_partition_uq','bd_status_idx','bd_original_task_idx','bd_lifecycle_package_idx','bd_operation_partition_idx');"
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v10.31-bill-details-index-canary.sql
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v10.31-recognized-order-backfill-archive.sql
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW INDEX FROM bill_details WHERE Key_name IN ('bd_rule_partition_date_bill_no_uq','bd_rule_bill_date_bill_no_partition_uq','bd_status_idx','bd_original_task_idx','bd_lifecycle_package_idx','bd_operation_partition_idx');"
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW EVENTS LIKE 'ev_bill_details_archive_old_daily_partitions'; SHOW CREATE PROCEDURE archive_bill_details_day; SHOW CREATE PROCEDURE archive_bill_details_daily;"
```

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.31-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.31-bill-details-index-canary.sql \
  migrate-v10.31-recognized-order-backfill-archive.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

迁移前检查：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
df -h / /var/lib/mysql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT ID, USER, HOST, DB, COMMAND, TIME, STATE, LEFT(INFO, 200) AS INFO FROM information_schema.processlist WHERE COMMAND <> 'Sleep' ORDER BY TIME DESC; SHOW INDEX FROM bill_details WHERE Key_name IN ('bd_rule_partition_date_bill_no_uq','bd_rule_bill_date_bill_no_partition_uq','bd_status_idx','bd_original_task_idx','bd_lifecycle_package_idx','bd_operation_partition_idx');"
```

执行和复查：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.31-bill-details-index-canary.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.31-recognized-order-backfill-archive.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW INDEX FROM bill_details WHERE Key_name IN ('bd_rule_partition_date_bill_no_uq','bd_rule_bill_date_bill_no_partition_uq','bd_status_idx','bd_original_task_idx','bd_lifecycle_package_idx','bd_operation_partition_idx');"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW EVENTS LIKE 'ev_bill_details_archive_old_daily_partitions'; SHOW CREATE PROCEDURE archive_bill_details_day; SHOW CREATE PROCEDURE archive_bill_details_daily;"
```

部署：

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.31-local.tar.gz
pm2 status
pm2 logs finance-platform --lines 120
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.31-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.31-bill-details-index-canary.sql \
  migrate-v10.31-recognized-order-backfill-archive.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

迁移前检查：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
df -h / /var/lib/mysql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT ID, USER, HOST, DB, COMMAND, TIME, STATE, LEFT(INFO, 200) AS INFO FROM information_schema.processlist WHERE COMMAND <> 'Sleep' ORDER BY TIME DESC; SHOW INDEX FROM bill_details WHERE Key_name IN ('bd_rule_partition_date_bill_no_uq','bd_rule_bill_date_bill_no_partition_uq','bd_status_idx','bd_original_task_idx','bd_lifecycle_package_idx','bd_operation_partition_idx');"
```

执行、复查和部署：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.31-bill-details-index-canary.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.31-recognized-order-backfill-archive.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW INDEX FROM bill_details WHERE Key_name IN ('bd_rule_partition_date_bill_no_uq','bd_rule_bill_date_bill_no_partition_uq','bd_status_idx','bd_original_task_idx','bd_lifecycle_package_idx','bd_operation_partition_idx');"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW EVENTS LIKE 'ev_bill_details_archive_old_daily_partitions'; SHOW CREATE PROCEDURE archive_bill_details_day; SHOW CREATE PROCEDURE archive_bill_details_daily;"
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.31-local.tar.gz
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号显示 `v10.31`。
- 同一订单文件重复上传不新增订单明细。
- 两个文件存在部分重复订单号时，只插入新增订单。
- 转移过归属日期的订单重新上传仍按重复订单跳过。
- 同日期、同规则、同包类型已存在归档订单时，历史文件中的该组合整组忽略；归档组合不存在时只执行热表和文件内滤重。
- 满 60 天日期归档后，`match_result_id IS NULL` 的未认账订单仍在热表且可以继续认账；已认账订单进入月归档表。
- 60 天前留在热表的订单后续完成认账后，下一次历史补归档能够直接进入已有月归档表；即使同组已有归档订单，也不会被上传滤重规则阻断。
- `bill_detail_archive_runs` 中归档快照应随每批补归档累计，失败批次保留热表数据并记录 `error_message`。
- 已认账且已归档的订单包按“订单日期/匹配日期 + 规则 + 包类型”删除后，入账结果和银行流水认账状态正确回滚，订单包及归档明细删除，并允许重新上传、重新认账。
- 订单包内容、未匹配/待拆分筛选、日期订单明细和已忽略订单列表正常。
- 明细认账、明细分账、转移和取消转移流程正常。

## 回退

候选索引立即恢复可见：

```sql
ALTER TABLE bill_details
  ALTER INDEX bd_status_idx VISIBLE,
  ALTER INDEX bd_original_task_idx VISIBLE,
  ALTER INDEX bd_lifecycle_package_idx VISIBLE,
  ALTER INDEX bd_operation_partition_idx VISIBLE;
```

影子唯一索引异常时先隐藏，旧唯一索引仍保持可见：

```sql
ALTER TABLE bill_details
  ALTER INDEX bd_rule_bill_date_bill_no_partition_uq INVISIBLE;
```

已有归档月表如需回退，按同样方式把四个候选索引恢复为 `VISIBLE`。本阶段不删除索引，不涉及数据恢复。

如补归档过程异常，先停用事件，避免继续执行；已经成功搬迁的数据继续保留在归档表，由现有热表+归档表混合读取逻辑正常读取：

```sql
ALTER EVENT ev_bill_details_archive_old_daily_partitions DISABLE;
```

不要直接恢复 v10.27 的整分区 `TRUNCATE PARTITION` 过程，否则会把仍未认账的历史订单一并移出热表。修复并重新执行 `migrate-v10.31-recognized-order-backfill-archive.sql` 后再启用事件：

```sql
ALTER EVENT ev_bill_details_archive_old_daily_partitions ENABLE;
```
