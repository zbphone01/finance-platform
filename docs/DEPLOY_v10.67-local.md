# v10.67-local 部署说明

## 文件与顺序

- `releases/finance-platform-v10.67-local.tar.gz`：包含预构建 `dist/` 的认账平台发布包。
- `migrate-v10.67-recognized-invoice-projection-jobs.sql`：新增认账后票据窄表投影任务。
- `deploy-update-optimized.sh`：认账平台部署脚本。
- `docs/VERSION_SNAPSHOT_v10.67-local.md`：版本快照。

本说明只适用于从 `v10.66-local` 升级到 `v10.67-local`。必须先完成认账平台 v10.67，再执行票据平台 `docs/DEPLOY_v0.1.8-local.md`；不要使用 `drizzle schema push`。部署脚本不会自动执行 SQL。

## 测试服务器1部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
test -s releases/finance-platform-v10.67-local.tar.gz
test -s migrate-v10.67-recognized-invoice-projection-jobs.sql
test -s deploy-update-optimized.sh
scp releases/finance-platform-v10.67-local.tar.gz \
  migrate-v10.67-recognized-invoice-projection-jobs.sql \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 登录服务器

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
```

### 3. 迁移前检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon <<'SQL'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN ('invoice_order_index_jobs', 'invoice_recognized_projection_jobs')
ORDER BY table_name;

SELECT COUNT(*) AS processing_upload_count
FROM order_files
WHERE upload_status = 'processing';

SELECT status, COUNT(*) AS task_count
FROM invoice_order_index_jobs
GROUP BY status
ORDER BY status;
SQL
```

确认旧 `invoice_order_index_jobs` 存在、新 `invoice_recognized_projection_jobs` 不存在，且 `processing_upload_count = 0`。若新表已存在，先按迁移后检查确认结构完整再决定是否继续。

### 4. 停止认账应用

```bash
pm2 stop finance-platform
pm2 status
```

确认没有单独运行的订单上传、认账、分账或归档脚本。

### 5. 执行迁移

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.67-recognized-invoice-projection-jobs.sql
```

### 6. 迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon <<'SQL'
SELECT index_name, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS columns_in_index
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'invoice_recognized_projection_jobs'
GROUP BY index_name
ORDER BY index_name;

SELECT constraint_name, delete_rule
FROM information_schema.referential_constraints
WHERE constraint_schema = DATABASE()
  AND table_name = 'invoice_recognized_projection_jobs';

SELECT status, COUNT(*) AS task_count, SUM(system_error_count) AS errors
FROM invoice_recognized_projection_jobs
GROUP BY status
ORDER BY status;
SQL
```

确认索引包含 `PRIMARY`、`riopj_order_file_uq`、`riopj_status_available_idx`、`riopj_lease_idx`，外键 `riopj_order_file_fk` 的删除规则为 `CASCADE`；历史任务处于 `queued` 属正常状态。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.67-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认页面右上角显示 `v10.67`，日志无 `invoice_recognized_projection_jobs` 缺表错误。随后继续部署票据平台 v0.1.8；票据平台启动前历史任务保持排队不会影响认账。

### 9. 回退

```bash
cd /home/ubuntu/finance-platform
test -s finance-platform-v10.66-local.tar.gz
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.66-local.tar.gz
pm2 status
pm2 logs finance-platform --lines 120 --nostream
```

保留 v10.67 任务表，不执行破坏性 SQL。若票据平台已升级到 v0.1.8，应同步回退到 v0.1.6。

## 测试服务器2部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
test -s releases/finance-platform-v10.67-local.tar.gz
test -s migrate-v10.67-recognized-invoice-projection-jobs.sql
test -s deploy-update-optimized.sh
scp releases/finance-platform-v10.67-local.tar.gz \
  migrate-v10.67-recognized-invoice-projection-jobs.sql \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

### 2. 登录服务器

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
```

### 3. 迁移前检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon <<'SQL'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name IN ('invoice_order_index_jobs', 'invoice_recognized_projection_jobs')
ORDER BY table_name;

SELECT COUNT(*) AS processing_upload_count
FROM order_files
WHERE upload_status = 'processing';

SELECT status, COUNT(*) AS task_count
FROM invoice_order_index_jobs
GROUP BY status
ORDER BY status;
SQL
```

确认旧任务表存在、新投影任务表不存在，且 `processing_upload_count = 0`。新表已存在时停止并检查是否已经执行过迁移。

### 4. 停止认账应用

```bash
pm2 stop finance-platform
pm2 status
```

确认没有单独运行的订单上传、认账、分账或归档脚本。

### 5. 执行迁移

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.67-recognized-invoice-projection-jobs.sql
```

### 6. 迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon <<'SQL'
SELECT index_name, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS columns_in_index
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'invoice_recognized_projection_jobs'
GROUP BY index_name
ORDER BY index_name;

SELECT constraint_name, delete_rule
FROM information_schema.referential_constraints
WHERE constraint_schema = DATABASE()
  AND table_name = 'invoice_recognized_projection_jobs';

SELECT status, COUNT(*) AS task_count, SUM(system_error_count) AS errors
FROM invoice_recognized_projection_jobs
GROUP BY status
ORDER BY status;
SQL
```

确认四个索引、`CASCADE` 外键和历史排队任务均符合版本快照。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform \
ACCESS_HOST=server2.example.com \
./deploy-update-optimized.sh finance-platform-v10.67-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
curl -fsS -H 'Accept: text/html' http://server2.example.com:3001/ > /dev/null
```

确认页面显示 `v10.67`，日志无缺表或投影任务登记错误；随后继续部署票据平台 v0.1.8。

### 9. 回退

```bash
cd /home/administrator/finance-platform
test -s finance-platform-v10.66-local.tar.gz
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform \
ACCESS_HOST=server2.example.com \
./deploy-update-optimized.sh finance-platform-v10.66-local.tar.gz
pm2 status
pm2 logs finance-platform --lines 120 --nostream
```

保留 v10.67 任务表。若票据平台已部署 v0.1.8，同步回退票据平台到 v0.1.6。
