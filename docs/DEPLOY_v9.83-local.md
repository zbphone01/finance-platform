# v9.83-local 部署说明

## 文件

- `releases/finance-platform-v9.83-local.tar.gz`：v9.83 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `migrate-v9.82-voucher-summaries.sql`：v9.82 制单摘要表迁移
- `migrate-v9.83-match-result-order-detail-count-snapshot.sql`：v9.83 入账结果订单明细数快照迁移
- `docs/VERSION_SNAPSHOT_v9.83-local.md`：版本快照

## 重要说明

- 本版替代 v9.81-local 部署包。
- 已部署 v9.81 的环境，先执行 v9.82 和 v9.83 两个新增迁移，再部署代码。
- 本版新增 `财务信息设置 -> 制单摘要`，并在入账结果入账明细列表增加 `订单明细数`。
- 从 v9.79 或更旧版本升级时，先按 `docs/finance-recon-SKILL.md` 的“数据迁移”段补齐缺失迁移，再部署 v9.83 代码。

## 本地迁移检查

确认制单摘要表和入账结果订单明细数快照字段存在：

```bash
cd /home/deploy/Documents/资金池认账

mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW TABLES LIKE 'voucher_summaries'; SHOW COLUMNS FROM match_results LIKE 'order_detail_count_snapshot';"
```

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.83-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.83-match-result-order-detail-count-snapshot.sql \
  migrate-v9.82-voucher-summaries.sql \
  migrate-v9.79-refund-order-file-income-summary.sql \
  migrate-v9.78-refund-amount-snapshot.sql \
  migrate-v9.77-refund-order-rule-fields.sql \
  migrate-v9.74-finance-role.sql \
  migrate-v9.70-detail-split-rule-upload-fields.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform

mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.82-voucher-summaries.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.83-match-result-order-detail-count-snapshot.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'voucher_summaries'; SHOW COLUMNS FROM match_results LIKE 'order_detail_count_snapshot';"

chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.83-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.83-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.83-match-result-order-detail-count-snapshot.sql \
  migrate-v9.82-voucher-summaries.sql \
  migrate-v9.79-refund-order-file-income-summary.sql \
  migrate-v9.78-refund-amount-snapshot.sql \
  migrate-v9.77-refund-order-rule-fields.sql \
  migrate-v9.74-finance-role.sql \
  migrate-v9.70-detail-split-rule-upload-fields.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform

mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.82-voucher-summaries.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.83-match-result-order-detail-count-snapshot.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'voucher_summaries'; SHOW COLUMNS FROM match_results LIKE 'order_detail_count_snapshot';"

chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v9.83-local.tar.gz
```

测试服务器2如果浏览器直接打开 `http://server2.example.com:3001/` 出现 502，但终端 `curl` 正常，使用 SSH 隧道：

```bash
ssh -L 3001:127.0.0.1:3001 administrator@server2.example.com
```

然后打开 `http://127.0.0.1:3001/`。

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.83-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.83-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.83-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.83-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 左侧菜单中 `财务信息设置` 应可展开，并显示 `制单摘要`。
- 打开 `制单摘要`，应可选择已记录到账信息并维护摘要文案。
- 打开 `入账结果`，选择某个入账日期，入账明细列表应在 `入账金额` 左侧显示 `订单明细数`。
- 明细认账入账结果应显示实际订单明细数；到账认账和手动认账显示 `-`。
- 历史明细认账数据的 `订单明细数` 应通过迁移回填。

## 回退

- 代码可通过上一版部署包 `finance-platform-v9.81-local.tar.gz` 回退。
- 本版新增数据库表和字段；如需完全回滚数据库结构，应先确认没有使用制单摘要和订单明细数快照，再手动备份并删除 `voucher_summaries` 表和 `match_results.order_detail_count_snapshot` 字段。
