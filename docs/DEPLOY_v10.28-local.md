# v10.28-local 部署说明

## 文件

- `releases/finance-platform-v10.28-local.tar.gz`：v10.28 部署包
- `migrate-v10.28-drop-bill-details-redundant-columns.sql`：订单明细冗余字段删除迁移
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.28-local.md`：版本快照

## 重要说明

- 从 v10.27 升级到 v10.28，需要上传代码包和 v10.28 迁移脚本，先执行迁移，再部署代码包。
- 如果目标环境尚未部署 v10.27，需要先补齐 v10.26、v10.27 历史迁移。
- 本迁移会处理 `bill_details`、已有 `bill_details_archive_YYYYMM` 归档表和 `bill_detail_locator`。
- 迁移后订单明细金额只保留 `total_amount`；订单原始日期使用 `bill_date`；认账/到账归属日期使用 `partition_date`。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.28-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.28-drop-bill-details-redundant-columns.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

迁移前检查、执行和复查：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND (table_name = 'bill_details' OR table_name LIKE 'bill\\_details\\_archive\\_%' OR table_name = 'bill_detail_locator') AND column_name IN ('order_date','recognition_date','amount','quantity','unit_price','tax_amount','counterparty','category','matched_account_name') ORDER BY table_name, column_name;"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.28-drop-bill-details-redundant-columns.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND (table_name = 'bill_details' OR table_name LIKE 'bill\\_details\\_archive\\_%' OR table_name = 'bill_detail_locator') AND column_name IN ('order_date','recognition_date','amount','quantity','unit_price','tax_amount','counterparty','category','matched_account_name') ORDER BY table_name, column_name; SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns FROM information_schema.statistics WHERE table_schema = DATABASE() AND (table_name = 'bill_details' OR table_name LIKE 'bill\\_details\\_archive\\_%' OR table_name = 'bill_detail_locator') AND index_name IN ('bd_partition_status_idx','bd_operation_partition_idx','bdl_partition_lifecycle_idx') GROUP BY TABLE_NAME, INDEX_NAME ORDER BY TABLE_NAME, INDEX_NAME;"
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.28-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.28-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.28-drop-bill-details-redundant-columns.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

迁移前检查、执行和复查：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND (table_name = 'bill_details' OR table_name LIKE 'bill\\_details\\_archive\\_%' OR table_name = 'bill_detail_locator') AND column_name IN ('order_date','recognition_date','amount','quantity','unit_price','tax_amount','counterparty','category','matched_account_name') ORDER BY table_name, column_name;"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.28-drop-bill-details-redundant-columns.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND (table_name = 'bill_details' OR table_name LIKE 'bill\\_details\\_archive\\_%' OR table_name = 'bill_detail_locator') AND column_name IN ('order_date','recognition_date','amount','quantity','unit_price','tax_amount','counterparty','category','matched_account_name') ORDER BY table_name, column_name; SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columns FROM information_schema.statistics WHERE table_schema = DATABASE() AND (table_name = 'bill_details' OR table_name LIKE 'bill\\_details\\_archive\\_%' OR table_name = 'bill_detail_locator') AND index_name IN ('bd_partition_status_idx','bd_operation_partition_idx','bdl_partition_lifecycle_idx') GROUP BY TABLE_NAME, INDEX_NAME ORDER BY TABLE_NAME, INDEX_NAME;"
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.28-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.28-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.28-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.28-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.28-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号应显示 `v10.28`。
- 上传订单明细后，订单明细入库应正常完成，金额汇总仍使用 `total_amount`。
- 日期汇总详情、订单明细包详情、忽略明细列表和手动明细认账应正常读取订单金额。
- 已归档订单明细包从订单包列表直接打开时，应能正常显示明细，不应只查热表后显示为空。
- 迁移后复查被删除字段查询应返回空结果。
- 新索引 `bd_partition_status_idx`、`bd_operation_partition_idx`、`bdl_partition_lifecycle_idx` 应存在。

## 回退

- 代码可通过上一版部署包 `finance-platform-v10.27-local.tar.gz` 回退。
- 数据库结构如需回退，需要重新增加被删除列；其中业务仍依赖的口径可从现有字段恢复：
  - `amount` 可用 `total_amount` 回填。
  - `order_date` 可用 `bill_date` 回填。
  - `recognition_date` 可用 `partition_date` 回填。
- `quantity`、`unit_price`、`tax_amount`、`counterparty`、`category`、`matched_account_name` 是冗余或原始快照字段，当前业务不依赖；如需历史排查，优先从 `raw_data` 或 `order_files.matched_account_name` 读取。
