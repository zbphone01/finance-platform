# v9.30.0-local 部署说明

## 文件

- `releases/finance-platform-v9.30.0-local.tar.gz`：源码部署包
- `deploy-update-optimized.sh`：推荐服务器部署脚本
- `docs/VERSION_SNAPSHOT_v9.30.0-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：最新技能文档
- `migrate-v9.30-clean-invalid-date-packages.sql`：非日期脏数据清理脚本

## 重要说明

本版主要修复文件识别和上传数据质量：

- 银行标准 `.xls` 到账文件识别。
- 银行到账 `备注` 写入银行流水 `用途`。
- 微信支付订单明细尾部汇总行过滤。
- 阻止 `413.0` 这类非日期值生成认账分账汇总和订单明细数据包。

本版没有新增数据库字段。

如果线上已有非日期脏数据包，部署前先备份数据库并执行：

- `migrate-v9.30-clean-invalid-date-packages.sql`

如果线上尚未部署 v9.27/v9.28/v9.29，还需要先执行前置迁移：

- `migrate-v9.27-bill-details-rule-dedupe.sql`
- `migrate-v9.28-bill-detail-operations.sql`
- `migrate-v9.29-match-result-voucher-status.sql`

## 线上部署步骤

### 1. 上传部署包、清理脚本和部署脚本

```bash
scp releases/finance-platform-v9.30.0-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.30-clean-invalid-date-packages.sql \
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
  > backup_before_v9.30.sql
```

### 3. 检查非日期脏数据

```bash
mysql -u finance_user -p finance_recon -e "
SELECT id, bill_date, bank_flow_count, bill_detail_count, status
FROM recognition_tasks
WHERE bill_date NOT REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';

SELECT bill_date, COUNT(*) AS detail_count
FROM bill_details
WHERE bill_date NOT REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
GROUP BY bill_date;
"
```

如果存在 `413.0` 等非日期记录，执行清理：

```bash
mysql -u finance_user -p finance_recon < migrate-v9.30-clean-invalid-date-packages.sql
```

执行后复查：

```bash
mysql -u finance_user -p finance_recon -e "
SELECT id, bill_date
FROM recognition_tasks
WHERE bill_date NOT REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';

SELECT id, bill_date
FROM bill_details
WHERE bill_date NOT REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
LIMIT 20;
"
```

### 4. 部署代码

```bash
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.30.0-local.tar.gz
```

如需强制重新安装依赖：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.30.0-local.tar.gz
```

### 5. 查看服务状态和日志

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 上传银行标准 `.xls` 到账文件，应能识别收入流水，不导入支出行。
- 查看银行流水详情，银行文件中的 `备注` 应显示到系统 `用途` 字段。
- 上传微信支付订单明细 CSV，尾部 `总交易单数` 汇总行不应生成订单明细数据包。
- 认账及分账列表不应出现 `413.0` 这类非日期账单日期。
- 订单明细列表不应出现 `413.0` 这类非日期订单日期。

## 回退提醒

- 代码可通过上一版部署包回退。
- 本版清理脚本会删除非日期脏数据；如需恢复被清理数据，使用 `backup_before_v9.30.sql`。
