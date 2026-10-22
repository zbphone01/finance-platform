# v10.42-local 部署说明

## 文件

- `releases/finance-platform-v10.42-local.tar.gz`：v10.42 部署包
- `migrate-v10.41-counterparty-match-summary.sql`：到账信息摘要匹配字段迁移
- `migrate-v10.42-latest-system-storage-snapshot.sql`：最新数据盘快照及归档事件迁移
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.42-local.md`：版本快照

## 重要说明

- 从 v10.40 升级到 v10.42，必须依次执行 v10.41、v10.42 迁移，再部署代码包。
- v10.41、v10.42 迁移脚本不要重复执行；执行前先用本文命令检查字段和快照表是否存在。
- 执行 v10.42 前必须确认 v10.31 的 `archive_bill_details_daily()` 已存在，并确认 MySQL `event_scheduler = ON`。
- 部署前用 `df -P /var/lib/mysql` 确认 MySQL 数据所在挂载点，并在目标项目 `.env` 中设置 `DATA_DISK_PATH`。路径必须能被 PM2 运行用户访问。
- 更旧环境先按历史部署说明补齐至 v10.40。
- 本版不新增 npm 依赖，不执行 `drizzle schema push`。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.42-local.tar.gz \
  migrate-v10.41-counterparty-match-summary.sql \
  migrate-v10.42-latest-system-storage-snapshot.sql \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

检查、迁移和部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
df -P /var/lib/mysql
grep '^DATA_DISK_PATH=' .env || true
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW VARIABLES LIKE 'event_scheduler'; SHOW PROCEDURE STATUS WHERE Db = DATABASE() AND Name = 'archive_bill_details_daily'; SHOW COLUMNS FROM counterparty_records LIKE 'summary'; SHOW TABLES LIKE 'system_storage_snapshot';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.41-counterparty-match-summary.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.42-latest-system-storage-snapshot.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM counterparty_records LIKE 'summary'; SHOW COLUMNS FROM counterparty_match_accounts LIKE 'summary'; SHOW COLUMNS FROM unrecorded_counterparties LIKE 'summary'; SHOW PROCEDURE STATUS WHERE Db = DATABASE() AND Name = 'archive_bill_details_daily_with_storage_request'; SHOW EVENTS LIKE 'ev_bill_details_archive_old_daily_partitions'; SELECT * FROM system_storage_snapshot WHERE id = 1;"
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.42-local.tar.gz
pm2 status
pm2 logs finance-platform --lines 120
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.42-local.tar.gz \
  migrate-v10.41-counterparty-match-summary.sql \
  migrate-v10.42-latest-system-storage-snapshot.sql \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

检查、迁移和部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
df -P /var/lib/mysql
grep '^DATA_DISK_PATH=' .env || true
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW VARIABLES LIKE 'event_scheduler'; SHOW PROCEDURE STATUS WHERE Db = DATABASE() AND Name = 'archive_bill_details_daily'; SHOW COLUMNS FROM counterparty_records LIKE 'summary'; SHOW TABLES LIKE 'system_storage_snapshot';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.41-counterparty-match-summary.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.42-latest-system-storage-snapshot.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM counterparty_records LIKE 'summary'; SHOW COLUMNS FROM counterparty_match_accounts LIKE 'summary'; SHOW COLUMNS FROM unrecorded_counterparties LIKE 'summary'; SHOW PROCEDURE STATUS WHERE Db = DATABASE() AND Name = 'archive_bill_details_daily_with_storage_request'; SHOW EVENTS LIKE 'ev_bill_details_archive_old_daily_partitions'; SELECT * FROM system_storage_snapshot WHERE id = 1;"
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.42-local.tar.gz
pm2 status
pm2 logs finance-platform --lines 120
```

## `.env` 配置

在两台服务器各自项目目录的 `.env` 中确认以下配置，值使用 `df -P /var/lib/mysql` 输出的挂载点：

```dotenv
DATA_DISK_PATH=/实际的数据盘挂载点
```

修改后必须通过上述部署脚本重启 PM2 服务，才能加载新配置。

## 功能验证

- 页面右上角版本号显示 `v10.42`。
- “账号管理”菜单显示为“管理员功能”，页面上方可切换“账号管理”和“系统信息”。
- “系统信息”展示数据盘使用量饼图；如尚无快照，等待下一次每日归档，或确认快照表状态和 Node 日志。
- 到账信息新增/编辑支持摘要关键字；银行流水摘要不包含关键字时不得命中该组条件。
- 进入银行到账手动认账后，选中行的差额金额列和状态列与整行保持相同蓝色背景。
- 查看凭证、取消凭证并重新生成后，凭证汇总和再次打开的凭证详情立即显示相同的新凭证 ID，无需等待 60 秒。

## 回退

- 代码可使用 v10.40 部署包回退；v10.41 新增摘要字段可保留，旧代码会忽略这些字段。
- v10.42 的快照表、包装过程和归档事件可保留；旧代码仍能完成原归档过程，但不会处理新的磁盘采集请求。
- 如回退后必须恢复原事件调用，可按 v10.31 部署说明重新创建直接调用 `archive_bill_details_daily()` 的归档事件。
- 回退不会删除已写入的摘要条件或最新磁盘快照；需要恢复业务数据时应使用部署前数据库备份。
