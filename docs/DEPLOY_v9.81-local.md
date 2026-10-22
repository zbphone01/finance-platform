# v9.81-local 部署说明

## 文件

- `releases/finance-platform-v9.81-local.tar.gz`：v9.81 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v9.81-local.md`：版本快照

## 重要说明

- 本版替代 v9.80-local 部署包；已部署 v9.80 的环境不需要执行数据库迁移。
- 本版功能重点是制单相关入口占位、制单结果菜单占位、财务信息设置菜单占位，以及入账结果锁定文案调整。
- 本版部署脚本继续支持测试服务器1和测试服务器2两套目录。
- 从 v9.79 或更旧版本升级时，先按 `docs/finance-recon-SKILL.md` 的“数据迁移”段补齐缺失迁移，再部署 v9.81 代码。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.81-local.tar.gz \
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
./deploy-update-optimized.sh finance-platform-v9.81-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.81-local.tar.gz \
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
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v9.81-local.tar.gz
```

测试服务器2如果浏览器直接打开 `http://server2.example.com:3001/` 出现 502，但终端 `curl` 正常，使用 SSH 隧道：

```bash
ssh -L 3001:127.0.0.1:3001 administrator@server2.example.com
```

然后打开 `http://127.0.0.1:3001/`。

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.81-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.81-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.81-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.81-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 打开 `入账结果`，确认状态展示为 `已锁定 / 未锁定`，操作展示为 `锁定 / 取消锁定`。
- 打开 `认账及分账`，确认日期汇总操作列存在禁用的 `批量制单` 图标占位，且位于删除按钮左侧。
- 进入某个日期汇总详情，确认银行流水 `已认账` 状态后显示制单图标占位，未认账状态不显示。
- 左侧菜单中 `入账汇总` 下方应显示 `制单结果`，打开后提示功能开发中。
- 左侧菜单中 `认账信息设置` 下方应显示灰色禁用的 `财务信息设置` 一级菜单。

## 回退

- 代码可通过上一版部署包 `finance-platform-v9.80-local.tar.gz` 回退。
- 本版不涉及数据库迁移，回退时不需要回滚数据库结构。
