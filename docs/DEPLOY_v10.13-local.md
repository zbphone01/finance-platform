# v10.13-local 部署说明

## 文件

- `releases/finance-platform-v10.13-local.tar.gz`：v10.13 部署包
- `migrate-v10.13-order-detail-partitioning.sql`：订单明细分区改造迁移
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.13-local.md`：版本快照

## 重要说明

- 从 v10.12 升级到 v10.13，需要上传代码包和迁移脚本，在维护窗口执行 `migrate-v10.13-order-detail-partitioning.sql`，最后部署代码包。
- 该迁移会新增 `bill_details` 日期语义字段、创建 `bill_detail_locator`，并把 `bill_details` 改为分区表，会重建大表；请先在测试环境预演。
- 如果目标环境尚未部署 v10.12，需要先按版本顺序补齐 v10.00、v10.01、v10.02、v10.11、v10.12 迁移。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.13-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.13-order-detail-partitioning.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

迁移前检查、执行和复查：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM bill_details LIKE 'partition_date'; SHOW TABLES LIKE 'bill_detail_locator';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.13-order-detail-partitioning.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM bill_details LIKE 'order_date'; SHOW COLUMNS FROM bill_details LIKE 'recognition_date'; SHOW COLUMNS FROM bill_details LIKE 'partition_date'; SHOW COLUMNS FROM bill_details LIKE 'lifecycle_status'; SHOW COLUMNS FROM bill_details LIKE 'original_recognition_date'; SHOW TABLES LIKE 'bill_detail_locator'; SELECT COUNT(*) AS bill_detail_locator_count FROM bill_detail_locator; SELECT COUNT(*) AS bill_details_partition_count FROM information_schema.partitions WHERE table_schema = DATABASE() AND table_name = 'bill_details' AND partition_name IS NOT NULL;"
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.13-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.13-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.13-order-detail-partitioning.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

迁移前检查、执行和复查：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM bill_details LIKE 'partition_date'; SHOW TABLES LIKE 'bill_detail_locator';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.13-order-detail-partitioning.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM bill_details LIKE 'order_date'; SHOW COLUMNS FROM bill_details LIKE 'recognition_date'; SHOW COLUMNS FROM bill_details LIKE 'partition_date'; SHOW COLUMNS FROM bill_details LIKE 'lifecycle_status'; SHOW COLUMNS FROM bill_details LIKE 'original_recognition_date'; SHOW TABLES LIKE 'bill_detail_locator'; SELECT COUNT(*) AS bill_detail_locator_count FROM bill_detail_locator; SELECT COUNT(*) AS bill_details_partition_count FROM information_schema.partitions WHERE table_schema = DATABASE() AND table_name = 'bill_details' AND partition_name IS NOT NULL;"
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.13-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.13-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.13-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.13-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.13-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号应显示 `v10.13`。
- `认账及分账 / 上传订单明细` 选择打包明细规则时，应显示选填 `到账日期`。
- 不填到账日期上传打包明细时，应自动匹配最早符合到账信息的未认账银行流水。
- 填写到账日期上传打包明细时，只应在指定日期查找到账，不应自动绑定其他日期。
- 订单明细上传、忽略、转移、取消转移和明细分账绑定后，`bill_detail_locator` 应同步对应明细。

## 回退

- 代码可通过上一版部署包 `finance-platform-v10.12-local.tar.gz` 回退。
- `bill_details` 已改为分区表，如需数据库结构回退，需要在维护窗口用备份或反向迁移恢复；不要直接删除分区字段或 locator 表。
