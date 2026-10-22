# v9.69-local 部署说明

## 文件

- `releases/finance-platform-v9.69-local.tar.gz`：v9.69 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `migrate-v9.64-detail-split-entry-recognition.sql`：明细分账条目认账结构迁移
- `migrate-v9.65-detail-split-status-snapshot.sql`：明细分账状态快照迁移
- `migrate-v9.66-detail-split-order-source-status.sql`：来源订单已拆分状态修复
- `migrate-v9.67-detail-split-source-recognized-status.sql`：来源订单已认账状态修复
- `migrate-v9.68-release-orphan-detail-split-links.sql`：删除订单包后释放分账子明细绑定
- `migrate-v9.69-source-detail-summary-cache.sql`：来源订单明细汇总快照修复
- `docs/VERSION_SNAPSHOT_v9.69-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：项目技能文档，已更新到 v9.69

## 重要说明

- 本版替代 v9.65-local 部署包；线上部署时上传 v9.69 包即可。
- 首次部署明细分账新版能力时，必须先执行 v9.64、v9.65。
- 已部署过 v9.65 的环境，继续执行 v9.66、v9.67、v9.68、v9.69。
- v9.66-v9.69 均为可重复执行的状态/快照修复脚本；重复执行不会新增字段。
- 字段或索引已存在时不要重复执行 v9.64、v9.65 结构迁移，先用 `SHOW COLUMNS` 或 `SHOW INDEX` 检查。

## 本地迁移

```bash
cd /home/deploy/Documents/资金池认账

mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.64-detail-split-entry-recognition.sql
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.65-detail-split-status-snapshot.sql
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.66-detail-split-order-source-status.sql
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.67-detail-split-source-recognized-status.sql
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.68-release-orphan-detail-split-links.sql
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.69-source-detail-summary-cache.sql
```

复查：

```bash
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM detail_split_files LIKE 'recognition_keyword_field'; SHOW COLUMNS FROM detail_split_files LIKE 'pending_recognition_count'; SHOW COLUMNS FROM detail_split_files LIKE 'recognized_count'; SHOW INDEX FROM bill_details WHERE Key_name IN ('bd_rule_detail_split_status_idx', 'bd_order_pending_split_idx');"
```

## 线上部署

上传部署包、部署脚本和迁移脚本：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.69-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.64-detail-split-entry-recognition.sql \
  migrate-v9.65-detail-split-status-snapshot.sql \
  migrate-v9.66-detail-split-order-source-status.sql \
  migrate-v9.67-detail-split-source-recognized-status.sql \
  migrate-v9.68-release-orphan-detail-split-links.sql \
  migrate-v9.69-source-detail-summary-cache.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

登录服务器并执行迁移：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform

mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.64-detail-split-entry-recognition.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.65-detail-split-status-snapshot.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.66-detail-split-order-source-status.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.67-detail-split-source-recognized-status.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.68-release-orphan-detail-split-links.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.69-source-detail-summary-cache.sql
```

部署代码：

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.69-local.tar.gz
```

如果服务器依赖状态异常：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.69-local.tar.gz
```

如需在线上强制执行类型检查：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.69-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 明细分账包开始拆分认账时，应显示“认账执行中”并禁用其他操作。
- 删除已拆分的订单明细包后，重新上传同类待拆分订单包，应能复用原明细分账包开始拆分认账。
- 订单明细包列表“详情”应分两行显示条数和金额，状态显示“入库完成”。
- 日期汇总顶部订单明细条数不应包含明细分账子明细。
- 日期汇总订单明细状态筛选应为下拉框。
