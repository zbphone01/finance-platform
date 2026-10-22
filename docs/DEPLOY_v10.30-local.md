# v10.30-local 部署说明

## 文件

- `releases/finance-platform-v10.30-local.tar.gz`：v10.30 部署包
- `migrate-v10.30-order-file-partitions.sql`：订单文件级分区定位表迁移
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.30-local.md`：版本快照

## 重要说明

- 从 v10.29 升级到 v10.30，需要上传代码包和 v10.30 迁移脚本，先执行迁移，再部署代码包。
- 如果目标环境尚未部署 v10.29，需要先补齐 v10.26、v10.27、v10.28、v10.29 历史迁移。
- 本迁移新增并回填 `order_file_partitions`，不删除旧 `bill_detail_locator`。
- v10.30 代码把订单明细大包入库和认账执行放入同一数据库重任务队列，降低高 IO 并发导致的大包入库失败风险。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.30-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.30-order-file-partitions.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

迁移前检查、执行和复查：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'order_file_partitions';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.30-order-file-partitions.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'order_file_partitions'; SHOW INDEX FROM order_file_partitions; SELECT COUNT(*) AS partition_rows, COALESCE(SUM(detail_count), 0) AS detail_count FROM order_file_partitions;"
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.30-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.30-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.30-order-file-partitions.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

迁移前检查、执行和复查：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'order_file_partitions';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.30-order-file-partitions.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'order_file_partitions'; SHOW INDEX FROM order_file_partitions; SELECT COUNT(*) AS partition_rows, COALESCE(SUM(detail_count), 0) AS detail_count FROM order_file_partitions;"
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.30-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.30-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.30-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.30-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.30-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号应显示 `v10.30`。
- 迁移后复查 `order_file_partitions` 表和 `ofp_pk`、`ofp_partition_date_idx` 索引存在。
- 上传订单明细大包时，分片完成后可进入“等待服务器排队/入库并匹配认账规则”流程。
- 认账执行中再上传订单明细大包时，入库和认账应串行执行，订单明细包列表最终显示入库完成。
- 订单明细包详情、删除、转移和取消转移流程应正常。

## 回退

- 代码可通过上一版部署包 `finance-platform-v10.29-local.tar.gz` 回退。
- 数据库如需回退，可保留 `order_file_partitions` 表不影响 v10.29；确认不再使用后再执行：

```sql
DROP TABLE IF EXISTS order_file_partitions;
```
