# v10.33-local 部署说明

## 文件

- `releases/finance-platform-v10.33-local.tar.gz`：v10.33 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.33-local.md`：版本快照

## 重要说明

- 从 v10.32 升级到 v10.33 不需要执行 SQL 迁移，直接部署代码包。
- 从 v10.31 升级时，必须先执行 `migrate-v10.32-manual-income-vouchers.sql` 补齐 v10.32 数据库结构，再部署 v10.33。
- 更旧环境先按历史部署说明逐版补齐至 v10.32。
- 本版不新增依赖，不执行 `drizzle schema push`。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.33-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
df -h / /var/lib/mysql
./deploy-update-optimized.sh finance-platform-v10.33-local.tar.gz
pm2 status
pm2 logs finance-platform --lines 120
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.33-local.tar.gz \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
df -h / /var/lib/mysql
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.33-local.tar.gz
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

- 页面右上角版本号显示 `v10.33`。
- 日期汇总中订单异常金额的差额可点击；选择等额异常订单后自动重新认账。
- 汇总匹配覆盖多条关联流水时，关联流水同步显示“认账执行中”。
- 普通部分认账流水的待认账金额可点击，并能检索同规则的 T+1 已忽略订单。
- 等额选择并确认后，明细转移到目标流水且自动补认账；已有认账结果不受影响。
- 跨日转移后明细显示在目标日期分区；认账成功后显示已认账并按目标分区归档。
- 打包明细不显示转移入口，服务端也拒绝打包明细转移。

## 回退

- v10.33 没有数据库迁移；代码可直接使用 v10.32 部署包回退。
- 回退后 v10.33 已完成的 T+1 明细转移和认账属于业务数据，不会随代码回退自动撤销；如需恢复必须先核对相关流水、订单明细和入账结果，再按业务流程处理。
