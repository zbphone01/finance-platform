# v9.78-local 部署说明

## 文件

- `releases/finance-platform-v9.78-local.tar.gz`：v9.78 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `migrate-v9.78-refund-amount-snapshot.sql`：v9.78 退款金额快照迁移
- `migrate-v9.77-refund-order-rule-fields.sql`：v9.77 退款订单判断字段迁移，已部署 v9.77+ 的环境无需重复执行
- `migrate-v9.74-finance-role.sql`：v9.74 财务人员角色迁移，已部署 v9.74+ 的环境无需重复执行
- `migrate-v9.70-detail-split-rule-upload-fields.sql`：v9.70 明细认账规则分账包设置字段迁移，未执行过 v9.70 时才需要
- `docs/VERSION_SNAPSHOT_v9.78-local.md`：版本快照

## 重要说明

- 本版替代 v9.77-local 部署包；线上部署时上传 v9.78 包即可。
- 本版新增数据库迁移：`migrate-v9.78-refund-amount-snapshot.sql`。
- 已部署 v9.77 的环境，需要先执行 v9.78 迁移，再部署代码。
- 尚未部署 v9.77 的环境，需要先执行 `migrate-v9.77-refund-order-rule-fields.sql`；尚未部署 v9.74 或 v9.70 的环境，还需要补齐对应迁移。
- 本版重点将订单明细包退款金额改为和收入金额一致的文件级快照口径。

## 本地迁移检查

确认 v9.78 退款金额快照字段是否存在：

```bash
cd /home/deploy/Documents/资金池认账

mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM bill_details LIKE 'refund_amount_snapshot'; SHOW COLUMNS FROM order_files LIKE 'refund_amount';"
```

如果字段不存在，执行：

```bash
cd /home/deploy/Documents/资金池认账

mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.78-refund-amount-snapshot.sql

mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM bill_details LIKE 'refund_amount_snapshot'; SHOW COLUMNS FROM order_files LIKE 'refund_amount';"
```

本地回填金额复查：

```bash
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SELECT COALESCE(SUM(refund_amount), 0.00) AS order_file_refund_total FROM order_files; SELECT COALESCE(SUM(refund_amount_snapshot), 0.00) AS bill_detail_refund_total FROM bill_details WHERE detail_split_file_id IS NULL AND COALESCE(operation_status, 'active') <> 'ignored';"
```

## 线上部署

上传部署包、部署脚本和迁移脚本：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.78-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.78-refund-amount-snapshot.sql \
  migrate-v9.77-refund-order-rule-fields.sql \
  migrate-v9.74-finance-role.sql \
  migrate-v9.70-detail-split-rule-upload-fields.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

登录服务器：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
```

执行 v9.78 迁移并复查：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM bill_details LIKE 'refund_amount_snapshot'; SHOW COLUMNS FROM order_files LIKE 'refund_amount';"

mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.78-refund-amount-snapshot.sql

mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM bill_details LIKE 'refund_amount_snapshot'; SHOW COLUMNS FROM order_files LIKE 'refund_amount';"

mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT COALESCE(SUM(refund_amount), 0.00) AS order_file_refund_total FROM order_files; SELECT COALESCE(SUM(refund_amount_snapshot), 0.00) AS bill_detail_refund_total FROM bill_details WHERE detail_split_file_id IS NULL AND COALESCE(operation_status, 'active') <> 'ignored';"
```

如未执行过 v9.77 迁移，先执行并复查：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.77-refund-order-rule-fields.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_rules LIKE 'refund_order_enabled'; SHOW COLUMNS FROM recognition_rules LIKE 'refund_judge_field'; SHOW COLUMNS FROM recognition_rules LIKE 'refund_judge_value'; SHOW COLUMNS FROM recognition_rules LIKE 'refund_amount_field';"
```

如未执行过 v9.74 迁移，先执行并复查：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.74-finance-role.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM users LIKE 'role';"
```

如未执行过 v9.70 迁移，先补执行并复查：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.70-detail-split-rule-upload-fields.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_rules LIKE 'detail_split_recognition_keyword_field'; SHOW COLUMNS FROM recognition_rules LIKE 'detail_split_income_field'; SHOW COLUMNS FROM recognition_rules LIKE 'detail_split_match_field';"
```

部署代码：

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.78-local.tar.gz
```

如果服务器依赖状态异常：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.78-local.tar.gz
```

如需在线上强制执行类型检查：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.78-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 进入订单明细包列表，“退款金额”应显示文件级退款金额快照，不再固定为 `0.00`。
- 普通打开订单明细内容页，顶部“收入金额 / 退款金额”应与订单明细包列表同一文件级快照来源一致。
- 上传含退款订单的订单明细后，`order_files.refund_amount` 应等于该文件下 `bill_details.refund_amount_snapshot` 汇总。
- 退款行仍应按退款金额字段入库为负数，退款金额快照保存为正数。

## 回退

- 代码可通过上一版部署包 `finance-platform-v9.77-local.tar.gz` 回退。
- 本版新增 `bill_details.refund_amount_snapshot` 和 `order_files.refund_amount` 字段；如确需数据库回退，可在确认不再需要退款金额快照后执行：

```bash
ALTER TABLE order_files
  DROP COLUMN refund_amount;

ALTER TABLE bill_details
  DROP COLUMN refund_amount_snapshot;
```
