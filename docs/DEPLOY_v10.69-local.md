# v10.69-local 部署说明

本说明仅适用于从 `v10.68-local` 升级到 `v10.69-local`。发布包为 `releases/finance-platform-v10.69-local.tar.gz`，部署脚本为 `deploy-update-optimized.sh`。本版本没有数据库迁移、依赖变更或配置变更。

## 测试服务器1

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.69-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 登录

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
```

### 3. 数据库检查和迁移（仅针对上个版本）

以下检查只适用于从 `v10.68-local` 升级。本版本不执行 SQL 迁移。

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon <<'SQL'
SELECT DATABASE() AS database_name, VERSION() AS mysql_version;
SELECT COUNT(*) AS required_table_count
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN ('recognition_tasks', 'bill_details', 'detail_split_files');
SQL
```

确认 `database_name` 为 `finance_recon`，`required_table_count` 为 `3`。不要执行历史版本迁移，也不要执行 `drizzle schema push`。

### 4. 部署代码

```bash
test -s finance-platform-v10.69-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh \
  /home/ubuntu/finance-platform/finance-platform-v10.69-local.tar.gz
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 `finance-platform` 在线、健康检查通过、页面右上角显示 `v10.69`，日志没有新的明细分账认账错误。

## 测试服务器2

### 1. 上传

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.69-local.tar.gz \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

### 2. 登录

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
```

### 3. 数据库检查和迁移（仅针对上个版本）

以下检查只适用于从 `v10.68-local` 升级。本版本不执行 SQL 迁移。

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon <<'SQL'
SELECT DATABASE() AS database_name, VERSION() AS mysql_version;
SELECT COUNT(*) AS required_table_count
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN ('recognition_tasks', 'bill_details', 'detail_split_files');
SQL
```

确认 `database_name` 为 `finance_recon`，`required_table_count` 为 `3`。不要执行历史版本迁移，也不要执行 `drizzle schema push`。

### 4. 部署代码

```bash
test -s finance-platform-v10.69-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform \
ACCESS_HOST=server2.example.com \
./deploy-update-optimized.sh \
  /home/administrator/finance-platform/finance-platform-v10.69-local.tar.gz
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
curl -fsS -H 'Accept: text/html' http://server2.example.com:3001/ > /dev/null
```

确认 `finance-platform` 在线、内外网健康检查通过、页面右上角显示 `v10.69`，日志没有新的明细分账认账错误。
