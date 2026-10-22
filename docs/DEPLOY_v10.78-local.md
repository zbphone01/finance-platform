# v10.78-local 部署说明

本说明仅适用于从上一实际部署包 `v10.77-local` 升级到 `v10.78-local`。发布包为 `releases/finance-platform-v10.78-local.tar.gz`，只执行 `migrate-v10.78-refund-direction-value.sql`。本版本没有依赖变更或配置变更。

## 测试服务器1

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
test -s releases/finance-platform-v10.78-local.tar.gz
test -s deploy-update-optimized.sh
test -s migrate-v10.78-refund-direction-value.sql
TEST_SERVER1_KEY="/home/deploy/Documents/测试服务器1密钥/codex.pem"
chmod 600 "$TEST_SERVER1_KEY"
scp -i "$TEST_SERVER1_KEY" releases/finance-platform-v10.78-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.78-refund-direction-value.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 登录

```bash
TEST_SERVER1_KEY="/home/deploy/Documents/测试服务器1密钥/codex.pem"
chmod 600 "$TEST_SERVER1_KEY"
ssh -i "$TEST_SERVER1_KEY" ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
test -s .env
test -s finance-platform-v10.78-local.tar.gz
test -s deploy-update-optimized.sh
test -s migrate-v10.78-refund-direction-value.sql
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
node --version
pm2 status
```

### 3. 数据库检查和迁移（仅针对上个版本）

以上一实际部署包 `v10.77-local` 为基线。先运行一次只读检查：

```bash
cd /home/ubuntu/finance-platform
./deploy-update-optimized.sh --check-database
```

若 v10.78 显示“无需再次迁移，可以部署”，跳过本步骤其余命令。若显示需要迁移，停止两个联动应用后执行：

```bash
pm2 stop finance-platform
pm2 stop ticket-platform
./deploy-update-optimized.sh --migrate-database /home/ubuntu/finance-platform/migrate-v10.78-refund-direction-value.sql
pm2 start ticket-platform
pm2 status
```

迁移守卫仅接受单元素且非空的旧 JSON 数组，并在删除 JSON 前恢复退款单值。若检查报多值、空值、非数组或部分迁移，不要部署，也不要执行 `drizzle schema push`。

### 4. 部署代码

```bash
cd /home/ubuntu/finance-platform
test -s finance-platform-v10.78-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
./deploy-update-optimized.sh \
  /home/ubuntu/finance-platform/finance-platform-v10.78-local.tar.gz
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 `finance-platform` 在线、页面显示 `v10.78`。检查明细认账规则的“退款订单字段值”和“收支方向字段值”；上传小文件验证普通收入、直接退款、转账收入、转账支出退款与双 0 待匹配。

## 测试服务器2

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
test -s releases/finance-platform-v10.78-local.tar.gz
test -s deploy-update-optimized.sh
test -s migrate-v10.78-refund-direction-value.sql
scp releases/finance-platform-v10.78-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.78-refund-direction-value.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

### 2. 登录

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
test -s .env
test -s finance-platform-v10.78-local.tar.gz
test -s deploy-update-optimized.sh
test -s migrate-v10.78-refund-direction-value.sql
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
node --version
pm2 status
```

### 3. 数据库检查和迁移（仅针对上个版本）

以上一实际部署包 `v10.77-local` 为基线。先运行一次只读检查：

```bash
cd /home/administrator/finance-platform
APP_DIR=/home/administrator/finance-platform \
./deploy-update-optimized.sh --check-database
```

若 v10.78 显示“无需再次迁移，可以部署”，跳过本步骤其余命令。若显示需要迁移，停止两个联动应用后执行：

```bash
pm2 stop finance-platform
pm2 stop ticket-platform
APP_DIR=/home/administrator/finance-platform \
./deploy-update-optimized.sh --migrate-database /home/administrator/finance-platform/migrate-v10.78-refund-direction-value.sql
pm2 start ticket-platform
pm2 status
```

迁移守卫仅接受单元素且非空的旧 JSON 数组，并在删除 JSON 前恢复退款单值。若检查报多值、空值、非数组或部分迁移，不要部署，也不要执行 `drizzle schema push`。

### 4. 部署代码

```bash
cd /home/administrator/finance-platform
test -s finance-platform-v10.78-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform \
ACCESS_HOST=server2.example.com \
./deploy-update-optimized.sh \
  /home/administrator/finance-platform/finance-platform-v10.78-local.tar.gz
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
curl -fsS -H 'Accept: text/html' http://server2.example.com:3001/ > /dev/null
```

确认 `finance-platform` 在线、页面显示 `v10.78`。检查明细认账规则的“退款订单字段值”和“收支方向字段值”；上传小文件验证普通收入、直接退款、转账收入、转账支出退款与双 0 待匹配。
