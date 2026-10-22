# v10.32-local 部署说明

## 文件

- `releases/finance-platform-v10.32-local.tar.gz`：v10.32 部署包
- `migrate-v10.32-manual-income-vouchers.sql`：手工凭证及同流水多凭证关联迁移
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.32-local.md`：版本快照

## 重要说明

- 从 v10.31 升级到 v10.32，必须先上传并执行 `migrate-v10.32-manual-income-vouchers.sql`，再部署 v10.32 代码包。
- 更旧环境必须先按历史部署说明补齐至 v10.31。
- 迁移会调整 `voucher_results` 和 `voucher_result_flows`；不需要安装新依赖，不执行 `drizzle schema push`。
- 迁移脚本不是可重复执行脚本；部署前必须先检查 `voucher_results.voucher_kind`。

## 本地迁移

```bash
cd /home/deploy/Documents/资金池认账
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM voucher_results WHERE Field IN ('voucher_kind','voucher_key','voucher_id_text','income_type','voucher_amount','creation_group_id'); SHOW INDEX FROM voucher_results WHERE Key_name IN ('vr_source_key_uq','vr_kind_idx','vr_creation_group_idx'); SHOW INDEX FROM voucher_result_flows WHERE Key_name IN ('vrf_flow_unique_idx','vrf_result_flow_unique_idx');"
if ! mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -N -B -e "SHOW COLUMNS FROM voucher_results LIKE 'voucher_kind';" | grep -q '^voucher_kind'; then
  mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v10.32-manual-income-vouchers.sql
fi
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM voucher_results WHERE Field IN ('voucher_kind','voucher_key','voucher_id_text','income_type','voucher_amount','creation_group_id'); SHOW INDEX FROM voucher_results WHERE Key_name IN ('vr_source_key_uq','vr_kind_idx','vr_creation_group_idx'); SHOW INDEX FROM voucher_result_flows WHERE Key_name IN ('vrf_flow_unique_idx','vrf_result_flow_unique_idx');"
```

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.32-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.32-manual-income-vouchers.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

迁移前检查、执行与复查：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM voucher_results WHERE Field IN ('voucher_kind','voucher_key','voucher_id_text','income_type','voucher_amount','creation_group_id'); SHOW INDEX FROM voucher_result_flows WHERE Key_name IN ('vrf_flow_unique_idx','vrf_result_flow_unique_idx');"
if ! mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW COLUMNS FROM voucher_results LIKE 'voucher_kind';" | grep -q '^voucher_kind'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.32-manual-income-vouchers.sql
fi
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM voucher_results WHERE Field IN ('voucher_kind','voucher_key','voucher_id_text','income_type','voucher_amount','creation_group_id'); SHOW INDEX FROM voucher_results WHERE Key_name IN ('vr_source_key_uq','vr_kind_idx','vr_creation_group_idx'); SHOW INDEX FROM voucher_result_flows WHERE Key_name IN ('vrf_flow_unique_idx','vrf_result_flow_unique_idx');"
```

部署：

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.32-local.tar.gz
pm2 status
pm2 logs finance-platform --lines 120
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.32-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.32-manual-income-vouchers.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

迁移前检查、执行、复查和部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM voucher_results WHERE Field IN ('voucher_kind','voucher_key','voucher_id_text','income_type','voucher_amount','creation_group_id'); SHOW INDEX FROM voucher_result_flows WHERE Key_name IN ('vrf_flow_unique_idx','vrf_result_flow_unique_idx');"
if ! mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW COLUMNS FROM voucher_results LIKE 'voucher_kind';" | grep -q '^voucher_kind'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.32-manual-income-vouchers.sql
fi
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM voucher_results WHERE Field IN ('voucher_kind','voucher_key','voucher_id_text','income_type','voucher_amount','creation_group_id'); SHOW INDEX FROM voucher_results WHERE Key_name IN ('vr_source_key_uq','vr_kind_idx','vr_creation_group_idx'); SHOW INDEX FROM voucher_result_flows WHERE Key_name IN ('vrf_flow_unique_idx','vrf_result_flow_unique_idx');"
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.32-local.tar.gz
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号显示 `v10.32`。
- 订单明细分片上传完成后弹窗关闭，页面显示解析和入库匹配两条后台进度。
- 刷新页面后未完成的后台上传继续显示，完成后自动刷新相关列表。
- 入账结果页可对到账认账、明细认账和两类手动认账执行整组取消；已锁定或已生成凭证的结果不允许取消。
- 订单明细手动认账页不显示“认账信息”标题和收款渠道选择，制单收款渠道取自明细规则关联的到账信息。
- 流水包含非模板收入时，制单弹窗逐类显示入账金额并要求填写文本凭证 ID；捐赠收入和会费收入仍自动生成凭证。
- 全部制单完成后状态显示“已认账/已制单”，不再显示星号状态。
- 凭证汇总中手工凭证显示文本凭证 ID 和类型金额，没有“查看凭证”，但可执行“取消手工凭证”。
- 日期汇总状态菜单可选择并取消单张手工凭证；取消后仅对应收入类型恢复待制单。
- 批量制单遇到需要文本凭证 ID 的流水时跳过并提示逐笔处理。

## 回退

- 代码可通过 v10.31 部署包回退，但数据库存在手工凭证数据时不能直接恢复旧唯一索引。
- 如需完全回退数据库，先备份并确认可删除 v10.32 手工凭证，再按下列步骤处理。

```sql
DELETE vrl
FROM voucher_result_lines vrl
JOIN voucher_results vr ON vr.id = vrl.voucher_result_id
WHERE vr.voucher_kind = 'manual';

DELETE vrf
FROM voucher_result_flows vrf
JOIN voucher_results vr ON vr.id = vrf.voucher_result_id
WHERE vr.voucher_kind = 'manual';

DELETE FROM voucher_results WHERE voucher_kind = 'manual';

SELECT bank_flow_id, COUNT(*) AS voucher_count
FROM voucher_result_flows
GROUP BY bank_flow_id
HAVING COUNT(*) > 1;

ALTER TABLE voucher_result_flows
  DROP INDEX vrf_result_flow_unique_idx,
  ADD UNIQUE KEY vrf_flow_unique_idx (bank_flow_id);

ALTER TABLE voucher_results
  DROP INDEX vr_source_key_uq,
  DROP INDEX vr_kind_idx,
  DROP INDEX vr_creation_group_idx,
  DROP COLUMN creation_group_id,
  DROP COLUMN voucher_amount,
  DROP COLUMN income_type,
  DROP COLUMN voucher_id_text,
  DROP COLUMN voucher_key,
  DROP COLUMN voucher_kind;
```

- `SELECT ... HAVING COUNT(*) > 1` 必须返回空结果后才能恢复 `vrf_flow_unique_idx`。
