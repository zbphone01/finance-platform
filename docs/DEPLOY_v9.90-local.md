# v9.90-local 部署说明

## 文件

- `releases/finance-platform-v9.90-local.tar.gz`：v9.90 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v9.90-local.md`：版本快照

## 重要说明

- 本版替代 v9.89-local 部署包。
- 本版没有新增数据库迁移。
- 如果当前环境尚未部署 v9.89，需要先执行 `migrate-v9.89-alipay-t1-recognition-index.sql`，再部署 v9.90。
- 从 v9.88 或更旧版本升级时，需先补齐 v9.89 及历史缺失迁移，再部署 v9.90。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.90-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.90-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.90-local.tar.gz \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v9.90-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.90-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.90-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.90-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.90-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号应显示 `v9.90`。
- 2026-06-11 支付宝 T+1 同日汇总明细认账重新执行后，`801623518939` 这类被累计金额部分覆盖的银行到账应显示为部分认账。
- 同日汇总匹配下，日期汇总顶部订单异常金额不应重复累计同一规则下多笔银行到账共享的差额。
- 无银行流水的 T+1 明细认账任务应保持待认账。

## 回退

- 代码可通过上一版部署包 `finance-platform-v9.89-local.tar.gz` 回退。
- 本版没有新增数据库迁移，回退代码不需要执行额外数据库回滚。
