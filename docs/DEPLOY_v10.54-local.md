# v10.54-local 部署说明

## 文件

- `releases/finance-platform-v10.54-local.tar.gz`：包含预构建 `dist/` 的 v10.54 部署包
- `migrate-v10.54-drop-bill-details-legacy-dedupe-index.sql`：主表旧去重唯一索引清理迁移
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.54-local.md`：版本快照

## 重要说明

- 本说明仅适用于从 v10.53 升级到 v10.54；更早版本先按对应历史部署说明补齐到 v10.53。
- 本版本必须执行 `migrate-v10.54-drop-bill-details-legacy-dedupe-index.sql`，不执行 `drizzle schema push`。
- 迁移只处理 `bill_details` 主表，不修改 `bill_details_archive_YYYYMM` 月归档表。
- 迁移在删除旧索引前确认新唯一索引存在、可见且定义正确；旧索引已不存在时安全跳过，因此已手工清理的测试服务器也要执行迁移。
- `ALTER TABLE` 会隐式提交；停止应用后再迁移，避免迁移期间产生新的写入和业务抖动。
- 部署包必须包含本地验证通过的 `dist/boot.js`、`dist/public/index.html` 和前端资源；部署脚本不会在服务器执行 `npm run build`。

## 测试服务器1部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.54-local.tar.gz \
  migrate-v10.54-drop-bill-details-legacy-dedupe-index.sql \
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
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "
SELECT index_name, non_unique, seq_in_index, column_name, is_visible
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'bill_details'
  AND index_name IN (
    'bd_rule_partition_date_bill_no_uq',
    'bd_rule_bill_date_bill_no_partition_uq'
  )
ORDER BY index_name, seq_in_index;
"
```

必须看到新索引 `bd_rule_bill_date_bill_no_partition_uq` 的 4 行，`non_unique=0`、`is_visible=YES`，列顺序依次为 `rule_id`、`bill_date`、`bill_no`、`partition_date`。旧索引可以存在，也可以已经不存在；新索引不符合要求时停止部署。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 执行迁移

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon \
  < migrate-v10.54-drop-bill-details-legacy-dedupe-index.sql
```

脚本正常完成时只输出新索引的 4 行。出现 `v10.54 migration aborted` 时不要继续部署，先恢复应用并检查新索引。

### 6. 迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "
SELECT index_name, non_unique, seq_in_index, column_name, is_visible
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'bill_details'
  AND index_name IN (
    'bd_rule_partition_date_bill_no_uq',
    'bd_rule_bill_date_bill_no_partition_uq'
  )
ORDER BY index_name, seq_in_index;

SELECT table_name, index_name
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name LIKE 'bill_details_archive\\_%'
  AND index_name = 'bd_rule_partition_date_bill_no_uq'
GROUP BY table_name, index_name
ORDER BY table_name;
"
```

主表查询只能看到新索引 4 行，不能再出现旧索引；归档表结果仅用于确认迁移没有扩大范围，不要求所有归档表结构一致。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.54-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 curl 返回成功、页面右上角显示 `v10.54`，且部署后日志没有新增数据库迁移、预构建产物缺失或启动失败错误。

## 测试服务器2部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.54-local.tar.gz \
  migrate-v10.54-drop-bill-details-legacy-dedupe-index.sql \
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
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "
SELECT index_name, non_unique, seq_in_index, column_name, is_visible
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'bill_details'
  AND index_name IN (
    'bd_rule_partition_date_bill_no_uq',
    'bd_rule_bill_date_bill_no_partition_uq'
  )
ORDER BY index_name, seq_in_index;
"
```

必须看到新索引 `bd_rule_bill_date_bill_no_partition_uq` 的 4 行，`non_unique=0`、`is_visible=YES`，列顺序依次为 `rule_id`、`bill_date`、`bill_no`、`partition_date`。旧索引可以存在，也可以已经不存在；新索引不符合要求时停止部署。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 执行迁移

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon \
  < migrate-v10.54-drop-bill-details-legacy-dedupe-index.sql
```

脚本正常完成时只输出新索引的 4 行。出现 `v10.54 migration aborted` 时不要继续部署，先恢复应用并检查新索引。

### 6. 迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "
SELECT index_name, non_unique, seq_in_index, column_name, is_visible
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'bill_details'
  AND index_name IN (
    'bd_rule_partition_date_bill_no_uq',
    'bd_rule_bill_date_bill_no_partition_uq'
  )
ORDER BY index_name, seq_in_index;

SELECT table_name, index_name
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name LIKE 'bill_details_archive\\_%'
  AND index_name = 'bd_rule_partition_date_bill_no_uq'
GROUP BY table_name, index_name
ORDER BY table_name;
"
```

主表查询只能看到新索引 4 行，不能再出现旧索引；归档表结果仅用于确认迁移没有扩大范围，不要求所有归档表结构一致。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.54-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 curl 返回成功、页面右上角显示 `v10.54`，且部署后日志没有新增数据库迁移、预构建产物缺失或启动失败错误。

## 功能验证

- 页面右上角显示 `v10.54`。
- 上传包含重复订单号的订单明细，确认仍按 `rule_id + bill_date + bill_no` 去重。
- 上传新订单明细，确认写入成功且没有唯一键冲突异常。
- 查看订单包、日期详情和归档历史订单，确认数据展示正常。
- 确认 v10.53 的跨应用数据库重任务互斥、明细分账上传、取消认账和凭证多模板功能保持正常。

## 回退

- 代码可使用 `releases/finance-platform-v10.53-local.tar.gz` 回退；代码回退不会自动恢复数据库索引。
- 如必须恢复旧索引，先停止应用并确认主表不存在同名索引，再执行：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "
ALTER TABLE bill_details
  ADD UNIQUE INDEX bd_rule_partition_date_bill_no_uq
    (rule_id, partition_date, bill_date, bill_no),
  ALGORITHM = INPLACE,
  LOCK = NONE;
"
```

- 新索引必须继续保留；重建旧唯一索引会增加写入维护和磁盘占用。
- 单次部署在切换前会把旧运行产物保留为 `backups/dist.rollback.<部署批次>`；启动或健康检查失败时脚本自动恢复该固定回滚点。
- 自动回滚失败时停止重复部署，保留 `dist.failed.<部署批次>` 并人工核查。
