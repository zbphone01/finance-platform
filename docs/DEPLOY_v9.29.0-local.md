# v9.29.0-local 部署说明

## 文件

- `releases/finance-platform-v9.29.0-local.tar.gz`：源码部署包
- `deploy-update-optimized.sh`：推荐服务器部署脚本
- `docs/VERSION_SNAPSHOT_v9.29.0-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：最新技能文档
- `migrate-v9.29-match-result-voucher-status.sql`：入账结果制单状态迁移

## 重要说明

本版代码包含“开始认账”统一入口、最新规则补认账、“同步认账字段”菜单改名。

如果线上还没有执行 v9.29 迁移，部署代码前先备份数据库并执行：

- `migrate-v9.29-match-result-voucher-status.sql`

如果线上尚未部署 v9.27/v9.28，还需要先执行前置迁移：

- `migrate-v9.27-bill-details-rule-dedupe.sql`
- `migrate-v9.28-bill-detail-operations.sql`

## 线上部署步骤

### 1. 上传部署包、迁移脚本和部署脚本

```bash
scp releases/finance-platform-v9.29.0-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.29-match-result-voucher-status.sql \
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
  > backup_before_v9.29.sql
```

### 3. 检查并执行数据库迁移

先检查 v9.29 字段是否已经存在：

```bash
mysql -u finance_user -p finance_recon -e "
SHOW COLUMNS FROM match_results LIKE 'voucher_status';
SHOW INDEX FROM match_results WHERE Key_name = 'mr_voucher_status_idx';
"
```

如果没有 `voucher_status` 字段，再执行：

```bash
mysql -u finance_user -p finance_recon < migrate-v9.29-match-result-voucher-status.sql
```

执行后复查：

```bash
mysql -u finance_user -p finance_recon -e "
SHOW COLUMNS FROM match_results LIKE 'voucher_status';
SHOW INDEX FROM match_results WHERE Key_name = 'mr_voucher_status_idx';
"
```

### 4. 部署代码

```bash
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.29.0-local.tar.gz
```

如需强制重新安装依赖：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.29.0-local.tar.gz
```

### 5. 查看服务状态和日志

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 登录后查看认账规则菜单，子菜单应显示“同步认账字段”。
- 在认账及分账日期汇总页，操作列应只显示一个“开始认账”按钮。
- 新增明细认账规则条件后，对历史未认账明细点击“开始认账”，应直接使用最新规则补认账。
- 不需要先进入“同步认账字段”执行手动同步，新增规则条件才会生效。
- 已生成入账结果的明细不会被重新匹配。

## 回退提醒

- 代码可通过上一版部署包回退。
- v9.29 数据库迁移新增 `match_results.voucher_status` 字段和索引；如需完全回退数据库，优先使用 `backup_before_v9.29.sql` 恢复。
- 如果线上已经产生新入账结果，不建议手工删除 v9.29 字段。
