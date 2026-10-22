# v9.77-local 部署说明

## 文件

- `releases/finance-platform-v9.77-local.tar.gz`：v9.77 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `migrate-v9.77-refund-order-rule-fields.sql`：v9.77 退款订单判断字段迁移
- `migrate-v9.74-finance-role.sql`：v9.74 财务人员角色迁移，已部署 v9.74+ 的环境无需重复执行
- `migrate-v9.70-detail-split-rule-upload-fields.sql`：v9.70 明细认账规则分账包设置字段迁移，未执行过 v9.70 时才需要
- `docs/VERSION_SNAPSHOT_v9.77-local.md`：版本快照

## 重要说明

- 本版替代 v9.76-local 部署包；线上部署时上传 v9.77 包即可。
- 本版新增数据库迁移：`migrate-v9.77-refund-order-rule-fields.sql`。
- 已部署 v9.76 的环境，需要先执行 v9.77 迁移，再部署代码。
- 尚未部署 v9.74 的环境，需要先执行 `migrate-v9.74-finance-role.sql`；尚未部署 v9.70 的环境，还需要补执行 `migrate-v9.70-detail-split-rule-upload-fields.sql`。
- 本版重点增加明细认账规则退款订单判断，并调整订单明细包列表和日期汇总未认账展示口径。

## 本地迁移检查

确认 v9.77 退款订单字段是否存在：

```bash
cd /home/deploy/Documents/资金池认账

mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM recognition_rules LIKE 'refund_order_enabled'; SHOW COLUMNS FROM recognition_rules LIKE 'refund_judge_field'; SHOW COLUMNS FROM recognition_rules LIKE 'refund_judge_value'; SHOW COLUMNS FROM recognition_rules LIKE 'refund_amount_field';"
```

如果字段不存在，执行：

```bash
cd /home/deploy/Documents/资金池认账

mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.77-refund-order-rule-fields.sql

mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM recognition_rules LIKE 'refund_order_enabled'; SHOW COLUMNS FROM recognition_rules LIKE 'refund_judge_field'; SHOW COLUMNS FROM recognition_rules LIKE 'refund_judge_value'; SHOW COLUMNS FROM recognition_rules LIKE 'refund_amount_field';"
```

## 线上部署

上传部署包、部署脚本和迁移脚本：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.77-local.tar.gz \
  deploy-update-optimized.sh \
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

执行 v9.77 迁移并复查：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_rules LIKE 'refund_order_enabled'; SHOW COLUMNS FROM recognition_rules LIKE 'refund_judge_field'; SHOW COLUMNS FROM recognition_rules LIKE 'refund_judge_value'; SHOW COLUMNS FROM recognition_rules LIKE 'refund_amount_field';"

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
./deploy-update-optimized.sh finance-platform-v9.77-local.tar.gz
```

如果服务器依赖状态异常：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.77-local.tar.gz
```

如需在线上强制执行类型检查：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.77-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 编辑明细认账规则，规则基本信息中应显示“判断退款订单”模块。
- 开启判断退款订单后，判断字段、判断字段值、退款金额字段均为必填。
- 上传订单明细时，如果缺少判断字段或退款金额字段，应在入库前提示缺少列。
- 判断字段值精确匹配的退款行，应按退款金额字段入库为负数。
- 进入订单明细包列表，应看不到“来自文件”列；上传信息列每个文件分两行展示上传账号时间和文件名。
- 订单明细包详情列应显示“收入金额 / 退款金额”。
- 删除大订单明细包成功提示后，列表不应继续显示该包。
- 日期汇总详情订单明细中的“未认账”应等于明细条数减已认账数。

## 回退

- 代码可通过上一版部署包 `finance-platform-v9.76-local.tar.gz` 回退。
- 本版新增 `recognition_rules` 退款订单判断字段；如确需数据库回退，可在确认没有新规则依赖这些字段后执行：

```bash
ALTER TABLE recognition_rules
  DROP COLUMN refund_amount_field,
  DROP COLUMN refund_judge_value,
  DROP COLUMN refund_judge_field,
  DROP COLUMN refund_order_enabled;
```
