# v10.68-local 部署说明

## 文件、适用范围与迁移状态

- `releases/finance-platform-v10.68-local.tar.gz`：包含预构建 `dist/` 的认账平台发布包。
- `deploy-update-optimized.sh`：认账平台部署脚本。
- `docs/VERSION_SNAPSHOT_v10.68-local.md`：本版本实际发布内容、验证结果和回退风险。
- `docs/DEPLOY_v10.68-local.md`：本部署说明。

本说明适用于已经部署 `v10.67-local` 且 `invoice_recognized_projection_jobs` 迁移已完成的环境。v10.68 不新增数据库迁移、依赖或配置，部署过程中不执行 SQL 写入，也不会删除 `invoice_order_index_jobs` 或 `invoice_order_identifiers`。

票据平台版本升级与旧索引表清理不属于本部署步骤。认账 v10.68 可以先单独部署，旧表保持不变；待票据平台对应版本完成部署后，再按票据平台部署文档独立判断是否执行清理迁移。

## 测试服务器1部署

### 1. 本地检查发布文件

```bash
cd /home/deploy/Documents/资金池认账
test -s releases/finance-platform-v10.68-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
tar -tzf releases/finance-platform-v10.68-local.tar.gz | grep -E '^\./dist/(boot\.js|public/index\.html)$'
```

### 2. 准备目录并上传

```bash
ssh ubuntu@server1.example.com
mkdir -p /home/ubuntu/finance-platform
node --version
npm --version
pm2 --version
exit

cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.68-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 3. 登录服务器并检查环境

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
test -f .env
test -s finance-platform-v10.68-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
grep -E '^(DATABASE_URL|APP_SECRET|PORT)=' .env | sed 's/=.*/=<已配置>/'
pm2 status
```

确认 `finance-platform` 当前在线，数据库和应用密钥配置仍存在。

### 4. 部署前只读检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon <<'SQL'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN (
    'invoice_order_index_jobs',
    'invoice_order_identifiers',
    'invoice_recognized_projection_jobs'
  )
ORDER BY table_name;

SELECT status, COUNT(*) AS task_count,
       COALESCE(SUM(system_error_count), 0) AS system_errors
FROM invoice_recognized_projection_jobs
GROUP BY status
ORDER BY status;
SQL
```

确认新投影任务表存在并记录任务状态。旧表存在属于预期，本版本不删除它们；本版本没有数据库迁移，不执行任何 SQL 文件。

### 5. 部署应用

```bash
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh \
  /home/ubuntu/finance-platform/finance-platform-v10.68-local.tar.gz
```

### 6. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
grep -R -n -E 'invoice_order_index_jobs|invoice_order_identifiers' \
  dist/boot.js dist/public || true
```

确认 `finance-platform` 在线、健康检查通过、页面右上角显示 `v10.68`，最后一条搜索没有输出，日志无新投影任务缺表或认账异常。

### 7. 回退到 v10.67-local

```bash
cd /home/ubuntu/finance-platform
test -s finance-platform-v10.67-local.tar.gz
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh \
  /home/ubuntu/finance-platform/finance-platform-v10.67-local.tar.gz
pm2 status
pm2 logs finance-platform --lines 120 --nostream
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

本版本没有数据库迁移，回退时不执行 SQL，也不删除新旧投影任务或索引表。

## 测试服务器2部署

### 1. 本地检查发布文件

```bash
cd /home/deploy/Documents/资金池认账
test -s releases/finance-platform-v10.68-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
tar -tzf releases/finance-platform-v10.68-local.tar.gz | grep -E '^\./dist/(boot\.js|public/index\.html)$'
```

### 2. 准备目录并上传

```bash
ssh administrator@server2.example.com
mkdir -p /home/administrator/finance-platform
node --version
npm --version
pm2 --version
exit

cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.68-local.tar.gz \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

### 3. 登录服务器并检查环境

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
test -f .env
test -s finance-platform-v10.68-local.tar.gz
test -s deploy-update-optimized.sh
bash -n deploy-update-optimized.sh
grep -E '^(DATABASE_URL|APP_SECRET|PORT)=' .env | sed 's/=.*/=<已配置>/'
pm2 status
```

确认 `finance-platform` 当前在线，数据库和应用密钥配置保持不变。

### 4. 部署前只读检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon <<'SQL'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN (
    'invoice_order_index_jobs',
    'invoice_order_identifiers',
    'invoice_recognized_projection_jobs'
  )
ORDER BY table_name;

SELECT status, COUNT(*) AS task_count,
       COALESCE(SUM(system_error_count), 0) AS system_errors
FROM invoice_recognized_projection_jobs
GROUP BY status
ORDER BY status;
SQL
```

确认新投影任务表存在并记录状态。旧表仍存在不阻止升级；v10.68 不执行 SQL，也不清理旧表。

### 5. 部署应用

```bash
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform \
ACCESS_HOST=server2.example.com \
./deploy-update-optimized.sh \
  /home/administrator/finance-platform/finance-platform-v10.68-local.tar.gz
```

### 6. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
curl -fsS -H 'Accept: text/html' http://server2.example.com:3001/ > /dev/null
grep -R -n -E 'invoice_order_index_jobs|invoice_order_identifiers' \
  dist/boot.js dist/public || true
```

确认应用在线、内外网健康检查通过、页面显示 `v10.68`，搜索没有输出，日志无新投影或认账异常。

### 7. 回退到 v10.67-local

```bash
cd /home/administrator/finance-platform
test -s finance-platform-v10.67-local.tar.gz
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform \
ACCESS_HOST=server2.example.com \
./deploy-update-optimized.sh \
  /home/administrator/finance-platform/finance-platform-v10.67-local.tar.gz
pm2 status
pm2 logs finance-platform --lines 120 --nostream
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

回退不执行数据库写入，不删除任何投影任务、窄表或旧索引表。

