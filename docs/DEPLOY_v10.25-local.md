# v10.25-local 部署说明

## 文件

- `releases/finance-platform-v10.25-local.tar.gz`：v10.25 部署包
- `migrate-v10.24-drop-bd-order-pending-split-idx.sql`：删除被复合索引覆盖的订单包待拆分索引
- `migrate-v10.25-drop-bd-account-idx.sql`：删除当前前端搜索未使用的订单明细匹配账户名单列索引
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.25-local.md`：版本快照

## 重要说明

- 从 v10.23 升级到 v10.25，需要上传代码包和 v10.24、v10.25 两个迁移脚本，先按需执行迁移，再部署代码包。
- 如果目标环境尚未部署 v10.23，需要先按 v10.23 部署说明补齐历史迁移。
- 本地数据库已确认 `bd_order_pending_split_idx` 和 `bd_account_idx` 均已删除，`bd_order_rec_item_idx`、`bd_partition_rec_status_idx`、`bd_rule_detail_split_status_idx` 仍存在。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.25-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.24-drop-bd-order-pending-split-idx.sql \
  migrate-v10.25-drop-bd-account-idx.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

迁移前检查、执行和复查：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW INDEX FROM bill_details WHERE Key_name IN ('bd_order_pending_split_idx','bd_account_idx','bd_order_rec_item_idx','bd_partition_rec_status_idx','bd_rule_detail_split_status_idx');"
if mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW INDEX FROM bill_details WHERE Key_name='bd_order_pending_split_idx';" | grep -q '^bill_details'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.24-drop-bd-order-pending-split-idx.sql
fi
if mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW INDEX FROM bill_details WHERE Key_name='bd_account_idx';" | grep -q '^bill_details'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.25-drop-bd-account-idx.sql
fi
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW INDEX FROM bill_details WHERE Key_name IN ('bd_order_pending_split_idx','bd_account_idx','bd_order_rec_item_idx','bd_partition_rec_status_idx','bd_rule_detail_split_status_idx');"
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.25-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.25-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.24-drop-bd-order-pending-split-idx.sql \
  migrate-v10.25-drop-bd-account-idx.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

迁移前检查、执行和复查：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW INDEX FROM bill_details WHERE Key_name IN ('bd_order_pending_split_idx','bd_account_idx','bd_order_rec_item_idx','bd_partition_rec_status_idx','bd_rule_detail_split_status_idx');"
if mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW INDEX FROM bill_details WHERE Key_name='bd_order_pending_split_idx';" | grep -q '^bill_details'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.24-drop-bd-order-pending-split-idx.sql
fi
if mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW INDEX FROM bill_details WHERE Key_name='bd_account_idx';" | grep -q '^bill_details'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.25-drop-bd-account-idx.sql
fi
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW INDEX FROM bill_details WHERE Key_name IN ('bd_order_pending_split_idx','bd_account_idx','bd_order_rec_item_idx','bd_partition_rec_status_idx','bd_rule_detail_split_status_idx');"
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.25-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.25-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.25-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.25-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.25-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号应显示 `v10.25`。
- `bill_details` 中 `bd_order_pending_split_idx` 和 `bd_account_idx` 不存在。
- `bill_details` 中 `bd_order_rec_item_idx`、`bd_partition_rec_status_idx`、`bd_rule_detail_split_status_idx` 仍存在。
- 订单明细包列表、订单包详情、明细分账包详情、认账结果列表可正常打开。

## 回退

- 代码可通过上一版部署包 `finance-platform-v10.23-local.tar.gz` 回退。
- 如需回退数据库索引结构，可执行：

```sql
CREATE INDEX bd_order_pending_split_idx
  ON bill_details (order_file_id, match_status, match_result_id);

CREATE INDEX bd_account_idx
  ON bill_details (matched_account_name);
```
