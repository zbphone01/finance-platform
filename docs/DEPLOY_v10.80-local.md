# v10.80-local 部署说明

本说明仅适用于从上一实际部署包 `v10.79-local` 升级到 `v10.80-local`。发布包为 `releases/finance-platform-v10.80-local.tar.gz`，只执行 `migrate-v10.80-detail-split-order-dedup.sql`。本版本没有依赖或运行配置变更。

## 测试服务器1

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
test -s releases/finance-platform-v10.80-local.tar.gz
test -s deploy-update-optimized.sh
test -s migrate-v10.80-detail-split-order-dedup.sql
TEST_SERVER1_KEY="/home/deploy/Documents/测试服务器1密钥/codex.pem"
chmod 600 "$TEST_SERVER1_KEY"
scp -i "$TEST_SERVER1_KEY" releases/finance-platform-v10.80-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.80-detail-split-order-dedup.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 登录

```bash
TEST_SERVER1_KEY="/home/deploy/Documents/测试服务器1密钥/codex.pem"
chmod 600 "$TEST_SERVER1_KEY"
ssh -i "$TEST_SERVER1_KEY" ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
test -s .env
test -s finance-platform-v10.80-local.tar.gz
test -s deploy-update-optimized.sh
test -s migrate-v10.80-detail-split-order-dedup.sql
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
node --version
pm2 status
```

### 3. 检查并迁移

脚本只处理紧邻上一实际部署包 `v10.79-local` 到 `v10.80-local` 的唯一迁移。先停止两个联动应用，再由同一入口自动检查、执行和回读：

```bash
cd /home/ubuntu/finance-platform
pm2 stop finance-platform
pm2 stop ticket-platform
./deploy-update-optimized.sh --check-and-migrate-database
pm2 start ticket-platform
pm2 status
```

迁移已完成时该命令不执行 SQL；未迁移且状态完整时自动执行 `migrate-v10.80-detail-split-order-dedup.sql` 并回读。迁移会新增明细分账子订单号字段快照、重复数和持久滤重键，不回填历史分账包。若检查提示当前迁移字段/表处于混合状态或联动应用仍在运行，不要部署，也不要执行 `drizzle schema push`。

### 4. 部署代码

```bash
cd /home/ubuntu/finance-platform
test -s finance-platform-v10.80-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
./deploy-update-optimized.sh \
  /home/ubuntu/finance-platform/finance-platform-v10.80-local.tar.gz
pm2 logs finance-platform --lines 150 --nostream
```

确认 `finance-platform` 在线、页面显示 `v10.80`。重新执行失败的明细分账认账任务，确认金额按分值完全相等、同一主订单的所有唯一子明细均纳入合计，并确认历史错误日期明细在重试时写回来源 `bill_date` 与 `partition_date`。

## 测试服务器2

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
test -s releases/finance-platform-v10.80-local.tar.gz
test -s deploy-update-optimized.sh
test -s migrate-v10.80-detail-split-order-dedup.sql
scp releases/finance-platform-v10.80-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.80-detail-split-order-dedup.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

### 2. 登录

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
test -s .env
test -s finance-platform-v10.80-local.tar.gz
test -s deploy-update-optimized.sh
test -s migrate-v10.80-detail-split-order-dedup.sql
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
node --version
pm2 status
```

### 3. 检查并迁移

脚本只处理紧邻上一实际部署包 `v10.79-local` 到 `v10.80-local` 的唯一迁移。先停止两个联动应用，再由同一入口自动检查、执行和回读：

```bash
cd /home/administrator/finance-platform
pm2 stop finance-platform
pm2 stop ticket-platform
APP_DIR=/home/administrator/finance-platform \
./deploy-update-optimized.sh --check-and-migrate-database
pm2 start ticket-platform
pm2 status
```

迁移已完成时该命令不执行 SQL；未迁移且状态完整时自动执行 `migrate-v10.80-detail-split-order-dedup.sql` 并回读。迁移会新增明细分账子订单号字段快照、重复数和持久滤重键，不回填历史分账包。若检查提示当前迁移字段/表处于混合状态或联动应用仍在运行，不要部署，也不要执行 `drizzle schema push`。

### 4. 部署代码

```bash
cd /home/administrator/finance-platform
test -s finance-platform-v10.80-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform \
ACCESS_HOST=server2.example.com \
./deploy-update-optimized.sh \
  /home/administrator/finance-platform/finance-platform-v10.80-local.tar.gz
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://server2.example.com:3001/ > /dev/null
```

确认 `finance-platform` 在线、页面显示 `v10.80`。重新执行失败的明细分账认账任务，确认金额按分值完全相等、同一主订单的所有唯一子明细均纳入合计，并确认历史错误日期明细在重试时写回来源 `bill_date` 与 `partition_date`。
