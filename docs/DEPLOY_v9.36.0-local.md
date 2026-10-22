# v9.36.0-local 部署说明

## 文件

- `releases/finance-platform-v9.36.0-local.tar.gz`：源码部署包
- `deploy-update-optimized.sh`：推荐服务器部署脚本
- `docs/VERSION_SNAPSHOT_v9.36.0-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：最新技能文档
- `migrate-v9.36-order-file-list-indexes.sql`：订单明细数据包列表索引迁移

## 重要说明

v9.36 代码可以在未执行索引迁移时运行，但建议先执行迁移再部署或部署后立即执行迁移。迁移只新增索引，用于加速 `订单明细` 数据包列表。

如果线上尚未执行 v9.33 到 v9.35，请按顺序先执行：

1. `migrate-v9.33-match-result-display-snapshot.sql`
2. `migrate-v9.34-recognition-date-summaries.sql`
3. `migrate-v9.35-budget-code-associated-nc-projects.sql`
4. `migrate-v9.36-order-file-list-indexes.sql`

## 本地数据库迁移

### 1. 备份本地数据库

```bash
cd /home/deploy/Documents/资金池认账

mysqldump \
  -h 127.0.0.1 \
  -u finance_sandbox \
  -p \
  --no-tablespaces \
  --skip-lock-tables \
  --set-gtid-purged=OFF \
  finance_recon_sandbox \
  > backup_before_v9.36.0.sql
```

### 2. 检查索引是否已存在

```bash
mysql -h 127.0.0.1 -u finance_sandbox -p finance_recon_sandbox -e "
SHOW INDEX FROM recognition_tasks WHERE Key_name = 'rt_date_rule_idx';
SHOW INDEX FROM order_files WHERE Key_name = 'of_task_rule_created_idx';
"
```

如果没有返回这两个索引，执行迁移：

```bash
mysql -h 127.0.0.1 -u finance_sandbox -p finance_recon_sandbox < migrate-v9.36-order-file-list-indexes.sql
```

### 3. 迁移后检查

```bash
mysql -h 127.0.0.1 -u finance_sandbox -p finance_recon_sandbox -e "
SHOW INDEX FROM recognition_tasks WHERE Key_name = 'rt_date_rule_idx';
SHOW INDEX FROM order_files WHERE Key_name = 'of_task_rule_created_idx';
"
```

两个查询都应返回索引记录。

## 线上部署步骤

### 1. 上传部署包、迁移脚本和部署脚本

```bash
cd /home/deploy/Documents/资金池认账

scp releases/finance-platform-v9.36.0-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.36-order-file-list-indexes.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

如果线上尚未执行 v9.33 到 v9.35，请一并上传对应迁移脚本。

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
  > backup_before_v9.36.0.sql
```

### 3. 执行 v9.36 索引迁移

先检查：

```bash
mysql -u finance_user -p finance_recon -e "
SHOW INDEX FROM recognition_tasks WHERE Key_name = 'rt_date_rule_idx';
SHOW INDEX FROM order_files WHERE Key_name = 'of_task_rule_created_idx';
"
```

如果没有返回这两个索引，执行：

```bash
mysql -u finance_user -p finance_recon < migrate-v9.36-order-file-list-indexes.sql
```

执行后再次检查：

```bash
mysql -u finance_user -p finance_recon -e "
SHOW INDEX FROM recognition_tasks WHERE Key_name = 'rt_date_rule_idx';
SHOW INDEX FROM order_files WHERE Key_name = 'of_task_rule_created_idx';
"
```

### 4. 部署代码

```bash
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.36.0-local.tar.gz
```

如需强制重新安装依赖：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.36.0-local.tar.gz
```

如需在线上额外执行类型检查：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.36.0-local.tar.gz
```

### 5. 查看服务状态和日志

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 进入 `订单明细` 菜单。
- 数据包列表应能正常显示订单日期、规则、来源文件、条目数、匹配数和状态。
- 打开列表不应随单个数据包内明细量明显变慢。
- 搜索订单日期、规则、文件名或上传账号应正常返回结果。
- 点击查看来源文件后，明细页仍按 100 条分页展示。

## 回退提醒

- 代码可通过上一版部署包回退。
- v9.36 只新增索引；若回退代码，建议保留索引，不影响旧代码运行。
