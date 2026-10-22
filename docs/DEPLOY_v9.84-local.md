# v9.84-local 部署说明

## 文件

- `releases/finance-platform-v9.84-local.tar.gz`：v9.84 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v9.84-local.md`：版本快照

## 重要说明

- 本版替代 v9.83-local 部署包。
- 本版不新增数据库迁移；已部署 v9.83 的环境可直接部署代码。
- 从 v9.81 或更旧版本升级时，仍需先执行 v9.82 / v9.83 迁移，再部署 v9.84 代码。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.84-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.83-match-result-order-detail-count-snapshot.sql \
  migrate-v9.82-voucher-summaries.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform

# 已部署 v9.83 的环境不需要重复执行迁移。
# 如从 v9.81 或更旧版本升级，先按需执行：
# mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.82-voucher-summaries.sql
# mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.83-match-result-order-detail-count-snapshot.sql

chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.84-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.84-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.83-match-result-order-detail-count-snapshot.sql \
  migrate-v9.82-voucher-summaries.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform

# 已部署 v9.83 的环境不需要重复执行迁移。
# 如从 v9.81 或更旧版本升级，先按需执行 v9.82 / v9.83 迁移。

chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v9.84-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.84-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.84-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.84-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.84-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 左下角当前用户区域点击钥匙图标，应可修改当前账号密码。
- `账号管理` 中点击编辑，应可修改单个账号角色和状态。
- `账号管理` 中点击重置密码，应生成 6 位英文数字混合密码，并弹窗显示和支持复制。
- 关闭条件认账的打包明细，多整包规则合计等于同一银行到账时，应生成多条入账结果并将流水标记已认账。

## 回退

- 代码可通过上一版部署包 `finance-platform-v9.83-local.tar.gz` 回退。
- 本版不新增数据库迁移，无新增数据库结构需要回滚。
