# v10.84-local 部署说明

本说明仅适用于从上一实际部署包 `v10.83-local` 升级到 `v10.84-local`。发布包为 `releases/finance-platform-v10.84-local.tar.gz`；本版无 SQL 迁移，无依赖或运行配置变更。

## 测试服务器1

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
test -s releases/finance-platform-v10.84-local.tar.gz
test -s deploy-update-optimized.sh
test -s scripts/check-v10.84-counterparty-match-accounts-database.mjs
TEST_SERVER1_KEY="/home/deploy/Documents/测试服务器1密钥/codex.pem"
chmod 600 "$TEST_SERVER1_KEY"
scp -i "$TEST_SERVER1_KEY" releases/finance-platform-v10.84-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
scp -i "$TEST_SERVER1_KEY" scripts/check-v10.84-counterparty-match-accounts-database.mjs \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/scripts/
```

### 2. 登录

```bash
TEST_SERVER1_KEY="/home/deploy/Documents/测试服务器1密钥/codex.pem"
chmod 600 "$TEST_SERVER1_KEY"
ssh -i "$TEST_SERVER1_KEY" ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
test -s .env
test -s finance-platform-v10.84-local.tar.gz
test -s deploy-update-optimized.sh
test -s scripts/check-v10.84-counterparty-match-accounts-database.mjs
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
node --version
pm2 status
```

### 3. 检查并迁移

本版无 SQL 迁移。统一入口只读检查 v10.83 数据库完成态，不停止 `finance-platform` 或 `ticket-platform`，不执行任何写 SQL：

```bash
cd /home/ubuntu/finance-platform
LC_ALL=C ./deploy-update-optimized.sh --check-and-migrate-database
pm2 status
```

检查必须确认主表旧匹配字段已移除，子表唯一键、级联外键和到账匹配数据完整。检查不通过时不要部署，也不要执行 `drizzle schema push`。

### 4. 部署代码

```bash
cd /home/ubuntu/finance-platform
test -s finance-platform-v10.84-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
LC_ALL=C ./deploy-update-optimized.sh \
  /home/ubuntu/finance-platform/finance-platform-v10.84-local.tar.gz
pm2 logs finance-platform --lines 150 --nostream
```

确认 `finance-platform` 在线、页面显示 `v10.84`。上传可唯一匹配的正收入流水后，核对规则只读取一次、每 100 条批量生成结果，上传结果弹窗显示完成、待填写、无规则、失败和跳过数量。

## 测试服务器2

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
test -s releases/finance-platform-v10.84-local.tar.gz
test -s deploy-update-optimized.sh
test -s scripts/check-v10.84-counterparty-match-accounts-database.mjs
scp releases/finance-platform-v10.84-local.tar.gz \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
scp scripts/check-v10.84-counterparty-match-accounts-database.mjs \
  administrator@server2.example.com:/home/administrator/finance-platform/scripts/
```

### 2. 登录

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
test -s .env
test -s finance-platform-v10.84-local.tar.gz
test -s deploy-update-optimized.sh
test -s scripts/check-v10.84-counterparty-match-accounts-database.mjs
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
node --version
pm2 status
```

### 3. 检查并迁移

本版无 SQL 迁移。统一入口只读检查 v10.83 数据库完成态，不停止联动应用，不执行任何写 SQL：

```bash
cd /home/administrator/finance-platform
APP_DIR=/home/administrator/finance-platform \
LC_ALL=C ./deploy-update-optimized.sh --check-and-migrate-database
pm2 status
```

检查不通过时不要部署，也不要执行 `drizzle schema push`。

### 4. 部署代码

```bash
cd /home/administrator/finance-platform
test -s finance-platform-v10.84-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform \
ACCESS_HOST=server2.example.com \
LC_ALL=C ./deploy-update-optimized.sh \
  /home/administrator/finance-platform/finance-platform-v10.84-local.tar.gz
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://server2.example.com:3001/ > /dev/null
```

确认 `finance-platform` 在线、页面显示 `v10.84`，并核对银行流水上传后一次读取到账认账与分账规则、每 100 条批量认账和上传结果提示。
