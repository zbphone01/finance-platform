# v10.34-local 部署说明

## 文件

- `releases/finance-platform-v10.34-local.tar.gz`：v10.34 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.34-local.md`：版本快照

## 重要说明

- 从 v10.33 或 v10.32 升级到 v10.34 不需要执行 SQL 迁移，直接部署代码包。
- 从 v10.31 升级时，必须先执行 `migrate-v10.32-manual-income-vouchers.sql` 补齐 v10.32 数据库结构，再部署 v10.34。
- 更旧环境先按历史部署说明逐版补齐至 v10.32。
- 本版不新增依赖，不执行 `drizzle schema push`。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.34-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
df -h / /var/lib/mysql
./deploy-update-optimized.sh finance-platform-v10.34-local.tar.gz
pm2 status
pm2 logs finance-platform --lines 120
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.34-local.tar.gz \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
df -h / /var/lib/mysql
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.34-local.tar.gz
pm2 status
pm2 logs finance-platform --lines 120
```

## v10.31 环境补迁移

只有尚未部署 v10.32 的环境需要执行本节。先按目标服务器上传迁移脚本，再执行检查、迁移与复查。

测试服务器1上传：

```bash
cd /home/deploy/Documents/资金池认账
scp migrate-v10.32-manual-income-vouchers.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

测试服务器1：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM voucher_results WHERE Field IN ('voucher_kind','voucher_key','voucher_id_text','income_type','voucher_amount','creation_group_id'); SHOW INDEX FROM voucher_result_flows WHERE Key_name IN ('vrf_flow_unique_idx','vrf_result_flow_unique_idx');"
if ! mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW COLUMNS FROM voucher_results LIKE 'voucher_kind';" | grep -q '^voucher_kind'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.32-manual-income-vouchers.sql
fi
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM voucher_results WHERE Field IN ('voucher_kind','voucher_key','voucher_id_text','income_type','voucher_amount','creation_group_id'); SHOW INDEX FROM voucher_results WHERE Key_name IN ('vr_source_key_uq','vr_kind_idx','vr_creation_group_idx'); SHOW INDEX FROM voucher_result_flows WHERE Key_name IN ('vrf_flow_unique_idx','vrf_result_flow_unique_idx');"
```

测试服务器2上传：

```bash
cd /home/deploy/Documents/资金池认账
scp migrate-v10.32-manual-income-vouchers.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

测试服务器2：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM voucher_results WHERE Field IN ('voucher_kind','voucher_key','voucher_id_text','income_type','voucher_amount','creation_group_id'); SHOW INDEX FROM voucher_result_flows WHERE Key_name IN ('vrf_flow_unique_idx','vrf_result_flow_unique_idx');"
if ! mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW COLUMNS FROM voucher_results LIKE 'voucher_kind';" | grep -q '^voucher_kind'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.32-manual-income-vouchers.sql
fi
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM voucher_results WHERE Field IN ('voucher_kind','voucher_key','voucher_id_text','income_type','voucher_amount','creation_group_id'); SHOW INDEX FROM voucher_results WHERE Key_name IN ('vr_source_key_uq','vr_kind_idx','vr_creation_group_idx'); SHOW INDEX FROM voucher_result_flows WHERE Key_name IN ('vrf_flow_unique_idx','vrf_result_flow_unique_idx');"
```

## 功能验证

- 页面右上角版本号显示 `v10.34`。
- 日期汇总的订单明细列表不显示已忽略订单，独立“已忽略订单”列表仍可查看和操作。
- 日期汇总订单明细状态筛选不再显示“已忽略”和“已转移”。
- 跨日转移的 T+1 订单显示在目标日期明细中，第一列仍显示原始订单日期。
- 选择“转入本日”后，列表只显示转入当前日期的 T+1 订单，同时包含已认账和未认账记录。
- 已转移但尚未认账的订单继续进入“未认账”筛选。

## 回退

- v10.34 没有数据库迁移；代码可直接使用 v10.33 部署包回退。
- 回退后日期汇总订单明细恢复 v10.33 的展示和筛选口径，不会修改或回滚已有业务数据。
