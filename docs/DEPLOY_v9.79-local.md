# v9.79-local 部署说明

## 文件

- `releases/finance-platform-v9.79-local.tar.gz`：v9.79 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `migrate-v9.79-refund-order-file-income-summary.sql`：v9.79 订单明细包收入/退款快照回填迁移
- `migrate-v9.78-refund-amount-snapshot.sql`：v9.78 退款金额快照迁移，已部署 v9.78+ 的环境无需重复执行
- `migrate-v9.77-refund-order-rule-fields.sql`：v9.77 退款订单判断字段迁移，已部署 v9.77+ 的环境无需重复执行
- `migrate-v9.74-finance-role.sql`：v9.74 财务人员角色迁移，已部署 v9.74+ 的环境无需重复执行
- `migrate-v9.70-detail-split-rule-upload-fields.sql`：v9.70 明细认账规则分账包设置字段迁移，未执行过 v9.70 时才需要
- `docs/VERSION_SNAPSHOT_v9.79-local.md`：版本快照

## 重要说明

- 本版替代 v9.78-local 部署包；线上部署时上传 v9.79 包即可。
- 本版新增数据回填迁移：`migrate-v9.79-refund-order-file-income-summary.sql`。
- v9.79 迁移不新增字段，只重算历史订单明细包的收入金额、退款金额、异常状态和明细统计。
- 已部署 v9.78 的环境，建议先执行 v9.79 迁移，再部署代码。
- 尚未部署 v9.78 的环境，需要先执行 v9.78 退款金额快照迁移；更旧环境还需补齐 v9.77、v9.74、v9.70 对应迁移。
- 本版重点修复含退款订单包的认账净额比对，以及退款订单生成 `订单退款` 负数入账结果。

## 本地迁移检查

确认 v9.78 退款金额字段存在：

```bash
cd /home/deploy/Documents/资金池认账

mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM bill_details LIKE 'refund_amount_snapshot'; SHOW COLUMNS FROM order_files LIKE 'refund_amount';"
```

执行 v9.79 回填迁移：

```bash
cd /home/deploy/Documents/资金池认账

mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.79-refund-order-file-income-summary.sql
```

本地回填金额复查：

```bash
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SELECT COUNT(*) AS package_count, COALESCE(SUM(order_total_amount), 0.00) AS income_total, COALESCE(SUM(refund_amount), 0.00) AS refund_total FROM order_files WHERE upload_status IN ('completed','abnormal'); SELECT COUNT(*) AS abnormal_count FROM order_files WHERE upload_status = 'abnormal';"
```

## 线上部署

上传部署包、部署脚本和迁移脚本：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.79-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.79-refund-order-file-income-summary.sql \
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

确认 v9.78 字段存在：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM bill_details LIKE 'refund_amount_snapshot'; SHOW COLUMNS FROM order_files LIKE 'refund_amount';"
```

如未执行过 v9.78 迁移，先执行并复查：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.78-refund-amount-snapshot.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM bill_details LIKE 'refund_amount_snapshot'; SHOW COLUMNS FROM order_files LIKE 'refund_amount';"
```

执行 v9.79 回填迁移并复查：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.79-refund-order-file-income-summary.sql

mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT COUNT(*) AS package_count, COALESCE(SUM(order_total_amount), 0.00) AS income_total, COALESCE(SUM(refund_amount), 0.00) AS refund_total FROM order_files WHERE upload_status IN ('completed','abnormal'); SELECT COUNT(*) AS abnormal_count FROM order_files WHERE upload_status = 'abnormal';"
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
./deploy-update-optimized.sh finance-platform-v9.79-local.tar.gz
```

如果服务器依赖状态异常：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.79-local.tar.gz
```

如需在线上强制执行类型检查：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.79-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 上传或打开包含退款订单的订单明细包，订单包“收入金额 / 退款金额”应分别展示正常收入与退款金额。
- 对包含退款订单的日期执行认账，金额比对应使用订单明细净额 `收入金额 - 退款金额`。
- 退款订单生成的入账结果收入类型应为 `订单退款`，入账金额为负数。
- 退款订单入账结果的收入属性、收入部门、预算编码、NC 项目名称、平台项目名称、平台详情和支出资金来源应沿用明细规则配置。
- 退款订单管理费应按负数入账金额自动计算。
- 明确 `0.00` 金额订单明细当前仍不生成入账结果，此为已记录的当前限制。

## 回退

- 代码可通过上一版部署包 `finance-platform-v9.78-local.tar.gz` 回退。
- v9.79 迁移不新增字段；如需回退金额快照口径，可在回退代码后从备份恢复 `order_files` 相关快照字段，或重新执行上一版口径的数据修复脚本。
