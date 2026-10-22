# v9.80-local 部署说明

## 文件

- `releases/finance-platform-v9.80-local.tar.gz`：v9.80 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v9.80-local.md`：版本快照

## 重要说明

- 本版替代 v9.79-local 部署包；已部署 v9.79 的环境不需要执行数据库迁移。
- 本版功能重点是入账结果按日期取消批量制单。
- 本版部署脚本已支持测试服务器1和测试服务器2两套目录。
- 从 v9.78 或更旧版本升级时，先按 `docs/finance-recon-SKILL.md` 的“数据迁移”段补齐缺失迁移，再部署 v9.80 代码。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.80-local.tar.gz \
  deploy-update-optimized.sh \
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
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.80-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.80-local.tar.gz \
  deploy-update-optimized.sh \
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
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v9.80-local.tar.gz
```

测试服务器2如果浏览器直接打开 `http://server2.example.com:3001/` 出现 502，但终端 `curl` 正常，使用 SSH 隧道：

```bash
ssh -L 3001:127.0.0.1:3001 administrator@server2.example.com
```

然后打开 `http://127.0.0.1:3001/`。

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.80-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.80-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.80-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.80-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 打开“入账结果”。
- 选择某个全部已制单的日期，日期汇总列表操作按钮应显示“取消批量制单”。
- 点击并确认后，该日期下已制单入账结果应恢复为待制单。
- 日期汇总中的已制单/待制单数量应同步刷新。

## 回退

- 代码可通过上一版部署包 `finance-platform-v9.79-local.tar.gz` 回退。
- 本版不涉及数据库迁移，回退时不需要回滚数据库结构。
