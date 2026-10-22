# v10.74-local 部署说明

本说明仅适用于从 `v10.73-local` 升级到 `v10.74-local`。发布包为 `releases/finance-platform-v10.74-local.tar.gz`，迁移脚本为 `migrate-v10.74-rule-exclude-conditions.sql`，部署脚本为 `deploy-update-optimized.sh`。本版本没有依赖变更或配置变更。

## 测试服务器1

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
test -s releases/finance-platform-v10.74-local.tar.gz
test -s deploy-update-optimized.sh
test -s migrate-v10.74-rule-exclude-conditions.sql
TEST_SERVER1_KEY="/home/deploy/Documents/测试服务器1密钥/codex.pem"
chmod 600 "$TEST_SERVER1_KEY"
scp -i "$TEST_SERVER1_KEY" releases/finance-platform-v10.74-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.74-rule-exclude-conditions.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 登录

```bash
TEST_SERVER1_KEY="/home/deploy/Documents/测试服务器1密钥/codex.pem"
chmod 600 "$TEST_SERVER1_KEY"
ssh -i "$TEST_SERVER1_KEY" ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
test -s .env
test -s finance-platform-v10.74-local.tar.gz
test -s deploy-update-optimized.sh
test -s migrate-v10.74-rule-exclude-conditions.sql
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
node --version
pm2 status
```

### 3. 数据库检查和迁移（仅针对上个版本）

以下检查和迁移只适用于从 `v10.73-local` 升级。先只读检查一次：

```bash
cd /home/ubuntu/finance-platform
./deploy-update-optimized.sh --check-database
```

若显示“无需再次迁移，可以部署”，跳过本步骤其余命令。确认“需要创建多组排除条件表”后，停止两个联动应用，再执行显式迁移；迁移完成后先恢复票据平台，财务平台由下一步部署启动：

```bash
pm2 stop finance-platform
pm2 stop ticket-platform
./deploy-update-optimized.sh --migrate-database /home/ubuntu/finance-platform/migrate-v10.74-rule-exclude-conditions.sql
pm2 start ticket-platform
pm2 status
```

确认迁移回读显示 7 个字段、2 个索引、级联外键正常，缺失回填、快照不一致和孤立记录均为 0。数据库处于部分迁移状态、v10.71/v10.72 前置结构缺失或仍有运行任务时，不要部署，也不要执行 `drizzle schema push`。

### 4. 部署代码

```bash
cd /home/ubuntu/finance-platform
test -s finance-platform-v10.74-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
./deploy-update-optimized.sh \
  /home/ubuntu/finance-platform/finance-platform-v10.74-local.tar.gz
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 `finance-platform` 在线、页面显示 `v10.74`。编辑一条明细认账规则，确认排除订单仍位于规则基本信息内，默认一组并可增加，单组包含识别字段、匹配方式和字段关键字；退款订单仍使用判断字段和值，退款金额字段仅负责取金额。再用小文件验证排除行不入库、退款行按负数入库以及普通收入行正常预匹配。不认账规则同时确认日期字段可留空，时间字段可直接解析完整日期时间。

## 测试服务器2

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
test -s releases/finance-platform-v10.74-local.tar.gz
test -s deploy-update-optimized.sh
test -s migrate-v10.74-rule-exclude-conditions.sql
scp releases/finance-platform-v10.74-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.74-rule-exclude-conditions.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

### 2. 登录

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
test -s .env
test -s finance-platform-v10.74-local.tar.gz
test -s deploy-update-optimized.sh
test -s migrate-v10.74-rule-exclude-conditions.sql
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
node --version
pm2 status
```

### 3. 数据库检查和迁移（仅针对上个版本）

以下检查和迁移只适用于从 `v10.73-local` 升级。先只读检查一次：

```bash
cd /home/administrator/finance-platform
APP_DIR=/home/administrator/finance-platform \
./deploy-update-optimized.sh --check-database
```

若显示“无需再次迁移，可以部署”，跳过本步骤其余命令。确认“需要创建多组排除条件表”后，停止两个联动应用，再执行显式迁移；迁移完成后先恢复票据平台，财务平台由下一步部署启动：

```bash
pm2 stop finance-platform
pm2 stop ticket-platform
APP_DIR=/home/administrator/finance-platform \
./deploy-update-optimized.sh --migrate-database /home/administrator/finance-platform/migrate-v10.74-rule-exclude-conditions.sql
pm2 start ticket-platform
pm2 status
```

确认迁移回读显示 7 个字段、2 个索引、级联外键正常，缺失回填、快照不一致和孤立记录均为 0。数据库处于部分迁移状态、v10.71/v10.72 前置结构缺失或仍有运行任务时，不要部署，也不要执行 `drizzle schema push`。

### 4. 部署代码

```bash
cd /home/administrator/finance-platform
test -s finance-platform-v10.74-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform \
ACCESS_HOST=server2.example.com \
./deploy-update-optimized.sh \
  /home/administrator/finance-platform/finance-platform-v10.74-local.tar.gz
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
curl -fsS -H 'Accept: text/html' http://server2.example.com:3001/ > /dev/null
```

确认 `finance-platform` 在线、页面显示 `v10.74`。编辑一条明细认账规则，确认排除订单仍位于规则基本信息内，默认一组并可增加，单组包含识别字段、匹配方式和字段关键字；退款订单仍使用判断字段和值，退款金额字段仅负责取金额。再用小文件验证排除行不入库、退款行按负数入库以及普通收入行正常预匹配。不认账规则同时确认日期字段可留空，时间字段可直接解析完整日期时间。
