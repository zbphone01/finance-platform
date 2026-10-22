# v10.71-local 部署说明

本说明仅适用于从 `v10.70-local` 升级到 `v10.71-local`。发布包为 `releases/finance-platform-v10.71-local.tar.gz`，认账侧迁移脚本为 `migrate-v10.71-order-invoice-fields.sql`，部署脚本为 `deploy-update-optimized.sh`。本版本没有依赖变更或配置变更。

本次迁移会为订单明细主表和全部月归档表增加票据单号值字段、转存上传字段快照、分批回填最近 24 个月数据、替换归档过程并删除旧投影任务表。数据库检查为只读操作，可以在应用运行时执行；只有检查明确提示需要迁移时，才隔离业务流量、停止 `finance-platform` 和 `ticket-platform` 后执行迁移。票据平台必须在同一维护窗口完成订单开票兼容改造；认账侧发布包不包含票据端代码或迁移脚本。

## 测试服务器1

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.71-local.tar.gz \
  migrate-v10.71-order-invoice-fields.sql \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 登录

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
test -s .env
test -s finance-platform-v10.71-local.tar.gz
test -s migrate-v10.71-order-invoice-fields.sql
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
node --version
pm2 status
```

### 3. 数据库检查和迁移（仅针对上个版本）

先执行只读检查。该命令不修改数据库，会校验数据库账号和库名、必需表、订单明细票据值字段、文件字段快照、全部月归档表列顺序、归档过程、旧投影表状态，以及运行中的上传解析、旧投影和归档任务：

```bash
cd /home/ubuntu/finance-platform
./deploy-update-optimized.sh --check-database
```

根据输出执行：

- 如果显示“订单开票配套迁移已完成，无需再次迁移，可以部署”，不要再次执行迁移，直接进入第 4 步。
- 如果显示“需要执行订单开票配套数据库迁移”，先隔离业务流量并停止两套应用：

```bash
pm2 stop finance-platform
pm2 stop ticket-platform
pm2 status
```

确认两个应用均已停止后，执行检查结果给出的完整命令：

```bash
APP_DIR=/home/ubuntu/finance-platform \
./deploy-update-optimized.sh --migrate-database \
  /home/ubuntu/finance-platform/migrate-v10.71-order-invoice-fields.sql
```

迁移命令会再次检查应用进程和数据库状态，只在完整的 `v10.70-local` 前置状态下执行 SQL，并在执行后回读订单明细字段、文件快照、全部归档表、归档过程和旧投影表状态。确认最终显示“订单开票配套数据库迁移完成并回读通过，可以部署”后进入第 4 步。

- 如果显示 `❌`、字段混合、必需表缺失、归档过程异常或仍有运行中的任务，不要手工执行或重跑 SQL，也不要部署；先按错误提示检查迁移状态和归档 Event 后再制定处理方案。

不要执行历史版本迁移，也不要执行 `drizzle schema push`。

### 4. 部署代码

```bash
test -s finance-platform-v10.71-local.tar.gz
test -s migrate-v10.71-order-invoice-fields.sql
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh \
  /home/ubuntu/finance-platform/finance-platform-v10.71-local.tar.gz
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 `finance-platform` 在线、健康检查通过、页面右上角显示 `v10.71`。新上传订单文件后，确认订单明细原始信息仍保留配置单号列，订单文件固化三个字段名快照，订单明细独立保存其他单号1和其他单号2。在票据平台兼容代码和迁移完成前，不要恢复 `ticket-platform`。

## 测试服务器2

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.71-local.tar.gz \
  migrate-v10.71-order-invoice-fields.sql \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

### 2. 登录

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
test -s .env
test -s finance-platform-v10.71-local.tar.gz
test -s migrate-v10.71-order-invoice-fields.sql
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
node --version
pm2 status
```

### 3. 数据库检查和迁移（仅针对上个版本）

先执行只读检查。该命令不修改数据库，会校验数据库账号和库名、必需表、订单明细票据值字段、文件字段快照、全部月归档表列顺序、归档过程、旧投影表状态，以及运行中的上传解析、旧投影和归档任务：

```bash
cd /home/administrator/finance-platform
APP_DIR=/home/administrator/finance-platform \
./deploy-update-optimized.sh --check-database
```

根据输出执行：

- 如果显示“订单开票配套迁移已完成，无需再次迁移，可以部署”，不要再次执行迁移，直接进入第 4 步。
- 如果显示“需要执行订单开票配套数据库迁移”，先隔离业务流量并停止两套应用：

```bash
pm2 stop finance-platform
pm2 stop ticket-platform
pm2 status
```

确认两个应用均已停止后，执行检查结果给出的完整命令：

```bash
APP_DIR=/home/administrator/finance-platform \
./deploy-update-optimized.sh --migrate-database \
  /home/administrator/finance-platform/migrate-v10.71-order-invoice-fields.sql
```

迁移命令会再次检查应用进程和数据库状态，只在完整的 `v10.70-local` 前置状态下执行 SQL，并在执行后回读订单明细字段、文件快照、全部归档表、归档过程和旧投影表状态。确认最终显示“订单开票配套数据库迁移完成并回读通过，可以部署”后进入第 4 步。

- 如果显示 `❌`、字段混合、必需表缺失、归档过程异常或仍有运行中的任务，不要手工执行或重跑 SQL，也不要部署；先按错误提示检查迁移状态和归档 Event 后再制定处理方案。

不要执行历史版本迁移，也不要执行 `drizzle schema push`。

### 4. 部署代码

```bash
test -s finance-platform-v10.71-local.tar.gz
test -s migrate-v10.71-order-invoice-fields.sql
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform \
ACCESS_HOST=server2.example.com \
./deploy-update-optimized.sh \
  /home/administrator/finance-platform/finance-platform-v10.71-local.tar.gz
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
curl -fsS -H 'Accept: text/html' http://server2.example.com:3001/ > /dev/null
```

确认 `finance-platform` 在线、内外网健康检查通过、页面右上角显示 `v10.71`。新上传订单文件后，确认订单明细原始信息仍保留配置单号列，订单文件固化三个字段名快照，订单明细独立保存其他单号1和其他单号2。在票据平台兼容代码和迁移完成前，不要恢复 `ticket-platform`。
