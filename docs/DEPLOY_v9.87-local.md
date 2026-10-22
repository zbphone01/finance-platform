# v9.87-local 部署说明

## 文件

- `releases/finance-platform-v9.87-local.tar.gz`：v9.87 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `migrate-v9.87-counterparty-voucher-income-name.sql`：v9.87 数据库迁移
- `migrate-v9.86-voucher-result-storage.sql`：从 v9.85 或更旧版本升级时需要先补齐
- `migrate-v9.85-counterparty-voucher-summary.sql`：从 v9.84 或更旧版本升级时需要先补齐
- `docs/VERSION_SNAPSHOT_v9.87-local.md`：版本快照

## 重要说明

- 本版替代 v9.86-local 部署包。
- 本版新增数据库迁移；已部署 v9.86 的环境，部署代码前先执行 `migrate-v9.87-counterparty-voucher-income-name.sql`。
- 从 v9.85 或更旧版本升级时，先执行 `migrate-v9.86-voucher-result-storage.sql`，再执行 `migrate-v9.87-counterparty-voucher-income-name.sql`。
- 从 v9.84 或更旧版本升级时，先执行 `migrate-v9.85-counterparty-voucher-summary.sql`、`migrate-v9.86-voucher-result-storage.sql`，再执行 v9.87 迁移。
- v9.87 迁移会给 `counterparty_records` 新增 `voucher_income_name` 字段。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.87-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.87-counterparty-voucher-income-name.sql \
  migrate-v9.86-voucher-result-storage.sql \
  migrate-v9.85-counterparty-voucher-summary.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

迁移：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform

mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM counterparty_records LIKE 'voucher_income_name';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.87-counterparty-voucher-income-name.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM counterparty_records LIKE 'voucher_income_name';"
```

部署：

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.87-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.87-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.87-counterparty-voucher-income-name.sql \
  migrate-v9.86-voucher-result-storage.sql \
  migrate-v9.85-counterparty-voucher-summary.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

迁移：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform

mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM counterparty_records LIKE 'voucher_income_name';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.87-counterparty-voucher-income-name.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM counterparty_records LIKE 'voucher_income_name';"
```

部署：

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v9.87-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.87-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.87-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.87-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.87-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 进入 `到账信息汇总`，未记录列表点击记录应进入整页记录表单。
- 已记录列表点击编辑应进入整页编辑表单，左上角返回为按钮样式。
- 到账别称、凭证收入名称、制单摘要内容应按新版布局展示。
- 认账类型、到账地区、明细匹配到账方式、明细包类型应各占独立模块；到账地区不显示说明文案。
- 保存凭证收入名称后，重新编辑应能回显。
- 上传大订单明细时，进度条应随服务器实际处理进度变化，并显示已处理行数。

## 回退

- 代码可通过上一版部署包 `finance-platform-v9.86-local.tar.gz` 回退。
- 数据库回退需谨慎处理：本版仅新增 `counterparty_records.voucher_income_name` 字段，若已维护凭证收入名称，不建议删除该字段。
