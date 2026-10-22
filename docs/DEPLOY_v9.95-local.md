# v9.95-local 部署说明

## 文件

- `releases/finance-platform-v9.95-local.tar.gz`：v9.95 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v9.95-local.md`：版本快照
- `migrate-v9.94-voucher-template-settings.sql`：如果目标环境尚未部署 v9.94，需要先补执行该迁移

## 重要说明

- 本版替代 v9.94-local 部署包。
- 本版没有新增数据库迁移。
- 已部署 v9.94 的环境可直接部署 v9.95 代码。
- 如果目标环境尚未部署 v9.94，需要先执行 `migrate-v9.94-voucher-template-settings.sql`，再部署 v9.95。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.95-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.94-voucher-template-settings.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

如目标环境尚未执行 v9.94 迁移，先执行：

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
./deploy-update-optimized.sh finance-platform-v9.95-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.95-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.94-voucher-template-settings.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

如目标环境尚未执行 v9.94 迁移，先执行：

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
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v9.95-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.95-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.95-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.95-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.95-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号应显示 `v9.95`。
- 认账及分账列表操作列中的制单 icon 应可点击。
- 点击制单 icon 后，应能对当日已认账未制单的银行流水批量生成凭证。
- 同日汇总场景下，多笔银行流水应关联同一张凭证，并都显示为已认账/已制单。
- 日期汇总详情中的银行流水列表应按每页 40 条分页。

## 回退

- 代码可通过上一版部署包 `finance-platform-v9.94-local.tar.gz` 回退。
- 本版没有新增数据库迁移，回退代码不需要执行额外数据库回滚。
