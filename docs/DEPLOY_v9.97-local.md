# v9.97-local 部署说明

## 文件

- `releases/finance-platform-v9.97-local.tar.gz`：v9.97 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `migrate-v9.97-role-permissions.sql`：v9.97 数据库迁移
- `docs/VERSION_SNAPSHOT_v9.97-local.md`：版本快照
- `migrate-v9.94-voucher-template-settings.sql`：如果目标环境尚未部署 v9.94，需要先补执行该迁移

## 重要说明

- 本版替代 v9.96-local 部署包。
- 本版新增数据库迁移：`migrate-v9.97-role-permissions.sql`。
- 已部署 v9.96 的环境，部署 v9.97 代码前需要先执行 v9.97 迁移。
- 如果目标环境尚未部署 v9.94，需要先执行 `migrate-v9.94-voucher-template-settings.sql`，再按版本顺序补齐后续迁移。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.97-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.97-role-permissions.sql \
  migrate-v9.94-voucher-template-settings.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

执行 v9.97 迁移：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'role_permissions';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.97-role-permissions.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'role_permissions';"
```

部署：

```bash
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.97-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.97-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.97-role-permissions.sql \
  migrate-v9.94-voucher-template-settings.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

执行 v9.97 迁移：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'role_permissions';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.97-role-permissions.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'role_permissions';"
```

部署：

```bash
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v9.97-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.97-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.97-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.97-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.97-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号应显示 `v9.97`。
- 账号管理页中，管理员应能维护运营人员和财务人员的权限配置。
- 被关闭权限的角色不应看到对应菜单，相关操作按钮应禁用或不可执行。
- 财务人员默认可执行制单；运营人员默认不可制单。
- 凭证汇总列表中，同日汇总凭证的银行流水列应显示真实流水号列表。

## 回退

- 代码可通过上一版部署包 `finance-platform-v9.96-local.tar.gz` 回退。
- 如需数据库回退，可删除 `role_permissions` 表；回退前先确认线上没有依赖该表的新版代码运行。
