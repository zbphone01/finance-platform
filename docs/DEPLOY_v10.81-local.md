# v10.81-local 部署说明

本说明仅适用于从上一实际部署包 `v10.80-local` 升级到 `v10.81-local`。发布包为 `releases/finance-platform-v10.81-local.tar.gz`，只执行 `migrate-v10.81-bank-flow-arrival-match.sql`。本版本没有依赖或运行配置变更。

## 测试服务器1

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
test -s releases/finance-platform-v10.81-local.tar.gz
test -s deploy-update-optimized.sh
test -s migrate-v10.81-bank-flow-arrival-match.sql
test -s scripts/check-v10.81-bank-flow-arrival-match-database.mjs
TEST_SERVER1_KEY="/home/deploy/Documents/测试服务器1密钥/codex.pem"
chmod 600 "$TEST_SERVER1_KEY"
scp -i "$TEST_SERVER1_KEY" releases/finance-platform-v10.81-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.81-bank-flow-arrival-match.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
scp -i "$TEST_SERVER1_KEY" scripts/check-v10.81-bank-flow-arrival-match-database.mjs \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/scripts/
```

### 2. 登录

```bash
TEST_SERVER1_KEY="/home/deploy/Documents/测试服务器1密钥/codex.pem"
chmod 600 "$TEST_SERVER1_KEY"
ssh -i "$TEST_SERVER1_KEY" ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
test -s .env
test -s finance-platform-v10.81-local.tar.gz
test -s deploy-update-optimized.sh
test -s migrate-v10.81-bank-flow-arrival-match.sql
test -s scripts/check-v10.81-bank-flow-arrival-match-database.mjs
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
node --version
pm2 status
```

### 3. 检查并迁移

脚本只处理紧邻上一实际部署包 `v10.80-local` 到 `v10.81-local` 的唯一迁移。先停止两个联动应用，再由同一入口自动检查、执行和回读：

```bash
cd /home/ubuntu/finance-platform
pm2 stop finance-platform
pm2 stop ticket-platform
./deploy-update-optimized.sh --check-and-migrate-database
pm2 start ticket-platform
pm2 status
```

迁移已完成时该命令不执行 SQL；两个新字段均缺失且 v10.80 前置完整时，自动执行 `migrate-v10.81-bank-flow-arrival-match.sql` 并回读。迁移新增流水到账信息 ID 和匹配状态，按可靠历史关系回填，不新增索引。若检查提示字段部分迁移、匹配状态不一致、孤立到账信息引用或 v10.80 前置不完整，不要部署，也不要执行 `drizzle schema push`。

### 4. 部署代码

```bash
cd /home/ubuntu/finance-platform
test -s finance-platform-v10.81-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
./deploy-update-optimized.sh \
  /home/ubuntu/finance-platform/finance-platform-v10.81-local.tar.gz
pm2 logs finance-platform --lines 150 --nostream
```

确认 `finance-platform` 在线、页面显示 `v10.81`。上传一条可唯一匹配的收入流水，确认列表显示“待认账”；取消匹配后显示“未认账”且不会自动认账，再点击重新匹配确认按当前到账信息配置重新执行。明细认账只应找到固化为待认账且到账信息 ID 对应的流水。

## 测试服务器2

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
test -s releases/finance-platform-v10.81-local.tar.gz
test -s deploy-update-optimized.sh
test -s migrate-v10.81-bank-flow-arrival-match.sql
test -s scripts/check-v10.81-bank-flow-arrival-match-database.mjs
scp releases/finance-platform-v10.81-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.81-bank-flow-arrival-match.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
scp scripts/check-v10.81-bank-flow-arrival-match-database.mjs \
  administrator@server2.example.com:/home/administrator/finance-platform/scripts/
```

### 2. 登录

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
test -s .env
test -s finance-platform-v10.81-local.tar.gz
test -s deploy-update-optimized.sh
test -s migrate-v10.81-bank-flow-arrival-match.sql
test -s scripts/check-v10.81-bank-flow-arrival-match-database.mjs
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
node --version
pm2 status
```

### 3. 检查并迁移

脚本只处理紧邻上一实际部署包 `v10.80-local` 到 `v10.81-local` 的唯一迁移。先停止两个联动应用，再由同一入口自动检查、执行和回读：

```bash
cd /home/administrator/finance-platform
pm2 stop finance-platform
pm2 stop ticket-platform
APP_DIR=/home/administrator/finance-platform \
./deploy-update-optimized.sh --check-and-migrate-database
pm2 start ticket-platform
pm2 status
```

迁移已完成时该命令不执行 SQL；两个新字段均缺失且 v10.80 前置完整时，自动执行 `migrate-v10.81-bank-flow-arrival-match.sql` 并回读。迁移新增流水到账信息 ID 和匹配状态，按可靠历史关系回填，不新增索引。若检查提示字段部分迁移、匹配状态不一致、孤立到账信息引用或 v10.80 前置不完整，不要部署，也不要执行 `drizzle schema push`。

### 4. 部署代码

```bash
cd /home/administrator/finance-platform
test -s finance-platform-v10.81-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform \
ACCESS_HOST=server2.example.com \
./deploy-update-optimized.sh \
  /home/administrator/finance-platform/finance-platform-v10.81-local.tar.gz
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://server2.example.com:3001/ > /dev/null
```

确认 `finance-platform` 在线、页面显示 `v10.81`。上传一条可唯一匹配的收入流水，确认列表显示“待认账”；取消匹配后显示“未认账”且不会自动认账，再点击重新匹配确认按当前到账信息配置重新执行。明细认账只应找到固化为待认账且到账信息 ID 对应的流水。
