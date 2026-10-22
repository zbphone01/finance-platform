# v10.46-local 部署说明

## 文件

- `releases/finance-platform-v10.46-local.tar.gz`：v10.46 部署包
- `migrate-v10.46-same-day-single-task.sql`：v10.46 同日汇总单任务迁移
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.46-local.md`：版本快照

## 重要说明

- 本部署说明仅适用于从 v10.45 升级到 v10.46，只执行 `migrate-v10.46-same-day-single-task.sql`。
- 已执行过的迁移不得重复执行；部署脚本不会自动执行 SQL，也不会执行 `drizzle schema push`。
- 迁移会直接回填只有一个历史任务的同日汇总分组；历史重复分组保持空标记，后续由应用事务归并。
- 检查、停止应用、迁移、迁移后检查、部署和最终验证必须逐步执行。

## 测试服务器1部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.46-local.tar.gz \
  migrate-v10.46-same-day-single-task.sql \
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
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_tasks LIKE 'same_day_counterparty_id'; SHOW INDEX FROM recognition_tasks WHERE Key_name = 'rt_same_day_counterparty_date_uq'; SELECT rt.bill_date, cr.id AS counterparty_id, COUNT(*) AS task_count FROM recognition_tasks rt INNER JOIN recognition_rules rr ON rr.id = rt.rule_id INNER JOIN counterparty_records cr ON cr.alias = rr.matched_counterparty_alias AND cr.recognition_type = '明细认账' AND cr.detail_matching_mode = '同日汇总匹配' GROUP BY rt.bill_date, cr.id HAVING COUNT(*) > 1 ORDER BY rt.bill_date DESC LIMIT 20; SHOW VARIABLES LIKE 'event_scheduler'; SHOW EVENTS WHERE Db = DATABASE() AND Name IN ('ev_bill_details_rolling_partitions','ev_bill_details_archive_old_daily_partitions');"
```

- 字段和索引均不存在：执行 v10.46 迁移。
- 字段和索引均已存在：不要重复执行迁移。
- 只有部分结构存在：停止部署并核查此前迁移中断原因。
- 历史重复分组可以存在，不需要在执行迁移前手工合并。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 执行数据库迁移

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.46-same-day-single-task.sql
```

### 6. 迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_tasks LIKE 'same_day_counterparty_id'; SHOW INDEX FROM recognition_tasks WHERE Key_name = 'rt_same_day_counterparty_date_uq'; SELECT COUNT(*) AS assigned_same_day_tasks FROM recognition_tasks WHERE same_day_counterparty_id IS NOT NULL; SELECT rt.bill_date, cr.id AS counterparty_id, COUNT(*) AS task_count, SUM(rt.same_day_counterparty_id IS NULL) AS null_marker_count FROM recognition_tasks rt INNER JOIN recognition_rules rr ON rr.id = rt.rule_id INNER JOIN counterparty_records cr ON cr.alias = rr.matched_counterparty_alias AND cr.recognition_type = '明细认账' AND cr.detail_matching_mode = '同日汇总匹配' GROUP BY rt.bill_date, cr.id HAVING COUNT(*) > 1 ORDER BY rt.bill_date DESC LIMIT 20; SHOW EVENTS WHERE Db = DATABASE() AND Name IN ('ev_bill_details_rolling_partitions','ev_bill_details_archive_old_daily_partitions');"
```

确认字段与唯一索引存在。历史重复分组可继续保持空标记；同时确认两个订单明细 Event 可用。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.46-local.tar.gz
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
scp releases/finance-platform-v10.46-local.tar.gz \
  migrate-v10.46-same-day-single-task.sql \
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
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_tasks LIKE 'same_day_counterparty_id'; SHOW INDEX FROM recognition_tasks WHERE Key_name = 'rt_same_day_counterparty_date_uq'; SELECT rt.bill_date, cr.id AS counterparty_id, COUNT(*) AS task_count FROM recognition_tasks rt INNER JOIN recognition_rules rr ON rr.id = rt.rule_id INNER JOIN counterparty_records cr ON cr.alias = rr.matched_counterparty_alias AND cr.recognition_type = '明细认账' AND cr.detail_matching_mode = '同日汇总匹配' GROUP BY rt.bill_date, cr.id HAVING COUNT(*) > 1 ORDER BY rt.bill_date DESC LIMIT 20; SHOW VARIABLES LIKE 'event_scheduler'; SHOW EVENTS WHERE Db = DATABASE() AND Name IN ('ev_bill_details_rolling_partitions','ev_bill_details_archive_old_daily_partitions');"
```

- 字段和索引均不存在：执行 v10.46 迁移。
- 字段和索引均已存在：不要重复执行迁移。
- 只有部分结构存在：停止部署并核查此前迁移中断原因。
- 历史重复分组可以存在，不需要在执行迁移前手工合并。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 执行数据库迁移

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.46-same-day-single-task.sql
```

### 6. 迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_tasks LIKE 'same_day_counterparty_id'; SHOW INDEX FROM recognition_tasks WHERE Key_name = 'rt_same_day_counterparty_date_uq'; SELECT COUNT(*) AS assigned_same_day_tasks FROM recognition_tasks WHERE same_day_counterparty_id IS NOT NULL; SELECT rt.bill_date, cr.id AS counterparty_id, COUNT(*) AS task_count, SUM(rt.same_day_counterparty_id IS NULL) AS null_marker_count FROM recognition_tasks rt INNER JOIN recognition_rules rr ON rr.id = rt.rule_id INNER JOIN counterparty_records cr ON cr.alias = rr.matched_counterparty_alias AND cr.recognition_type = '明细认账' AND cr.detail_matching_mode = '同日汇总匹配' GROUP BY rt.bill_date, cr.id HAVING COUNT(*) > 1 ORDER BY rt.bill_date DESC LIMIT 20; SHOW EVENTS WHERE Db = DATABASE() AND Name IN ('ev_bill_details_rolling_partitions','ev_bill_details_archive_old_daily_partitions');"
```

确认字段与唯一索引存在。历史重复分组可继续保持空标记；同时确认两个订单明细 Event 可用。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.46-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角显示 `v10.46`。
- 编辑到账信息时凭证收款渠道可通过下拉框内清空图标取消选择，保存空值成功。
- 同一天、同一到账信息新增多笔银行流水后，数据库只保留一个带 `same_day_counterparty_id` 的聚合任务；新增流水或订单明细只提交一次认账队列。
- 待认账明细金额大于流水剩余可认账金额时不执行认账并显示金额异常；小于等于时执行默认明细认账。
- 认账结束后按流水顺序正确显示已认账、部分认账和未认账。
- 未绑定订单包的未认账流水可通过删除图标和确认弹窗删除；任务已绑定订单包或流水已绑定多日匹配组时删除图标禁用，接口也拒绝删除。
- 横向滚动银行流水列表并悬停行时，差额金额和状态固定列背景与行悬停一致，且不会透出后方列内容。
- `npm run --silent db:events:ensure -- --check-only` 返回订单明细 Event 校验通过。

## 回退

- 代码可使用 `releases/finance-platform-v10.45-local.tar.gz` 回退。
- v10.46 新增可空字段和唯一索引可以暂时保留，不建议紧急代码回退时立即删除。
- 新版已经归并的历史同日汇总任务不会因代码回退自动拆分；需要恢复旧任务结构时应使用部署前数据库备份。
- 本说明不提供数据库结构回退操作；删除字段或索引前必须确认没有新版同日汇总任务依赖。
