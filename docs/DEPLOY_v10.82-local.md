# v10.82-local 部署说明

本说明仅适用于从上一实际部署包 `v10.81-local` 升级到 `v10.82-local`。发布包为 `releases/finance-platform-v10.82-local.tar.gz`。本版本无 SQL 迁移、依赖或运行配置变更。

## 测试服务器1

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
test -s releases/finance-platform-v10.82-local.tar.gz
test -s deploy-update-optimized.sh
test -s scripts/check-v10.82-bank-flow-display-database.mjs
TEST_SERVER1_KEY="/home/deploy/Documents/测试服务器1密钥/codex.pem"
chmod 600 "$TEST_SERVER1_KEY"
scp -i "$TEST_SERVER1_KEY" releases/finance-platform-v10.82-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
scp -i "$TEST_SERVER1_KEY" scripts/check-v10.82-bank-flow-display-database.mjs \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/scripts/
```

### 2. 登录

```bash
TEST_SERVER1_KEY="/home/deploy/Documents/测试服务器1密钥/codex.pem"
chmod 600 "$TEST_SERVER1_KEY"
ssh -i "$TEST_SERVER1_KEY" ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
test -s .env
test -s finance-platform-v10.82-local.tar.gz
test -s deploy-update-optimized.sh
test -s scripts/check-v10.82-bank-flow-display-database.mjs
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
node --version
pm2 status
```

### 3. 检查并迁移

本版无 SQL 迁移。以下统一入口只读检查 `v10.81-local -> v10.82-local` 所需数据库完成态，不停止 `finance-platform` 或 `ticket-platform`，也不执行 SQL：

```bash
cd /home/ubuntu/finance-platform
./deploy-update-optimized.sh --check-and-migrate-database
pm2 status
```

检查必须明确输出“v10.82 无 SQL 迁移”并确认日期汇总、明细分账、银行流水统一字段和到账匹配一致性完整。若任一结构缺失或匹配状态不一致，不要部署，也不要执行 `drizzle schema push`。

### 4. 部署代码

```bash
cd /home/ubuntu/finance-platform
test -s finance-platform-v10.82-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
./deploy-update-optimized.sh \
  /home/ubuntu/finance-platform/finance-platform-v10.82-local.tar.gz
pm2 logs finance-platform --lines 150 --nostream
```

确认 `finance-platform` 在线、页面显示 `v10.82`。进入任一有流水的认账日期详情，在“银行流水 / 订单明细 / 入账结果”下方确认可切换三家银行，收入/支出切换位于同一行右侧；分别核对广发、工商和中国银行的列名和顺序，确认切换后分页总数只属于当前银行与方向。到账信息规则设置文案应同时包含三家银行的字段名称。

## 测试服务器2

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
test -s releases/finance-platform-v10.82-local.tar.gz
test -s deploy-update-optimized.sh
test -s scripts/check-v10.82-bank-flow-display-database.mjs
scp releases/finance-platform-v10.82-local.tar.gz \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
scp scripts/check-v10.82-bank-flow-display-database.mjs \
  administrator@server2.example.com:/home/administrator/finance-platform/scripts/
```

### 2. 登录

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
test -s .env
test -s finance-platform-v10.82-local.tar.gz
test -s deploy-update-optimized.sh
test -s scripts/check-v10.82-bank-flow-display-database.mjs
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
node --version
pm2 status
```

### 3. 检查并迁移

本版无 SQL 迁移。以下统一入口只读检查 `v10.81-local -> v10.82-local` 所需数据库完成态，不停止 `finance-platform` 或 `ticket-platform`，也不执行 SQL：

```bash
cd /home/administrator/finance-platform
APP_DIR=/home/administrator/finance-platform \
./deploy-update-optimized.sh --check-and-migrate-database
pm2 status
```

检查必须明确输出“v10.82 无 SQL 迁移”并确认日期汇总、明细分账、银行流水统一字段和到账匹配一致性完整。若任一结构缺失或匹配状态不一致，不要部署，也不要执行 `drizzle schema push`。

### 4. 部署代码

```bash
cd /home/administrator/finance-platform
test -s finance-platform-v10.82-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform \
ACCESS_HOST=server2.example.com \
./deploy-update-optimized.sh \
  /home/administrator/finance-platform/finance-platform-v10.82-local.tar.gz
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://server2.example.com:3001/ > /dev/null
```

确认 `finance-platform` 在线、页面显示 `v10.82`。进入任一有流水的认账日期详情，在“银行流水 / 订单明细 / 入账结果”下方确认可切换三家银行，收入/支出切换位于同一行右侧；分别核对广发、工商和中国银行的列名和顺序，确认切换后分页总数只属于当前银行与方向。到账信息规则设置文案应同时包含三家银行的字段名称。
