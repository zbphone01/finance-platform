# v9.28.0-local 部署说明

## 文件

- `releases/finance-platform-v9.28.0-local.tar.gz`：源码部署包
- `deploy-update.sh`：服务器部署脚本
- `docs/VERSION_SNAPSHOT_v9.28.0-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：最新技能文档
- `migrate-v9.27-bill-details-rule-dedupe.sql`：订单明细规则字段和查重索引迁移
- `migrate-v9.28-bill-detail-operations.sql`：订单明细忽略/转移字段迁移

## 重要说明

本版有数据库迁移。线上部署代码前，先备份数据库并执行 v9.27、v9.28 迁移。

如果线上尚未部署 v9.24/v9.25，需要先执行对应前置迁移：

- `migrate-v9.24-order-file-upload-status.sql`
- `migrate-v9.24-income-type-options.sql`
- `migrate-v9.25-project-details.sql`
- `migrate-v9.25-platform-project-detail-splits.sql`

## 线上部署步骤

### 1. 上传部署包、迁移脚本和部署脚本

```bash
scp releases/finance-platform-v9.28.0-local.tar.gz \
  deploy-update.sh \
  migrate-v9.27-bill-details-rule-dedupe.sql \
  migrate-v9.28-bill-detail-operations.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 线上备份数据库

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform

mysqldump \
  -u finance_user \
  -p \
  --no-tablespaces \
  --skip-lock-tables \
  --set-gtid-purged=OFF \
  finance_recon \
  > backup_before_v9.28.sql
```

### 3. 检查并执行数据库迁移

检查前置字段：

```bash
mysql -u finance_user -p finance_recon -e "
SHOW COLUMNS FROM order_files LIKE 'upload_status';
SHOW COLUMNS FROM income_recognition_rules LIKE 'recognition_type';
SHOW TABLES LIKE 'project_details';
SHOW COLUMNS FROM rule_item_splits LIKE 'platform_project_detail';
SHOW COLUMNS FROM income_rule_splits LIKE 'platform_project_detail';
SHOW COLUMNS FROM match_results LIKE 'platform_project_detail';
"
```

执行本版迁移：

```bash
mysql -u finance_user -p finance_recon < migrate-v9.27-bill-details-rule-dedupe.sql
mysql -u finance_user -p finance_recon < migrate-v9.28-bill-detail-operations.sql
```

检查本版迁移结果：

```bash
mysql -u finance_user -p finance_recon -e "
SHOW COLUMNS FROM bill_details LIKE 'rule_id';
SHOW INDEX FROM bill_details WHERE Key_name = 'bd_rule_date_bill_no_uq';
SHOW COLUMNS FROM bill_details LIKE 'operation_status';
SHOW COLUMNS FROM bill_details LIKE 'original_task_id';
"
```

### 4. 部署代码

```bash
cd /home/ubuntu/finance-platform
chmod +x deploy-update.sh
./deploy-update.sh finance-platform-v9.28.0-local.tar.gz
```

### 5. 重启并查看日志

```bash
pm2 restart finance-platform
pm2 logs finance-platform --lines 80
```

## 功能验证

- 在认账及分账菜单上传银行到账。
- 上传订单明细后，订单明细菜单能按真实订单日期和明细认账规则展示数据包。
- 日期汇总页按 T+1 展示订单明细，例如 `2026-05-09` 订单进入 `2026-05-10` 日期汇总。
- 银行流水金额等于 T+1 订单数据包金额时，不显示差异大。
- 已部分生成入账结果的任务显示部分认账。
- 再次上传新增订单明细时，只补认账未认账明细。
- 订单明细菜单删除某个数据包后，不影响同一上传文件中的其他日期数据包，并同步刷新入账结果和认账任务状态。

## 回退提醒

- 代码可通过上一版部署包回退。
- 数据库迁移包含新增字段和唯一索引；如需完全回退数据库，优先使用 `backup_before_v9.28.sql` 恢复。
- 不建议在有新业务数据写入后手工删除 v9.27/v9.28 字段或索引。
