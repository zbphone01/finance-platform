# v10.66-local 部署说明

## 文件与顺序

- `releases/finance-platform-v10.66-local.tar.gz`：包含预构建 `dist/` 的认账系统部署包。
- `migrate-v10.65-invoice-order-no-fields.sql`：规则新增三项票据用单号字段。
- `migrate-v10.66-invoice-order-index-jobs.sql`：新增文件级票据索引任务表。
- `deploy-update-optimized.sh`：认账系统部署脚本。
- `docs/VERSION_SNAPSHOT_v10.66-local.md`：版本快照。

本说明只适用于从 `v10.64-local` 升级到 `v10.66-local`。数据库迁移严格按 v10.65、v10.66 顺序执行，不使用 `drizzle schema push`。完成认账系统部署后，再按票据系统 `docs/DEPLOY_v0.1.6-local.md` 执行票据侧迁移和部署。

## 测试服务器1部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.66-local.tar.gz \
  migrate-v10.65-invoice-order-no-fields.sql \
  migrate-v10.66-invoice-order-index-jobs.sql \
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
SELECT column_name
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'recognition_rules'
  AND column_name IN (
    'invoice_financial_flow_no_field',
    'invoice_business_flow_no_field',
    'invoice_merchant_order_no_field'
  )
ORDER BY column_name;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = 'invoice_order_index_jobs';

SELECT COUNT(*) AS processing_upload_count
FROM order_files
WHERE upload_status = 'processing';
SQL
```

从 v10.64 升级时前两项应返回 0 行，`processing_upload_count` 必须为 0。部分字段或任务表已经存在时停止部署，先确认是否发生过中断迁移。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

确认没有单独运行的订单上传、认账、分账或归档脚本。

### 5. 执行迁移

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.65-invoice-order-no-fields.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.66-invoice-order-index-jobs.sql
```

### 6. 迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon <<'SQL'
SELECT column_name, column_type, is_nullable
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'recognition_rules'
  AND column_name IN (
    'invoice_financial_flow_no_field',
    'invoice_business_flow_no_field',
    'invoice_merchant_order_no_field'
  )
ORDER BY column_name;

SELECT index_name, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS columns_in_index
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'invoice_order_index_jobs'
GROUP BY index_name
ORDER BY index_name;

SELECT constraint_name, delete_rule
FROM information_schema.referential_constraints
WHERE constraint_schema = DATABASE()
  AND table_name = 'invoice_order_index_jobs';
SQL
```

确认三个字段均为可空 `varchar(100)`；任务表索引包含 `PRIMARY`、`ioij_order_file_uq`、`ioij_status_available_idx`、`ioij_lease_idx`；外键 `ioij_order_file_fk` 的删除规则为 `CASCADE`。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.66-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认页面右上角显示 `v10.66`。进入明细认账规则的新建、编辑、查看页面，确认“票据用单号”位于基本信息底部，说明文案和三个输入框正常；上传测试文件后确认正常订单文件在 `invoice_order_index_jobs` 中只有一条任务。

### 9. 回退

```bash
cd /home/ubuntu/finance-platform
test -s finance-platform-v10.64-local.tar.gz
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.64-local.tar.gz
pm2 status
pm2 logs finance-platform --lines 120 --nostream
```

应用回退后保留三个规则字段和任务表，不执行破坏性 SQL 回退。

## 测试服务器2部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.66-local.tar.gz \
  migrate-v10.65-invoice-order-no-fields.sql \
  migrate-v10.66-invoice-order-index-jobs.sql \
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
SELECT column_name
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'recognition_rules'
  AND column_name IN (
    'invoice_financial_flow_no_field',
    'invoice_business_flow_no_field',
    'invoice_merchant_order_no_field'
  )
ORDER BY column_name;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = 'invoice_order_index_jobs';

SELECT COUNT(*) AS processing_upload_count
FROM order_files
WHERE upload_status = 'processing';
SQL
```

从 v10.64 升级时前两项应返回 0 行，`processing_upload_count` 必须为 0。部分结构已经存在时停止部署并确认中断原因。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

确认没有单独运行的订单上传、认账、分账或归档脚本。

### 5. 执行迁移

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.65-invoice-order-no-fields.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.66-invoice-order-index-jobs.sql
```

### 6. 迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon <<'SQL'
SELECT column_name, column_type, is_nullable
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = 'recognition_rules'
  AND column_name IN (
    'invoice_financial_flow_no_field',
    'invoice_business_flow_no_field',
    'invoice_merchant_order_no_field'
  )
ORDER BY column_name;

SELECT index_name, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS columns_in_index
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'invoice_order_index_jobs'
GROUP BY index_name
ORDER BY index_name;

SELECT constraint_name, delete_rule
FROM information_schema.referential_constraints
WHERE constraint_schema = DATABASE()
  AND table_name = 'invoice_order_index_jobs';
SQL
```

确认三个字段均为可空 `varchar(100)`，任务表四个索引完整，`ioij_order_file_fk` 删除规则为 `CASCADE`。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform \
ACCESS_HOST=server2.example.com \
./deploy-update-optimized.sh finance-platform-v10.66-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 150 --nostream
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
curl -fsS -H 'Accept: text/html' http://server2.example.com:3001/ > /dev/null
```

确认页面右上角显示 `v10.66`，规则页面配置正常，测试上传只创建一条文件级任务，日志无缺表、缺字段或构建产物错误。

### 9. 回退

```bash
cd /home/administrator/finance-platform
test -s finance-platform-v10.64-local.tar.gz
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform \
ACCESS_HOST=server2.example.com \
./deploy-update-optimized.sh finance-platform-v10.64-local.tar.gz
pm2 status
pm2 logs finance-platform --lines 120 --nostream
```

应用回退后保留三个规则字段和任务表，不执行破坏性 SQL 回退。
