# v10.73-local 部署说明

本说明仅适用于从 `v10.72-local` 升级到 `v10.73-local`。发布包为 `releases/finance-platform-v10.73-local.tar.gz`，部署脚本为 `deploy-update-optimized.sh`。本版本没有数据库迁移、依赖变更或配置变更。

## 测试服务器1

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
test -s releases/finance-platform-v10.73-local.tar.gz
test -s deploy-update-optimized.sh
TEST_SERVER1_KEY="/home/deploy/Documents/测试服务器1密钥/codex.pem"
chmod 600 "$TEST_SERVER1_KEY"
scp -i "$TEST_SERVER1_KEY" releases/finance-platform-v10.73-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 登录

```bash
TEST_SERVER1_KEY="/home/deploy/Documents/测试服务器1密钥/codex.pem"
chmod 600 "$TEST_SERVER1_KEY"
ssh -i "$TEST_SERVER1_KEY" ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
test -s .env
test -s finance-platform-v10.73-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
node --version
pm2 status
```

### 3. 数据库检查和迁移（仅针对上个版本）

以下检查只适用于从 `v10.72-local` 升级。本版本不执行 SQL 迁移。

```bash
cd /home/ubuntu/finance-platform
./deploy-update-optimized.sh --check-database
```

确认显示“v10.72 不认账明细数据库迁移已完成，无需再次迁移，可以部署”，并且三张不认账表、字段、索引、外键及 v10.71 前置结构检查全部通过。如果提示需要创建不认账表、数据库状态混合、缺少历史字段或仍有运行任务，说明目标环境不是完整的 `v10.72-local` 状态，不要部署 v10.73，也不要在本步骤补执行历史迁移或 `drizzle schema push`。

### 4. 部署代码

```bash
cd /home/ubuntu/finance-platform
test -s finance-platform-v10.73-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
./deploy-update-optimized.sh \
  /home/ubuntu/finance-platform/finance-platform-v10.73-local.tar.gz
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 `finance-platform` 在线、页面显示 `v10.73`；打开“上传订单明细”，规则使用无搜索输入框的普通 `Select`，触发框与展开后的选项列表左右边界一致，并按“明细认账”“不认账明细”分组。使用 macOS 鼠标滚轮、触控板和键盘检查长列表能够滚动，再分别选择普通规则、打包明细、多日汇总和不认账规则，确认到账日期与说明文案仍按规则正确联动。

## 测试服务器2

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
test -s releases/finance-platform-v10.73-local.tar.gz
test -s deploy-update-optimized.sh
scp releases/finance-platform-v10.73-local.tar.gz \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

### 2. 登录

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
test -s .env
test -s finance-platform-v10.73-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
node --version
pm2 status
```

### 3. 数据库检查和迁移（仅针对上个版本）

以下检查只适用于从 `v10.72-local` 升级。本版本不执行 SQL 迁移。

```bash
cd /home/administrator/finance-platform
APP_DIR=/home/administrator/finance-platform \
./deploy-update-optimized.sh --check-database
```

确认显示“v10.72 不认账明细数据库迁移已完成，无需再次迁移，可以部署”，并且三张不认账表、字段、索引、外键及 v10.71 前置结构检查全部通过。如果提示需要创建不认账表、数据库状态混合、缺少历史字段或仍有运行任务，说明目标环境不是完整的 `v10.72-local` 状态，不要部署 v10.73，也不要在本步骤补执行历史迁移或 `drizzle schema push`。

### 4. 部署代码

```bash
cd /home/administrator/finance-platform
test -s finance-platform-v10.73-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform \
ACCESS_HOST=server2.example.com \
./deploy-update-optimized.sh \
  /home/administrator/finance-platform/finance-platform-v10.73-local.tar.gz
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
curl -fsS -H 'Accept: text/html' http://server2.example.com:3001/ > /dev/null
```

确认 `finance-platform` 在线、页面显示 `v10.73`；打开“上传订单明细”，规则使用无搜索输入框的普通 `Select`，触发框与展开后的选项列表左右边界一致，并按“明细认账”“不认账明细”分组。使用 macOS 鼠标滚轮、触控板和键盘检查长列表能够滚动，再分别选择普通规则、打包明细、多日汇总和不认账规则，确认到账日期与说明文案仍按规则正确联动。
