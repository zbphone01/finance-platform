# v10.70-local 部署说明

本说明仅适用于从 `v10.69-local` 升级到 `v10.70-local`。发布包为 `releases/finance-platform-v10.70-local.tar.gz`，认账侧迁移脚本为 `migrate-v10.70-generic-invoice-order-no-fields.sql`，部署脚本为 `deploy-update-optimized.sh`。本版本没有依赖变更或配置变更。

本次数据库字段直接改名并删除第三个票据单号字段，不兼容旧代码。必须与票据端 `v0.1.13` 在同一维护窗口联动发布；认账侧发布包不包含票据端代码及票据端迁移脚本。数据库检查为只读操作，可以在应用运行时执行；只有检查明确提示需要迁移时，才隔离业务流量、停止 `finance-platform` 和 `ticket-platform` 后执行迁移命令。

## 测试服务器1

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.70-local.tar.gz \
  migrate-v10.70-generic-invoice-order-no-fields.sql \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 登录

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
test -s .env
test -s finance-platform-v10.70-local.tar.gz
test -s migrate-v10.70-generic-invoice-order-no-fields.sql
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
node --version
pm2 status
```

### 3. 数据库检查和迁移（仅针对上个版本）

先执行只读检查。该命令不修改数据库，会校验数据库账号和库名、必需表、认账规则字段、投影快照，以及运行中的上传解析和窄表投影任务：

```bash
cd /home/ubuntu/finance-platform
./deploy-update-optimized.sh --check-database
```

根据输出执行：

- 如果显示 `v10.70 迁移已完成，无需再次迁移，可以部署`，不要再次执行迁移，直接进入第 4 步。
- 如果显示 `需要执行 v10.70 数据库迁移` 或 `需要继续完成 v10.70 数据库迁移`，先隔离业务流量并停止两套应用：

```bash
pm2 stop finance-platform
pm2 stop ticket-platform
pm2 status
```

确认两个应用均已停止后，执行检查结果给出的完整命令：

```bash
APP_DIR=/home/ubuntu/finance-platform \
./deploy-update-optimized.sh --migrate-database \
  /home/ubuntu/finance-platform/migrate-v10.70-generic-invoice-order-no-fields.sql
```

迁移命令会再次检查应用进程和数据库状态，只在符合迁移条件时执行 SQL，并在执行后回读字段和全部投影快照。确认最终显示 `v10.70 数据库迁移完成并回读通过，可以部署` 后进入第 4 步。

- 如果显示 `❌`、字段混合、必需表缺失或仍有运行中的任务，不要手工执行 SQL，也不要部署；先按错误提示排除问题后重新运行只读检查。

不要执行历史版本迁移，也不要执行 `drizzle schema push`。

### 4. 部署代码

```bash
test -s finance-platform-v10.70-local.tar.gz
test -s migrate-v10.70-generic-invoice-order-no-fields.sql
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh \
  /home/ubuntu/finance-platform/finance-platform-v10.70-local.tar.gz
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 `finance-platform` 在线、健康检查通过、页面右上角显示 `v10.70`。新建和查看明细认账规则时，“订单号字段”保持不变，“票据用单号”只显示“其他单号1、其他单号2”。在票据端 `v0.1.13` 代码和票据端迁移完成前，不要恢复 `ticket-platform`。

## 测试服务器2

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.70-local.tar.gz \
  migrate-v10.70-generic-invoice-order-no-fields.sql \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

### 2. 登录

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
test -s .env
test -s finance-platform-v10.70-local.tar.gz
test -s migrate-v10.70-generic-invoice-order-no-fields.sql
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
node --version
pm2 status
```

### 3. 数据库检查和迁移（仅针对上个版本）

先执行只读检查。该命令不修改数据库，会校验数据库账号和库名、必需表、认账规则字段、投影快照，以及运行中的上传解析和窄表投影任务：

```bash
cd /home/administrator/finance-platform
APP_DIR=/home/administrator/finance-platform \
./deploy-update-optimized.sh --check-database
```

根据输出执行：

- 如果显示 `v10.70 迁移已完成，无需再次迁移，可以部署`，不要再次执行迁移，直接进入第 4 步。
- 如果显示 `需要执行 v10.70 数据库迁移` 或 `需要继续完成 v10.70 数据库迁移`，先隔离业务流量并停止两套应用：

```bash
pm2 stop finance-platform
pm2 stop ticket-platform
pm2 status
```

确认两个应用均已停止后，执行检查结果给出的完整命令：

```bash
APP_DIR=/home/administrator/finance-platform \
./deploy-update-optimized.sh --migrate-database \
  /home/administrator/finance-platform/migrate-v10.70-generic-invoice-order-no-fields.sql
```

迁移命令会再次检查应用进程和数据库状态，只在符合迁移条件时执行 SQL，并在执行后回读字段和全部投影快照。确认最终显示 `v10.70 数据库迁移完成并回读通过，可以部署` 后进入第 4 步。

- 如果显示 `❌`、字段混合、必需表缺失或仍有运行中的任务，不要手工执行 SQL，也不要部署；先按错误提示排除问题后重新运行只读检查。

不要执行历史版本迁移，也不要执行 `drizzle schema push`。

### 4. 部署代码

```bash
test -s finance-platform-v10.70-local.tar.gz
test -s migrate-v10.70-generic-invoice-order-no-fields.sql
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform \
ACCESS_HOST=server2.example.com \
./deploy-update-optimized.sh \
  /home/administrator/finance-platform/finance-platform-v10.70-local.tar.gz
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
curl -fsS -H 'Accept: text/html' http://server2.example.com:3001/ > /dev/null
```

确认 `finance-platform` 在线、内外网健康检查通过、页面右上角显示 `v10.70`。新建和查看明细认账规则时，“订单号字段”保持不变，“票据用单号”只显示“其他单号1、其他单号2”。在票据端 `v0.1.13` 代码和票据端迁移完成前，不要恢复 `ticket-platform`。
