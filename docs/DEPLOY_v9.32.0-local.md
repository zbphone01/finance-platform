# v9.32.0-local 部署说明

## 文件

- `releases/finance-platform-v9.32.0-local.tar.gz`：源码部署包
- `deploy-update-optimized.sh`：推荐服务器部署脚本
- `docs/VERSION_SNAPSHOT_v9.32.0-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：最新技能文档
- `migrate-v9.32-counterparty-recognition-type.sql`：到账信息认账类型迁移

## 重要说明

本版新增到账信息汇总的认账类型，并让明细认账规则只选择 `明细认账` 类型的到账别称。

部署代码前必须执行：

- `migrate-v9.32-counterparty-recognition-type.sql`

如果线上尚未部署 v9.27 到 v9.31，还需要先执行对应前置迁移：

- `migrate-v9.27-bill-details-rule-dedupe.sql`
- `migrate-v9.28-bill-detail-operations.sql`
- `migrate-v9.29-match-result-voucher-status.sql`
- `migrate-v9.31-order-file-abnormal-status.sql`
- `migrate-v9.30-clean-invalid-date-packages.sql`（仅清理非日期脏数据时执行）

## 线上部署步骤

### 1. 上传部署包、迁移脚本和部署脚本

```bash
scp releases/finance-platform-v9.32.0-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.32-counterparty-recognition-type.sql \
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
  > backup_before_v9.32.0.sql
```

### 3. 执行数据库迁移

```bash
mysql -u finance_user -p finance_recon < migrate-v9.32-counterparty-recognition-type.sql
```

执行后检查：

```bash
mysql -u finance_user -p finance_recon -e "
SHOW COLUMNS FROM counterparty_records LIKE 'recognition_type';
SHOW INDEX FROM counterparty_records WHERE Key_name = 'cr_recognition_type_idx';
"
```

返回的 `Type` 应包含 `到账认账` 和 `明细认账`。

### 4. 部署代码

```bash
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.32.0-local.tar.gz
```

如需强制重新安装依赖：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.32.0-local.tar.gz
```

### 5. 查看服务状态和日志

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 进入 `到账信息汇总`，已记录列表应显示 `认账类型` 列。
- 已记录列表的认账类型筛选应能按 `到账认账`、`明细认账` 过滤。
- 未记录列表点击 `记录`，弹窗应能选择到账类型。
- 在 `到账信息汇总` 中将用于明细认账的到账别称设置为 `明细认账`。
- 进入 `认账规则 -> 明细认账 -> 新建规则`，匹配到账信息下拉只应显示 `明细认账` 类型到账别称。
- 新建明细认账规则时管理费比例默认应为 `5`。
- 重复规则名称保存应提示规则名称已存在。
- 明细认账规则列表点击复制，填写新规则名称和匹配到账信息后，应复制原规则的条件和分账信息。

## 回退提醒

- 代码可通过上一版部署包回退。
- v9.32 新增列默认值为 `到账认账`。如需回退数据库结构，需先确认没有依赖 `recognition_type` 的新代码在运行。
