# v10.72-local 部署说明

本说明仅适用于从 `v10.71-local` 升级到 `v10.72-local`。发布包为 `releases/finance-platform-v10.72-local.tar.gz`，迁移脚本为 `migrate-v10.72-invoice-only-orders.sql`，部署脚本为 `deploy-update-optimized.sh`。本版本没有依赖变更或配置变更。

本次迁移只新增不认账规则、上传文件和订单明细三张表。数据库检查为只读操作；只有检查明确提示需要迁移时，才停止 `finance-platform` 和 `ticket-platform` 后执行迁移。票据系统需在同一维护窗口按 `v0.1.23-local` 部署说明完成配套迁移和代码发布。

## 测试服务器1

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
TEST_SERVER1_KEY="/home/deploy/Documents/测试服务器1密钥/codex.pem"
chmod 600 "$TEST_SERVER1_KEY"
scp -i "$TEST_SERVER1_KEY" releases/finance-platform-v10.72-local.tar.gz \
  migrate-v10.72-invoice-only-orders.sql \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 登录

```bash
TEST_SERVER1_KEY="/home/deploy/Documents/测试服务器1密钥/codex.pem"
chmod 600 "$TEST_SERVER1_KEY"
ssh -i "$TEST_SERVER1_KEY" ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
test -s .env
test -s finance-platform-v10.72-local.tar.gz
test -s migrate-v10.72-invoice-only-orders.sql
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
node --version
pm2 status
```

### 3. 数据库检查和迁移（仅针对上个版本）

```bash
cd /home/ubuntu/finance-platform
./deploy-update-optimized.sh --check-database
```

- 如果显示“v10.72 不认账明细数据库迁移已完成，无需再次迁移，可以部署”，不要再次执行迁移，进入第 4 步。
- 如果显示“需要创建不认账规则、文件和订单明细表”，先停止两个应用：

```bash
pm2 stop finance-platform
pm2 stop ticket-platform
pm2 status
```

确认两个应用均已停止后执行：

```bash
APP_DIR=/home/ubuntu/finance-platform \
./deploy-update-optimized.sh --migrate-database \
  /home/ubuntu/finance-platform/migrate-v10.72-invoice-only-orders.sql
```

确认最终显示“v10.72 不认账明细数据库迁移完成并回读通过，可以部署”。如显示 `❌`、表结构混合、缺少字段/索引/外键或仍有上传解析任务，不要手工执行或重跑 SQL，也不要部署。不要执行历史迁移或 `drizzle schema push`。

### 4. 部署代码

```bash
cd /home/ubuntu/finance-platform
test -s finance-platform-v10.72-local.tar.gz
test -s migrate-v10.72-invoice-only-orders.sql
bash -n deploy-update-optimized.sh
./deploy-update-optimized.sh \
  /home/ubuntu/finance-platform/finance-platform-v10.72-local.tar.gz
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 `finance-platform` 在线、页面显示 `v10.72`；“自动认账规则”下出现“不认账明细”，规则可配置分开的日期和时间字段，上传完成后订单明细包显示“（不认账）”且不显示未匹配和待拆分数量。在票据系统 v0.1.23 配套迁移和代码部署完成前，不要恢复 `ticket-platform`。

## 测试服务器2

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.72-local.tar.gz \
  migrate-v10.72-invoice-only-orders.sql \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

### 2. 登录

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
test -s .env
test -s finance-platform-v10.72-local.tar.gz
test -s migrate-v10.72-invoice-only-orders.sql
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
node --version
pm2 status
```

### 3. 数据库检查和迁移（仅针对上个版本）

```bash
cd /home/administrator/finance-platform
APP_DIR=/home/administrator/finance-platform \
./deploy-update-optimized.sh --check-database
```

- 如果显示“v10.72 不认账明细数据库迁移已完成，无需再次迁移，可以部署”，不要再次执行迁移，进入第 4 步。
- 如果显示“需要创建不认账规则、文件和订单明细表”，先停止两个应用：

```bash
pm2 stop finance-platform
pm2 stop ticket-platform
pm2 status
```

确认两个应用均已停止后执行：

```bash
APP_DIR=/home/administrator/finance-platform \
./deploy-update-optimized.sh --migrate-database \
  /home/administrator/finance-platform/migrate-v10.72-invoice-only-orders.sql
```

确认最终显示“v10.72 不认账明细数据库迁移完成并回读通过，可以部署”。如显示 `❌`、表结构混合、缺少字段/索引/外键或仍有上传解析任务，不要手工执行或重跑 SQL，也不要部署。不要执行历史迁移或 `drizzle schema push`。

### 4. 部署代码

```bash
cd /home/administrator/finance-platform
test -s finance-platform-v10.72-local.tar.gz
test -s migrate-v10.72-invoice-only-orders.sql
bash -n deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform \
ACCESS_HOST=server2.example.com \
./deploy-update-optimized.sh \
  /home/administrator/finance-platform/finance-platform-v10.72-local.tar.gz
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
curl -fsS -H 'Accept: text/html' http://server2.example.com:3001/ > /dev/null
```

确认 `finance-platform` 在线、页面显示 `v10.72`；“自动认账规则”下出现“不认账明细”，规则可配置分开的日期和时间字段，上传完成后订单明细包显示“（不认账）”且不显示未匹配和待拆分数量。在票据系统 v0.1.23 配套迁移和代码部署完成前，不要恢复 `ticket-platform`。
