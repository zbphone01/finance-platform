# v9.86-local 部署说明

## 文件

- `releases/finance-platform-v9.86-local.tar.gz`：v9.86 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `migrate-v9.86-voucher-result-storage.sql`：v9.86 数据库迁移
- `migrate-v9.85-counterparty-voucher-summary.sql`：从 v9.84 或更旧版本升级时需要先补齐
- `docs/VERSION_SNAPSHOT_v9.86-local.md`：版本快照

## 重要说明

- 本版替代 v9.85-local 部署包。
- 本版新增数据库迁移；已部署 v9.85 的环境，部署代码前先执行 `migrate-v9.86-voucher-result-storage.sql`。
- 从 v9.84 或更旧版本升级时，先执行 `migrate-v9.85-counterparty-voucher-summary.sql`，再执行 `migrate-v9.86-voucher-result-storage.sql`。
- v9.86 迁移会新增三张制单结果表：`voucher_results`、`voucher_result_flows`、`voucher_result_lines`。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.86-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.86-voucher-result-storage.sql \
  migrate-v9.85-counterparty-voucher-summary.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

迁移：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform

mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'voucher_result%';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.86-voucher-result-storage.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'voucher_result%';"
```

部署：

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.86-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.86-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.86-voucher-result-storage.sql \
  migrate-v9.85-counterparty-voucher-summary.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

迁移：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform

mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'voucher_result%';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.86-voucher-result-storage.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'voucher_result%';"
```

部署：

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v9.86-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.86-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.86-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.86-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.86-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- `认账及分账 / 日期汇总` 的银行流水列表中，已认账流水应显示制单图标。
- 同日汇总匹配下，如果同组仍有未认账或部分认账，点击制单应弹窗提醒并阻止生成。
- 同日汇总匹配下，全部到账已认账后点击任意一条制单，应生成整体制单结果。
- 同组任意银行到账点击 `查看制单`，应展示同一份制单结果。
- 查看制单页顶部右侧应显示红色 `取消制单` 按钮。
- 取消制单后返回银行流水列表，相关银行到账应恢复为未制单状态。

## 回退

- 代码可通过上一版部署包 `finance-platform-v9.85-local.tar.gz` 回退。
- 数据库回退需谨慎处理：本版新增制单结果三张表，若已产生正式制单结果，不建议删除相关表。
