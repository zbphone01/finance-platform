# v9.89-local 部署说明

## 文件

- `releases/finance-platform-v9.89-local.tar.gz`：v9.89 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `migrate-v9.89-alipay-t1-recognition-index.sql`：v9.89 数据库索引迁移
- `docs/VERSION_SNAPSHOT_v9.89-local.md`：版本快照

## 重要说明

- 本版替代 v9.88-local 部署包。
- 本版新增数据库索引迁移，部署代码前请先执行 `migrate-v9.89-alipay-t1-recognition-index.sql`。
- 从 v9.87 或更旧版本升级时，需先补齐 v9.88 及历史缺失迁移，再部署 v9.89。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.89-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.89-alipay-t1-recognition-index.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

执行迁移：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.89-alipay-t1-recognition-index.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW INDEX FROM bill_details WHERE Key_name='bd_order_rec_item_idx';"
```

部署：

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.89-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.89-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.89-alipay-t1-recognition-index.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

执行迁移：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.89-alipay-t1-recognition-index.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW INDEX FROM bill_details WHERE Key_name='bd_order_rec_item_idx';"
```

部署：

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v9.89-local.tar.gz
```

## 异常处理

如果索引已存在，迁移会报重复索引名。可先检查：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW INDEX FROM bill_details WHERE Key_name='bd_order_rec_item_idx';"
```

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.89-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.89-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.89-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.89-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 上传或重新执行支付宝 T+1 大订单明细包认账，任务应正常进入认账执行。
- 数据库应存在 `bd_order_rec_item_idx` 索引。
- 认账执行中按规则项处理大包时，磁盘读写压力应较上一版下降。

## 回退

- 代码可通过上一版部署包 `finance-platform-v9.88-local.tar.gz` 回退。
- 索引迁移只新增索引，不改变业务数据。若必须回退索引，可执行：

```sql
DROP INDEX bd_order_rec_item_idx ON bill_details;
```
