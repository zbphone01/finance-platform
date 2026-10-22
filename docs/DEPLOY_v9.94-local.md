# v9.94-local 部署说明

## 文件

- `releases/finance-platform-v9.94-local.tar.gz`：v9.94 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `migrate-v9.94-voucher-template-settings.sql`：本版新增数据库迁移
- `docs/VERSION_SNAPSHOT_v9.94-local.md`：版本快照

## 重要说明

- 本版替代 v9.93-local 部署包。
- 本版新增数据库迁移：`migrate-v9.94-voucher-template-settings.sql`。
- 已部署 v9.93 的环境升级到 v9.94 时，需要先执行 v9.94 迁移，再部署 v9.94 代码。
- 从 v9.88 或更旧版本升级时，需先补齐 v9.89 及历史缺失迁移，再执行 v9.94 迁移并部署 v9.94。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.94-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.94-voucher-template-settings.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

迁移：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'voucher_template_settings';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.94-voucher-template-settings.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'voucher_template_settings';"
```

部署：

```bash
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.94-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.94-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.94-voucher-template-settings.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

迁移：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'voucher_template_settings';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.94-voucher-template-settings.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'voucher_template_settings';"
```

部署：

```bash
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v9.94-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.94-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.94-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.94-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.94-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号应显示 `v9.94`。
- 左侧菜单应显示“财务凭证信息”，可编辑并保存凭证模板。
- 认账及分账中执行制单后，凭证应按模板生成，模板空列保持为空。
- 凭证汇总第一列应显示“凭证ID”，进入详情标题应显示“收入凭证 - ID”。
- 入账结果按天汇总列表应显示“入账条目数”和“已制单数”。
- 已制单入账明细状态列不应显示三点菜单，也不允许取消锁定。
- 到账信息中“凭证收入名称”不填写时，后续生成凭证应取到账别称。

## 回退

- 代码可通过上一版部署包 `finance-platform-v9.93-local.tar.gz` 回退。
- 本版新增 `voucher_template_settings` 表。若确认不再需要 v9.94 的凭证模板配置，可在回退后手动评估是否删除该表；常规代码回退不要求删除数据表。
