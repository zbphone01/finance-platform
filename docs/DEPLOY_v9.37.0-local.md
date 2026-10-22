# v9.37.0-local 部署说明

## 文件

- `releases/finance-platform-v9.37.0-local.tar.gz`：源码部署包
- `deploy-update-optimized.sh`：推荐服务器部署脚本
- `docs/VERSION_SNAPSHOT_v9.37.0-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：最新技能文档
- `migrate-v9.37-detail-package-type.sql`：明细包类型迁移

## 重要说明

部署 v9.37 代码前，线上数据库必须先具备 v9.37 结构。

如果线上尚未执行 v9.33 到 v9.37，请按顺序执行：

1. `migrate-v9.33-match-result-display-snapshot.sql`
2. `migrate-v9.34-recognition-date-summaries.sql`
3. `migrate-v9.35-budget-code-associated-nc-projects.sql`
4. `migrate-v9.36-order-file-list-indexes.sql`
5. `migrate-v9.37-detail-package-type.sql`

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

scp releases/finance-platform-v9.37.0-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.37-detail-package-type.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

如线上缺少 v9.33 到 v9.36 的迁移脚本，也一并上传。

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
  > backup_before_v9.37.0.sql
```

### 3. 检查 v9.37 是否已迁移

```bash
mysql -u finance_user -p finance_recon -e "
SHOW COLUMNS FROM counterparty_records LIKE 'detail_package_type';
SHOW COLUMNS FROM order_files LIKE 'detail_package_type';
SHOW COLUMNS FROM order_files LIKE 'upload_date';
SHOW INDEX FROM counterparty_records WHERE Key_name = 'cr_detail_package_type_idx';
SHOW INDEX FROM order_files WHERE Key_name IN ('of_package_type_idx', 'of_upload_date_idx');
"
```

如果没有返回对应字段和索引，执行：

```bash
mysql -u finance_user -p finance_recon < migrate-v9.37-detail-package-type.sql
```

执行后检查：

```bash
mysql -u finance_user -p finance_recon -e "
SHOW COLUMNS FROM counterparty_records LIKE 'detail_package_type';
SHOW COLUMNS FROM order_files LIKE 'detail_package_type';
SHOW COLUMNS FROM order_files LIKE 'upload_date';

SELECT detail_package_type, COUNT(*) AS cnt
FROM counterparty_records
GROUP BY detail_package_type;

SELECT detail_package_type, COUNT(*) AS cnt, SUM(upload_date IS NULL OR upload_date = '') AS empty_upload_date
FROM order_files
GROUP BY detail_package_type;
"
```

历史数据应默认回填为 `T+1`；`order_files.empty_upload_date` 应为 `0`。

### 4. 部署代码

```bash
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.37.0-local.tar.gz
```

如需强制重新安装依赖：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.37.0-local.tar.gz
```

如需在线上额外执行类型检查：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.37.0-local.tar.gz
```

### 5. 查看服务状态和日志

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 进入 `到账信息汇总`，记录或编辑明细认账到账信息时，应能选择 `明细包类型`。
- 已记录列表应显示 `明细认账（T+1）` 或 `明细认账（打包明细）`。
- 在 `认账及分账` 上传订单明细：
  - `T+1` 规则仍按订单日期 + 1 生成数据包。
  - `打包明细` 规则按上传日期生成独立数据包。
- 进入 `订单明细` 菜单，应看到 `订单日期/上传日期` 和 `明细包类型`。
- 进入日期汇总页，`订单明细` 内应可切换 `T+1明细` 与 `打包明细`。
- 进入 `认账信息设置 -> 公益平台`，平台项目名称下已有项目详情时不允许删除。

## 回退提醒

- 代码可通过上一版部署包回退。
- v9.37 新增字段和索引建议保留，不影响旧代码读取。
