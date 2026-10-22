# v10.38-local 部署说明

## 文件

- `releases/finance-platform-v10.38-local.tar.gz`：v10.38 部署包
- `migrate-v10.37-order-file-upload-snapshot-rebuild.sql`：历史订单明细包上传快照重建
- `migrate-v10.38-detail-split-recognition-progress.sql`：明细分账后台阶段和任务进度字段
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.38-local.md`：版本快照

## 重要说明

- 从 v10.36 升级到 v10.38，必须依次执行 v10.37、v10.38 迁移，再部署代码包。
- v10.37 会扫描订单明细热表和全部月归档表并重建订单包快照，请在低峰期执行并观察 MySQL 读 IO；执行完成后再继续部署。
- v10.38 是轻量结构迁移；脚本不是重复执行脚本，字段已存在时不要再次执行。
- 更旧环境先按历史部署说明补齐至 v10.36。
- 本版不新增依赖，不执行 `drizzle schema push`。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.38-local.tar.gz \
  migrate-v10.37-order-file-upload-snapshot-rebuild.sql \
  migrate-v10.38-detail-split-recognition-progress.sql \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

检查、迁移和部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
df -h / /var/lib/mysql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT COUNT(*) AS package_count, COALESCE(SUM(entry_count), 0) AS entry_count FROM order_files WHERE upload_status IN ('completed','abnormal'); SHOW COLUMNS FROM detail_split_files LIKE 'recognition_phase';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.37-order-file-upload-snapshot-rebuild.sql
if ! mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW COLUMNS FROM detail_split_files LIKE 'recognition_phase';" | grep -q '^recognition_phase'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.38-detail-split-recognition-progress.sql
fi
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM detail_split_files WHERE Field IN ('recognition_phase','recognition_task_total','recognition_task_completed','recognition_failed_reason');"
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.38-local.tar.gz
pm2 status
pm2 logs finance-platform --lines 120
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.38-local.tar.gz \
  migrate-v10.37-order-file-upload-snapshot-rebuild.sql \
  migrate-v10.38-detail-split-recognition-progress.sql \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

检查、迁移和部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
df -h / /var/lib/mysql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT COUNT(*) AS package_count, COALESCE(SUM(entry_count), 0) AS entry_count FROM order_files WHERE upload_status IN ('completed','abnormal'); SHOW COLUMNS FROM detail_split_files LIKE 'recognition_phase';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.37-order-file-upload-snapshot-rebuild.sql
if ! mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW COLUMNS FROM detail_split_files LIKE 'recognition_phase';" | grep -q '^recognition_phase'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.38-detail-split-recognition-progress.sql
fi
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM detail_split_files WHERE Field IN ('recognition_phase','recognition_task_total','recognition_task_completed','recognition_failed_reason');"
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.38-local.tar.gz
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号显示 `v10.38`。
- 订单明细包详情列显示上传后的条数、收入和退款，不因忽略或转移变化；收入、退款文案不包含“金额”。
- 眼睛按钮提示“查看订单明细”；从明细页返回后仍停留在原订单明细包页码。
- 上传明细分账包后弹窗关闭，状态依次显示 `1/2 查找分账任务`、`2/2 明细分账认账中（1/N）`。
- 刷新明细分账包列表后，后台任务进度继续显示；认账完成后恢复业务状态和计数。
- 同日汇总任务执行明细分账时，匹配组内所有相关银行流水任务均显示“认账执行中”。
- 观察 MySQL，少量待拆分订单执行时不应再产生规则历史明细全表扫描。

## 回退

- 代码可使用 v10.36 部署包回退；`detail_split_files` 新增字段可保留，不影响旧代码。
- v10.37 已重建的订单包上传快照不会随代码回退自动恢复；如必须恢复旧动态口径，只能基于部署前数据库备份处理。
- 回退不会自动撤销已完成的忽略、转移、拆分认账或入账结果，需按业务流程单独核对。
