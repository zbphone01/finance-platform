# v9.34.0-local 部署说明

## 文件

- `releases/finance-platform-v9.34.0-local.tar.gz`：源码部署包
- `deploy-update-optimized.sh`：推荐服务器部署脚本
- `docs/VERSION_SNAPSHOT_v9.34.0-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：最新技能文档
- `migrate-v9.33-match-result-display-snapshot.sql`：入账结果展示快照迁移
- `migrate-v9.34-recognition-date-summaries.sql`：认账及分账日期汇总表迁移

## 重要说明

线上环境当前尚未升级 v9.33，也尚未执行 v9.33 及后续数据库迁移。

部署 v9.34 代码前必须按顺序执行：

1. `migrate-v9.33-match-result-display-snapshot.sql`
2. `migrate-v9.34-recognition-date-summaries.sql`

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
scp releases/finance-platform-v9.34.0-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.33-match-result-display-snapshot.sql \
  migrate-v9.34-recognition-date-summaries.sql \
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
  > backup_before_v9.34.0.sql
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

### 4. 执行 v9.34 日期汇总表迁移

```bash
mysql -u finance_user -p finance_recon < migrate-v9.34-recognition-date-summaries.sql
```

执行后检查：

```bash
mysql -u finance_user -p finance_recon -e "
SHOW TABLES LIKE 'recognition_date_summaries';
SHOW COLUMNS FROM recognition_date_summaries;
SELECT COUNT(*) AS summary_count FROM recognition_date_summaries;
SELECT COUNT(DISTINCT bill_date) AS task_date_count FROM recognition_tasks;
"
```

`summary_count` 应接近或等于 `task_date_count`。

### 5. 部署代码

```bash
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.34.0-local.tar.gz
```

如需强制重新安装依赖：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.34.0-local.tar.gz
```

### 6. 查看服务状态和日志

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 进入 `认账及分账`，日期列表应快速打开。
- 点击某个日期的查看按钮，日期汇总页顶部汇总应快速展示。
- 日期汇总页默认进入银行流水 tab 时，不应触发订单明细加载。
- 切到 `订单明细` tab 时，应先看到明细条数、明细金额、已匹配和未匹配汇总。
- 点击 `查看具体明细` 后，才展示订单明细列表和筛选。
- 进入 `入账结果`，按天汇总和明细列表应正常展示银行流水快照字段。

## 回退提醒

- 代码可通过上一版部署包回退。
- v9.33 和 v9.34 都包含数据库结构变更。若回退代码，建议保留新增字段/表；删除前必须确认线上没有新版代码在运行。
