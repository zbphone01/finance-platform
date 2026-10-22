# v10.77-local 部署说明

本说明仅适用于从上一实际部署包 `v10.73-local` 升级到 `v10.77-local`。发布包为 `releases/finance-platform-v10.77-local.tar.gz`，必须按 v10.74、v10.75、v10.76、v10.77 的顺序执行四个迁移 SQL。本版本没有依赖变更或配置变更。

## 测试服务器1

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
test -s releases/finance-platform-v10.77-local.tar.gz
test -s deploy-update-optimized.sh
test -s migrate-v10.74-rule-exclude-conditions.sql
test -s migrate-v10.75-bank-flow-income-expense-view.sql
test -s migrate-v10.76-refund-judge-values.sql
test -s migrate-v10.77-recognized-bank-flow-count-cache.sql
TEST_SERVER1_KEY="/home/deploy/Documents/测试服务器1密钥/codex.pem"
chmod 600 "$TEST_SERVER1_KEY"
scp -i "$TEST_SERVER1_KEY" releases/finance-platform-v10.77-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.74-rule-exclude-conditions.sql \
  migrate-v10.75-bank-flow-income-expense-view.sql \
  migrate-v10.76-refund-judge-values.sql \
  migrate-v10.77-recognized-bank-flow-count-cache.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 登录

```bash
TEST_SERVER1_KEY="/home/deploy/Documents/测试服务器1密钥/codex.pem"
chmod 600 "$TEST_SERVER1_KEY"
ssh -i "$TEST_SERVER1_KEY" ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
test -s .env
test -s finance-platform-v10.77-local.tar.gz
test -s deploy-update-optimized.sh
test -s migrate-v10.74-rule-exclude-conditions.sql
test -s migrate-v10.75-bank-flow-income-expense-view.sql
test -s migrate-v10.76-refund-judge-values.sql
test -s migrate-v10.77-recognized-bank-flow-count-cache.sql
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
node --version
pm2 status
```

### 3. 数据库检查和迁移（仅针对上个版本）

以上一实际部署包 `v10.73-local` 为基线。先运行一次只读检查，确认四段迁移各自显示“无需再次迁移”或“下一步执行”：

```bash
cd /home/ubuntu/finance-platform
./deploy-update-optimized.sh --check-database
```

若四段都显示“无需再次迁移，可以部署”，跳过本步骤其余命令。否则停止两个联动应用，并严格按以下顺序执行；已完成的迁移会只读确认后跳过，不会重复执行 SQL：

```bash
pm2 stop finance-platform
pm2 stop ticket-platform
./deploy-update-optimized.sh --migrate-database /home/ubuntu/finance-platform/migrate-v10.74-rule-exclude-conditions.sql
./deploy-update-optimized.sh --migrate-database /home/ubuntu/finance-platform/migrate-v10.75-bank-flow-income-expense-view.sql
./deploy-update-optimized.sh --migrate-database /home/ubuntu/finance-platform/migrate-v10.76-refund-judge-values.sql
./deploy-update-optimized.sh --migrate-database /home/ubuntu/finance-platform/migrate-v10.77-recognized-bank-flow-count-cache.sql
pm2 start ticket-platform
pm2 status
```

确认 v10.74 多组排除条件表的字段、索引、外键和旧值回填正常；v10.75 收入总额和收入条数与正数流水汇总一致、纯支出待认账任务为 0；v10.76 退款数组长度、旧值回填和首值快照一致；v10.77 已认账收入流水条数与流水状态聚合一致。任一段为部分迁移、迁移顺序不正确或 v10.71/v10.72 前置结构缺失时，不要部署，也不要执行 `drizzle schema push`。

### 4. 部署代码

```bash
cd /home/ubuntu/finance-platform
test -s finance-platform-v10.77-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
./deploy-update-optimized.sh \
  /home/ubuntu/finance-platform/finance-platform-v10.77-local.tar.gz
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 `finance-platform` 在线、页面显示 `v10.77`。检查明细认账规则的多组排除条件和退款多值；上传小文件验证排除、普通收入和退款入库。在日期汇总切换收入/支出，确认支出只读，收入总额、已认账条数和流水状态与实际数据一致。

## 测试服务器2

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
test -s releases/finance-platform-v10.77-local.tar.gz
test -s deploy-update-optimized.sh
test -s migrate-v10.74-rule-exclude-conditions.sql
test -s migrate-v10.75-bank-flow-income-expense-view.sql
test -s migrate-v10.76-refund-judge-values.sql
test -s migrate-v10.77-recognized-bank-flow-count-cache.sql
scp releases/finance-platform-v10.77-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.74-rule-exclude-conditions.sql \
  migrate-v10.75-bank-flow-income-expense-view.sql \
  migrate-v10.76-refund-judge-values.sql \
  migrate-v10.77-recognized-bank-flow-count-cache.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

### 2. 登录

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
test -s .env
test -s finance-platform-v10.77-local.tar.gz
test -s deploy-update-optimized.sh
test -s migrate-v10.74-rule-exclude-conditions.sql
test -s migrate-v10.75-bank-flow-income-expense-view.sql
test -s migrate-v10.76-refund-judge-values.sql
test -s migrate-v10.77-recognized-bank-flow-count-cache.sql
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
node --version
pm2 status
```

### 3. 数据库检查和迁移（仅针对上个版本）

以上一实际部署包 `v10.73-local` 为基线。先运行一次只读检查，确认四段迁移各自显示“无需再次迁移”或“下一步执行”：

```bash
cd /home/administrator/finance-platform
APP_DIR=/home/administrator/finance-platform \
./deploy-update-optimized.sh --check-database
```

若四段都显示“无需再次迁移，可以部署”，跳过本步骤其余命令。否则停止两个联动应用，并严格按以下顺序执行；已完成的迁移会只读确认后跳过，不会重复执行 SQL：

```bash
pm2 stop finance-platform
pm2 stop ticket-platform
APP_DIR=/home/administrator/finance-platform \
./deploy-update-optimized.sh --migrate-database /home/administrator/finance-platform/migrate-v10.74-rule-exclude-conditions.sql
APP_DIR=/home/administrator/finance-platform \
./deploy-update-optimized.sh --migrate-database /home/administrator/finance-platform/migrate-v10.75-bank-flow-income-expense-view.sql
APP_DIR=/home/administrator/finance-platform \
./deploy-update-optimized.sh --migrate-database /home/administrator/finance-platform/migrate-v10.76-refund-judge-values.sql
APP_DIR=/home/administrator/finance-platform \
./deploy-update-optimized.sh --migrate-database /home/administrator/finance-platform/migrate-v10.77-recognized-bank-flow-count-cache.sql
pm2 start ticket-platform
pm2 status
```

确认 v10.74 多组排除条件表的字段、索引、外键和旧值回填正常；v10.75 收入总额和收入条数与正数流水汇总一致、纯支出待认账任务为 0；v10.76 退款数组长度、旧值回填和首值快照一致；v10.77 已认账收入流水条数与流水状态聚合一致。任一段为部分迁移、迁移顺序不正确或 v10.71/v10.72 前置结构缺失时，不要部署，也不要执行 `drizzle schema push`。

### 4. 部署代码

```bash
cd /home/administrator/finance-platform
test -s finance-platform-v10.77-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform \
ACCESS_HOST=server2.example.com \
./deploy-update-optimized.sh \
  /home/administrator/finance-platform/finance-platform-v10.77-local.tar.gz
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
curl -fsS -H 'Accept: text/html' http://server2.example.com:3001/ > /dev/null
```

确认 `finance-platform` 在线、页面显示 `v10.77`。检查明细认账规则的多组排除条件和退款多值；上传小文件验证排除、普通收入和退款入库。在日期汇总切换收入/支出，确认支出只读，收入总额、已认账条数和流水状态与实际数据一致。
