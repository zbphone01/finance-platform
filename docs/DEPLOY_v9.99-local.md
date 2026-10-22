# v9.99-local 部署说明

## 文件

- `releases/finance-platform-v9.99-local.tar.gz`：v9.99 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `migrate-v9.98-login-lockout.sql`：登录限速与账号锁定字段迁移
- `migrate-v9.99-two-factor-auth.sql`：验证器 App 字段迁移
- `docs/VERSION_SNAPSHOT_v9.99-local.md`：版本快照
- `migrate-v9.97-role-permissions.sql`：如果目标环境尚未部署 v9.97，需要先补执行该迁移

## 重要说明

- 本版替代 v9.97-local 部署包。
- 本版新增数据库迁移：`migrate-v9.98-login-lockout.sql`、`migrate-v9.99-two-factor-auth.sql`。
- 已部署 v9.97 的环境，部署 v9.99 代码前需要按顺序执行本版两个迁移。
- 如果目标环境尚未部署 v9.97，需要先执行 `migrate-v9.97-role-permissions.sql`，再执行本版迁移。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.99-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.98-login-lockout.sql \
  migrate-v9.99-two-factor-auth.sql \
  migrate-v9.97-role-permissions.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

执行迁移：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM users LIKE 'login_failed_attempts'; SHOW COLUMNS FROM users LIKE 'two_factor_enabled';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.98-login-lockout.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.99-two-factor-auth.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM users LIKE 'login_failed_attempts'; SHOW COLUMNS FROM users LIKE 'two_factor_enabled';"
```

部署：

```bash
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.99-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.99-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.98-login-lockout.sql \
  migrate-v9.99-two-factor-auth.sql \
  migrate-v9.97-role-permissions.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

执行迁移：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM users LIKE 'login_failed_attempts'; SHOW COLUMNS FROM users LIKE 'two_factor_enabled';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.98-login-lockout.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.99-two-factor-auth.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM users LIKE 'login_failed_attempts'; SHOW COLUMNS FROM users LIKE 'two_factor_enabled';"
```

部署：

```bash
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v9.99-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.99-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.99-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.99-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.99-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号应显示 `v9.99`。
- 未绑定验证器 App 的账号登录后应弹出绑定提示，并可选择稍后。
- 完成绑定后，重新登录应先输入用户名和密码，再输入验证器 App 动态验证码。
- 密码连续错误 3 次后账号应显示为已锁定，只能由管理员在账号管理页解锁。
- 账号管理页应展示验证器绑定状态，管理员可重置用户验证器绑定。

## 回退

- 代码可通过上一版部署包 `finance-platform-v9.97-local.tar.gz` 回退。
- 数据库字段为新增字段，通常可保留；如需完全回退，可在确认旧版代码运行稳定后删除本版新增的 `users` 表字段。
