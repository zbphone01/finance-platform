# v10.45-local 部署说明

## 文件

- `releases/finance-platform-v10.45-local.tar.gz`：v10.45 部署包
- `migrate-v10.45-multi-day-detail-matching.sql`：v10.45 多日汇总匹配迁移
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.45-local.md`：版本快照

## 重要说明

- 本部署说明仅适用于从上一版本 v10.44 升级到 v10.45，只需执行 `migrate-v10.45-multi-day-detail-matching.sql`。
- 已经执行过的迁移不得重复执行；v10.45 脚本包含枚举修改和新增字段，重复执行会失败。
- 部署脚本不会自动执行 SQL，也不会执行 `drizzle schema push`。
- 检查、停止应用、迁移、迁移后检查、部署和最终验证必须逐步执行。

## 测试服务器1部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.45-local.tar.gz \
  migrate-v10.45-multi-day-detail-matching.sql \
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
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM counterparty_records LIKE 'detail_matching_mode'; SHOW TABLES LIKE 'multi_day_match_groups'; SHOW TABLES LIKE 'multi_day_match_group_flows'; SHOW COLUMNS FROM order_files LIKE 'multi_day_match_group_id'; SHOW VARIABLES LIKE 'event_scheduler'; SHOW EVENTS WHERE Db = DATABASE() AND Name IN ('ev_bill_details_rolling_partitions','ev_bill_details_archive_old_daily_partitions');"
```

- 枚举没有 `多日汇总匹配`，两张新表和关联字段均不存在：执行 v10.45 迁移。
- 枚举、新表、字段和索引均已存在：不要重复执行 v10.45 迁移。
- 只有部分结构存在：停止部署，核查此前迁移中断原因。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 执行数据库迁移

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.45-multi-day-detail-matching.sql
```

### 6. 迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM counterparty_records LIKE 'detail_matching_mode'; SHOW CREATE TABLE multi_day_match_groups; SHOW CREATE TABLE multi_day_match_group_flows; SHOW COLUMNS FROM order_files LIKE 'multi_day_match_group_id'; SHOW INDEX FROM order_files WHERE Key_name = 'of_multi_day_match_group_idx'; SHOW EVENTS WHERE Db = DATABASE() AND Name IN ('ev_bill_details_rolling_partitions','ev_bill_details_archive_old_daily_partitions');"
```

确认枚举包含 `多日汇总匹配`，两张新表、关联字段和索引均存在。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.45-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
```

## 测试服务器2部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.45-local.tar.gz \
  migrate-v10.45-multi-day-detail-matching.sql \
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
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM counterparty_records LIKE 'detail_matching_mode'; SHOW TABLES LIKE 'multi_day_match_groups'; SHOW TABLES LIKE 'multi_day_match_group_flows'; SHOW COLUMNS FROM order_files LIKE 'multi_day_match_group_id'; SHOW VARIABLES LIKE 'event_scheduler'; SHOW EVENTS WHERE Db = DATABASE() AND Name IN ('ev_bill_details_rolling_partitions','ev_bill_details_archive_old_daily_partitions');"
```

- 枚举没有 `多日汇总匹配`，两张新表和关联字段均不存在：执行 v10.45 迁移。
- 枚举、新表、字段和索引均已存在：不要重复执行 v10.45 迁移。
- 只有部分结构存在：停止部署，核查此前迁移中断原因。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 执行迁移

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.45-multi-day-detail-matching.sql
```

### 6. 迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM counterparty_records LIKE 'detail_matching_mode'; SHOW CREATE TABLE multi_day_match_groups; SHOW CREATE TABLE multi_day_match_group_flows; SHOW COLUMNS FROM order_files LIKE 'multi_day_match_group_id'; SHOW INDEX FROM order_files WHERE Key_name = 'of_multi_day_match_group_idx'; SHOW EVENTS WHERE Db = DATABASE() AND Name IN ('ev_bill_details_rolling_partitions','ev_bill_details_archive_old_daily_partitions');"
```

确认枚举包含 `多日汇总匹配`，两张新表、关联字段和索引均存在。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.45-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角显示 `v10.45`。
- 到账信息可选择 `多日汇总匹配`，选择后明细包类型固定为 `打包明细`。
- 上传无匹配方案的多日订单包后显示 `入库完成` 和 `流水未匹配`，日期显示 `-`。
- 单笔等额流水可自动匹配；多个等额单笔或多个组合方案时显示 `匹配待确认`，弹窗不超过 3 组。
- 新增银行到账和所选日期 `开始认账` 能触发多日匹配，唯一方案自动进入认账队列。
- 认账完成后，订单包只显示在最新到账日期，组内全部银行流水均为已认账。
- 凭证汇总显示 `凭证日期`；多日汇总凭证关联全部流水，日期取最新到账日期，详情显示起止日期和流水笔数。
- `npm run --silent db:events:ensure -- --check-only` 返回两个 Event 校验通过。

## 回退

- 代码可使用 `releases/finance-platform-v10.44-local.tar.gz` 回退。
- 回退前停止新增多日订单包，并核查多日匹配配置和匹配组状态。
- v10.45 新增表和字段可以暂时保留，不建议在紧急代码回退时立即删除。
- 本说明不提供数据库结构回退操作；不要直接删除仍被订单包引用的表或字段。
