# v10.44-local 部署说明

## 文件

- `releases/finance-platform-v10.44-local.tar.gz`：v10.44 部署包
- `migrate-v10.44-bank-direct-member-project-center.sql`：v10.44 所属项目中心字段迁移
- `migrate-v10.43-bill-details-rolling-hot-partitions.sql`：v10.42 或更旧环境升级时的前置迁移
- `migrate-v10.42-latest-system-storage-snapshot.sql`：v10.40 环境升级时的前置迁移
- `migrate-v10.41-counterparty-match-summary.sql`：v10.40 环境升级时的前置迁移
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.44-local.md`：版本快照

## 重要说明

- 从 v10.43 升级：只执行 `migrate-v10.44-bank-direct-member-project-center.sql`。
- 从 v10.42 升级：先在维护窗口执行修正版 `migrate-v10.43-bill-details-rolling-hot-partitions.sql`，再执行 v10.44 迁移。
- 从 v10.40 升级：依次执行 v10.41、v10.42、v10.43、v10.44 迁移。
- 已经完成 v10.43 历史归档或处于 v10.43 Event 创建中断状态的环境，不要重复执行 v10.43 迁移；执行 v10.44 迁移后直接部署 v10.44，部署脚本会补建缺失 Event。
- 部署脚本不会自动执行 SQL，也不会执行 `drizzle schema push`。
- 检查、停止应用、备份、迁移、部署和验证必须逐步执行；每一步返回 shell 提示符并确认成功后再继续。

## 测试服务器1部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.44-local.tar.gz \
  migrate-v10.41-counterparty-match-summary.sql \
  migrate-v10.42-latest-system-storage-snapshot.sql \
  migrate-v10.43-bill-details-rolling-hot-partitions.sql \
  migrate-v10.44-bank-direct-member-project-center.sql \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 登录服务器并检查文件

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
sha256sum finance-platform-v10.44-local.tar.gz
ls -lh migrate-v10.43-bill-details-rolling-hot-partitions.sql migrate-v10.44-bank-direct-member-project-center.sql deploy-update-optimized.sh
```

发布包 SHA-256 应与交付值一致。

### 3. 迁移前检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM income_rule_splits LIKE 'project_center'; SHOW COLUMNS FROM match_results LIKE 'project_center'; SHOW VARIABLES LIKE 'event_scheduler'; SHOW PROCEDURE STATUS WHERE Db = DATABASE() AND Name IN ('ensure_bill_details_rolling_partitions','archive_bill_details_day','archive_bill_details_daily','archive_bill_details_daily_with_storage_request'); SHOW EVENTS WHERE Db = DATABASE() AND Name IN ('ev_bill_details_rolling_partitions','ev_bill_details_archive_old_daily_partitions');"
```

- 两个 `project_center` 字段均不存在：需要执行 v10.44 迁移。
- 两个字段均已存在：不要重复执行 v10.44 迁移。
- 只有一个字段存在：停止部署，先核查此前迁移中断原因。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 备份数据库

```bash
backup_file="backup_before_v10.44_$(date +%Y%m%d_%H%M%S).sql"
echo "$backup_file"
mysqldump --protocol=TCP -h localhost -u finance_user -p --no-tablespaces --single-transaction --quick --routines --events --triggers finance_recon > "$backup_file"
```

等待命令结束并返回 shell 提示符。

### 6. 检查备份

```bash
backup_file=$(ls -1t backup_before_v10.44_*.sql | head -1)
ls -lh "$backup_file"
tail -n 5 "$backup_file"
grep -- "-- Dump completed on" "$backup_file"
```

必须看到 `-- Dump completed on ...`。

### 7. 执行数据库迁移

从 v10.43 升级：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.44-bank-direct-member-project-center.sql
```

从 v10.42 升级：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.43-bill-details-rolling-hot-partitions.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.44-bank-direct-member-project-center.sql
```

从 v10.40 升级：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.41-counterparty-match-summary.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.42-latest-system-storage-snapshot.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.43-bill-details-rolling-hot-partitions.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.44-bank-direct-member-project-center.sql
```

已完成 v10.43 归档但 Event 创建失败的环境，只执行 v10.44 迁移，不要重跑 v10.43。

### 8. 迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM income_rule_splits LIKE 'project_center'; SHOW COLUMNS FROM match_results LIKE 'project_center'; SHOW EVENTS WHERE Db = DATABASE() AND Name IN ('ev_bill_details_rolling_partitions','ev_bill_details_archive_old_daily_partitions');"
```

确认两个字段均为 `varchar(255)` 且允许 `NULL`。

### 9. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.44-local.tar.gz
```

### 10. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
```

## 测试服务器2部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.44-local.tar.gz \
  migrate-v10.41-counterparty-match-summary.sql \
  migrate-v10.42-latest-system-storage-snapshot.sql \
  migrate-v10.43-bill-details-rolling-hot-partitions.sql \
  migrate-v10.44-bank-direct-member-project-center.sql \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

### 2. 登录服务器并检查文件

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
sha256sum finance-platform-v10.44-local.tar.gz
ls -lh migrate-v10.43-bill-details-rolling-hot-partitions.sql migrate-v10.44-bank-direct-member-project-center.sql deploy-update-optimized.sh
```

### 3. 迁移前检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM income_rule_splits LIKE 'project_center'; SHOW COLUMNS FROM match_results LIKE 'project_center'; SHOW VARIABLES LIKE 'event_scheduler'; SHOW PROCEDURE STATUS WHERE Db = DATABASE() AND Name IN ('ensure_bill_details_rolling_partitions','archive_bill_details_day','archive_bill_details_daily','archive_bill_details_daily_with_storage_request'); SHOW EVENTS WHERE Db = DATABASE() AND Name IN ('ev_bill_details_rolling_partitions','ev_bill_details_archive_old_daily_partitions');"
```

检查规则与测试服务器1相同。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 备份数据库

```bash
backup_file="backup_before_v10.44_$(date +%Y%m%d_%H%M%S).sql"
echo "$backup_file"
mysqldump --protocol=TCP -h localhost -u finance_user -p --no-tablespaces --single-transaction --quick --routines --events --triggers finance_recon > "$backup_file"
```

### 6. 检查备份

```bash
backup_file=$(ls -1t backup_before_v10.44_*.sql | head -1)
ls -lh "$backup_file"
tail -n 5 "$backup_file"
grep -- "-- Dump completed on" "$backup_file"
```

### 7. 执行数据库迁移

从 v10.43 升级：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.44-bank-direct-member-project-center.sql
```

从 v10.42 升级：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.43-bill-details-rolling-hot-partitions.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.44-bank-direct-member-project-center.sql
```

从 v10.40 升级：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.41-counterparty-match-summary.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.42-latest-system-storage-snapshot.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.43-bill-details-rolling-hot-partitions.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.44-bank-direct-member-project-center.sql
```

### 8. 迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM income_rule_splits LIKE 'project_center'; SHOW COLUMNS FROM match_results LIKE 'project_center'; SHOW EVENTS WHERE Db = DATABASE() AND Name IN ('ev_bill_details_rolling_partitions','ev_bill_details_archive_old_daily_partitions');"
```

### 9. 部署代码

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.44-local.tar.gz
```

### 10. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角显示 `v10.44`。
- 工商银行上传后，“对方开户行”读取“对方行名”，“交易行所”读取“对方行号”。
- 新建、编辑、复制到账认账规则不再出现“自定义”选项，也不展示对方户名、用途、附言字段。
- 仅配置对方账号且未配置摘要的已记录到账信息可以正常执行到账认账。
- 捐赠收入银行直捐可选填会员姓名；填写后必须选择所属项目中心。
- 入账结果和日期任务详情正确展示所属项目中心。
- `npm run --silent db:events:ensure -- --check-only` 返回两个 Event 校验通过。

## 回退

- 代码可使用 `releases/finance-platform-v10.43-local.tar.gz` 回退。
- v10.44 新增字段均可空，代码回退时可保留，不建议立即删除。
- 如果从 v10.42 跨版本升级并已执行 v10.43 迁移，分区和历史归档结构不能仅通过回退代码撤销；必要时从迁移前备份恢复。
