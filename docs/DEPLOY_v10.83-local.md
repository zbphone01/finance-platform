# v10.83-local 部署说明

本说明仅适用于从上一实际部署包 `v10.82-local` 升级到 `v10.83-local`。发布包为 `releases/finance-platform-v10.83-local.tar.gz`，只执行 `migrate-v10.83-counterparty-match-accounts-source.sql`。本版本没有依赖或运行配置变更。

## 测试服务器1

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
test -s releases/finance-platform-v10.83-local.tar.gz
test -s deploy-update-optimized.sh
test -s migrate-v10.83-counterparty-match-accounts-source.sql
test -s scripts/check-v10.83-counterparty-match-accounts-database.mjs
TEST_SERVER1_KEY="/home/deploy/Documents/测试服务器1密钥/codex.pem"
chmod 600 "$TEST_SERVER1_KEY"
scp -i "$TEST_SERVER1_KEY" releases/finance-platform-v10.83-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.83-counterparty-match-accounts-source.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
scp -i "$TEST_SERVER1_KEY" scripts/check-v10.83-counterparty-match-accounts-database.mjs \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/scripts/
```

### 2. 登录

```bash
TEST_SERVER1_KEY="/home/deploy/Documents/测试服务器1密钥/codex.pem"
chmod 600 "$TEST_SERVER1_KEY"
ssh -i "$TEST_SERVER1_KEY" ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
test -s .env
test -s finance-platform-v10.83-local.tar.gz
test -s deploy-update-optimized.sh
test -s migrate-v10.83-counterparty-match-accounts-source.sql
test -s scripts/check-v10.83-counterparty-match-accounts-database.mjs
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
node --version
pm2 status
```

### 3. 检查并迁移

脚本只处理紧邻上一实际部署包 `v10.82-local` 到 `v10.83-local` 的唯一迁移。先停止两个联动应用，再由同一入口自动检查、执行和回读：

```bash
cd /home/ubuntu/finance-platform
pm2 stop finance-platform
pm2 stop ticket-platform
./deploy-update-optimized.sh --check-and-migrate-database
pm2 start ticket-platform
pm2 status
```

迁移已完成时不重复执行 SQL；旧六个主表条件字段完整、子表数据无孤立项、空启用条件、重复排序和不可回填记录时，自动补齐完全缺失的子项，增加 `(counterparty_record_id, sort_order)` 唯一键及级联外键，再删除 `counterparty_records` 的六个匹配字段和旧账号索引。若检查提示部分字段、孤立子项、空条件、重复排序、有子项但无启用条件或不可回填，不要部署，也不要执行 `drizzle schema push`。

### 4. 部署代码

```bash
cd /home/ubuntu/finance-platform
test -s finance-platform-v10.83-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
./deploy-update-optimized.sh \
  /home/ubuntu/finance-platform/finance-platform-v10.83-local.tar.gz
pm2 logs finance-platform --lines 150 --nostream
```

确认 `finance-platform` 在线、页面显示 `v10.83`。到账信息新增、编辑和多组条件展示应正常；上传可唯一匹配的收入流水后，“待认账”悬停只显示到账别称。认账及分账主列表不再显示 ID 列。核对数据库中 `counterparty_records` 不含六个匹配字段，匹配、未记录滤重和订单文件快照都只读取启用的 `counterparty_match_accounts`。

## 测试服务器2

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
test -s releases/finance-platform-v10.83-local.tar.gz
test -s deploy-update-optimized.sh
test -s migrate-v10.83-counterparty-match-accounts-source.sql
test -s scripts/check-v10.83-counterparty-match-accounts-database.mjs
scp releases/finance-platform-v10.83-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.83-counterparty-match-accounts-source.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
scp scripts/check-v10.83-counterparty-match-accounts-database.mjs \
  administrator@server2.example.com:/home/administrator/finance-platform/scripts/
```

### 2. 登录

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
test -s .env
test -s finance-platform-v10.83-local.tar.gz
test -s deploy-update-optimized.sh
test -s migrate-v10.83-counterparty-match-accounts-source.sql
test -s scripts/check-v10.83-counterparty-match-accounts-database.mjs
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
node --version
pm2 status
```

### 3. 检查并迁移

脚本只处理紧邻上一实际部署包 `v10.82-local` 到 `v10.83-local` 的唯一迁移。先停止两个联动应用，再由同一入口自动检查、执行和回读：

```bash
cd /home/administrator/finance-platform
pm2 stop finance-platform
pm2 stop ticket-platform
APP_DIR=/home/administrator/finance-platform \
./deploy-update-optimized.sh --check-and-migrate-database
pm2 start ticket-platform
pm2 status
```

迁移已完成时不重复执行 SQL；旧六个主表条件字段完整、子表数据无孤立项、空启用条件、重复排序和不可回填记录时，自动执行 `migrate-v10.83-counterparty-match-accounts-source.sql` 并回读。检查不通过时不要部署，也不要执行 `drizzle schema push`。

### 4. 部署代码

```bash
cd /home/administrator/finance-platform
test -s finance-platform-v10.83-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform \
ACCESS_HOST=server2.example.com \
./deploy-update-optimized.sh \
  /home/administrator/finance-platform/finance-platform-v10.83-local.tar.gz
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://server2.example.com:3001/ > /dev/null
```

确认 `finance-platform` 在线、页面显示 `v10.83`，并按测试服务器1相同范围核对到账信息维护、上传匹配、待认账悬停提示和主列表 ID 列移除。
