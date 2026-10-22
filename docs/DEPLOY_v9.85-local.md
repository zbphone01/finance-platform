# v9.85-local 部署说明

## 文件

- `releases/finance-platform-v9.85-local.tar.gz`：v9.85 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `migrate-v9.85-counterparty-voucher-summary.sql`：v9.85 数据库迁移
- `docs/VERSION_SNAPSHOT_v9.85-local.md`：版本快照

## 重要说明

- 本版替代 v9.84-local 部署包。
- 本版新增数据库迁移；已部署 v9.84 的环境，部署代码前先执行 `migrate-v9.85-counterparty-voucher-summary.sql`。
- 该迁移会在 `counterparty_records` 增加 `voucher_summary_text` 字段，并删除旧 `voucher_summaries` 表。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.85-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.85-counterparty-voucher-summary.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

迁移：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform

mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM counterparty_records LIKE 'voucher_summary_text'; SHOW TABLES LIKE 'voucher_summaries';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.85-counterparty-voucher-summary.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM counterparty_records LIKE 'voucher_summary_text'; SHOW TABLES LIKE 'voucher_summaries';"
```

部署：

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.85-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.85-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.85-counterparty-voucher-summary.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

迁移：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform

mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM counterparty_records LIKE 'voucher_summary_text'; SHOW TABLES LIKE 'voucher_summaries';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.85-counterparty-voucher-summary.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM counterparty_records LIKE 'voucher_summary_text'; SHOW TABLES LIKE 'voucher_summaries';"
```

部署：

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v9.85-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.85-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.85-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.85-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.85-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- `入账结果` 菜单中的锁定文案应为认账结果锁定口径，不代表制单。
- `认账及分账 / 日期汇总` 的银行流水列表中，已认账流水应显示制单图标。
- 点击制单后状态应显示 `已认账/已制单`，并可选择查看制单或取消制单。
- 查看制单应进入整页表格，表格包含 `序号、摘要、科目编码、科目名称、借方金额、贷方金额`。
- 到账信息编辑弹窗顶部维护到账别称，底部维护制单摘要内容。

## 回退

- 代码可通过上一版部署包 `finance-platform-v9.84-local.tar.gz` 回退。
- 数据库回退需谨慎处理：本版迁移删除旧 `voucher_summaries` 表，并新增 `counterparty_records.voucher_summary_text` 字段。
