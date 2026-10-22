# v9.35.0-local 部署说明

## 文件

- `releases/finance-platform-v9.35.0-local.tar.gz`：源码部署包
- `deploy-update-optimized.sh`：推荐服务器部署脚本
- `docs/VERSION_SNAPSHOT_v9.35.0-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：最新技能文档
- `migrate-v9.33-match-result-display-snapshot.sql`：入账结果展示快照迁移
- `migrate-v9.34-recognition-date-summaries.sql`：认账及分账日期汇总表迁移
- `migrate-v9.35-budget-code-associated-nc-projects.sql`：预算编码关联 NC项目迁移

## 重要说明

部署 v9.35 代码前，线上数据库必须具备 v9.33、v9.34、v9.35 的结构。

如果线上尚未执行 v9.33 到 v9.35，请按顺序执行：

1. `migrate-v9.33-match-result-display-snapshot.sql`
2. `migrate-v9.34-recognition-date-summaries.sql`
3. `migrate-v9.35-budget-code-associated-nc-projects.sql`

如果线上尚未部署 v9.27 到 v9.32，还需要先执行对应前置迁移：

- `migrate-v9.27-bill-details-rule-dedupe.sql`
- `migrate-v9.28-bill-detail-operations.sql`
- `migrate-v9.29-match-result-voucher-status.sql`
- `migrate-v9.31-order-file-abnormal-status.sql`
- `migrate-v9.32-counterparty-recognition-type.sql`
- `migrate-v9.30-clean-invalid-date-packages.sql`（仅清理非日期脏数据时执行）

## 线上部署步骤

### 1. 上传部署包、迁移脚本和部署脚本

```bash
cd /home/deploy/Documents/资金池认账

scp releases/finance-platform-v9.35.0-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.33-match-result-display-snapshot.sql \
  migrate-v9.34-recognition-date-summaries.sql \
  migrate-v9.35-budget-code-associated-nc-projects.sql \
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
  > backup_before_v9.35.0.sql
```

### 3. 检查 v9.33 是否已迁移

```bash
mysql -u finance_user -p finance_recon -e "
SHOW COLUMNS FROM match_results LIKE 'bank_reference_no';
SHOW COLUMNS FROM match_results LIKE 'platform_project_display_name';
SHOW INDEX FROM match_results WHERE Key_name = 'mr_entry_time_id_idx';
"
```

如果没有返回对应字段和索引，执行：

```bash
mysql -u finance_user -p finance_recon < migrate-v9.33-match-result-display-snapshot.sql
```

### 4. 检查 v9.34 是否已迁移

```bash
mysql -u finance_user -p finance_recon -e "
SHOW TABLES LIKE 'recognition_date_summaries';
"
```

如果没有返回 `recognition_date_summaries`，执行：

```bash
mysql -u finance_user -p finance_recon < migrate-v9.34-recognition-date-summaries.sql
```

执行后检查：

```bash
mysql -u finance_user -p finance_recon -e "
SHOW TABLES LIKE 'recognition_date_summaries';
SELECT COUNT(*) AS summary_count FROM recognition_date_summaries;
SELECT COUNT(DISTINCT bill_date) AS task_date_count FROM recognition_tasks;
"
```

`summary_count` 应接近或等于 `task_date_count`。

### 5. 执行 v9.35 预算编码迁移

先检查字段是否已存在：

```bash
mysql -u finance_user -p finance_recon -e "
SHOW COLUMNS FROM budget_codes LIKE 'associated_income_projects';
"
```

如果没有返回 `associated_income_projects`，执行：

```bash
mysql -u finance_user -p finance_recon < migrate-v9.35-budget-code-associated-nc-projects.sql
```

执行后检查：

```bash
mysql -u finance_user -p finance_recon -e "
SHOW COLUMNS FROM budget_codes LIKE 'associated_income_projects';
SELECT id, code, name, income_project, associated_income_projects
FROM budget_codes
WHERE level = 2
LIMIT 5;
"
```

### 6. 部署代码

```bash
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.35.0-local.tar.gz
```

如需强制重新安装依赖：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.35.0-local.tar.gz
```

如需在线上额外执行类型检查：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.35.0-local.tar.gz
```

### 7. 查看服务状态和日志

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 进入 `认账信息设置 -> 预算编码`。
- 新建 NC项目时，不应出现“关联NC项目”入口。
- 编辑已有 NC项目时，应出现“关联NC项目”，可通过 NC树形选择组件一次添加一个 NC项目。
- 保存后，预算编码列表中该 NC项目应显示关联数量。
- 新增/编辑明细认账规则时，选择该预算编码后，NC项目名称只能从主 NC项目和关联 NC项目中选择。
- 手动认账和日期汇总页手动认账中，预算编码、NC项目名称、平台项目名称、平台项目详情均应按现有联动规则筛选。

## 回退提醒

- 代码可通过上一版部署包回退。
- v9.35 只新增 `budget_codes.associated_income_projects` 字段；若回退代码，建议保留该字段，不影响旧代码读取。
