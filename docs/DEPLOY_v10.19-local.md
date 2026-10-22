# v10.19-local 部署说明

## 文件

- `releases/finance-platform-v10.19-local.tar.gz`：v10.19 部署包
- `migrate-v10.16-income-rule-donation-source.sql`：到账认账规则分账新增捐赠来源
- `migrate-v10.17-split-tax-refund-principal-income-type.sql`：收入类型 `个税返还本金` 拆分为 `个税返还` 和 `本金`
- `migrate-v10.18-income-rule-split-remark.sql`：到账认账规则分账新增备注
- `migrate-v10.19-match-result-donation-source-remark.sql`：入账结果新增捐赠来源、反馈类型和备注快照
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.19-local.md`：版本快照

## 重要说明

- 从 v10.15 升级到 v10.19，需要上传代码包和 v10.16-v10.19 迁移脚本，先按顺序执行迁移，再部署代码包。
- 如果目标环境尚未部署 v10.15，需要先按 v10.15 部署说明补齐 `migrate-v10.14-voucher-receipt-channels.sql` 和 `migrate-v10.15-voucher-line-explanation-json.sql`。
- `migrate-v10.17-split-tax-refund-principal-income-type.sql` 会把历史 `个税返还本金` 回填为 `个税返还`，并从枚举中移除旧值。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.19-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.16-income-rule-donation-source.sql \
  migrate-v10.17-split-tax-refund-principal-income-type.sql \
  migrate-v10.18-income-rule-split-remark.sql \
  migrate-v10.19-match-result-donation-source-remark.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

迁移前检查、执行和复查：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM income_rule_splits LIKE 'donation_source'; SHOW COLUMNS FROM income_rule_splits LIKE 'remark'; SHOW COLUMNS FROM match_results LIKE 'donation_source'; SHOW COLUMNS FROM match_results LIKE 'feedback_type'; SHOW COLUMNS FROM match_results LIKE 'remark'; SHOW COLUMNS FROM rule_item_splits LIKE 'income_type'; SHOW COLUMNS FROM income_rule_splits LIKE 'income_type';"
if ! mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW COLUMNS FROM income_rule_splits LIKE 'donation_source';" | grep -q '^donation_source'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.16-income-rule-donation-source.sql
fi
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.17-split-tax-refund-principal-income-type.sql
if ! mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW COLUMNS FROM income_rule_splits LIKE 'remark';" | grep -q '^remark'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.18-income-rule-split-remark.sql
fi
if ! mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW COLUMNS FROM match_results LIKE 'donation_source';" | grep -q '^donation_source'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.19-match-result-donation-source-remark.sql
fi
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM income_rule_splits LIKE 'donation_source'; SHOW COLUMNS FROM income_rule_splits LIKE 'remark'; SHOW COLUMNS FROM match_results LIKE 'donation_source'; SHOW COLUMNS FROM match_results LIKE 'feedback_type'; SHOW COLUMNS FROM match_results LIKE 'remark'; SHOW COLUMNS FROM rule_item_splits LIKE 'income_type'; SHOW COLUMNS FROM income_rule_splits LIKE 'income_type';"
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.19-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.19-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.16-income-rule-donation-source.sql \
  migrate-v10.17-split-tax-refund-principal-income-type.sql \
  migrate-v10.18-income-rule-split-remark.sql \
  migrate-v10.19-match-result-donation-source-remark.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

迁移前检查、执行和复查：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM income_rule_splits LIKE 'donation_source'; SHOW COLUMNS FROM income_rule_splits LIKE 'remark'; SHOW COLUMNS FROM match_results LIKE 'donation_source'; SHOW COLUMNS FROM match_results LIKE 'feedback_type'; SHOW COLUMNS FROM match_results LIKE 'remark'; SHOW COLUMNS FROM rule_item_splits LIKE 'income_type'; SHOW COLUMNS FROM income_rule_splits LIKE 'income_type';"
if ! mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW COLUMNS FROM income_rule_splits LIKE 'donation_source';" | grep -q '^donation_source'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.16-income-rule-donation-source.sql
fi
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.17-split-tax-refund-principal-income-type.sql
if ! mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW COLUMNS FROM income_rule_splits LIKE 'remark';" | grep -q '^remark'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.18-income-rule-split-remark.sql
fi
if ! mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW COLUMNS FROM match_results LIKE 'donation_source';" | grep -q '^donation_source'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.19-match-result-donation-source-remark.sql
fi
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM income_rule_splits LIKE 'donation_source'; SHOW COLUMNS FROM income_rule_splits LIKE 'remark'; SHOW COLUMNS FROM match_results LIKE 'donation_source'; SHOW COLUMNS FROM match_results LIKE 'feedback_type'; SHOW COLUMNS FROM match_results LIKE 'remark'; SHOW COLUMNS FROM rule_item_splits LIKE 'income_type'; SHOW COLUMNS FROM income_rule_splits LIKE 'income_type';"
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.19-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.19-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.19-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.19-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.19-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号应显示 `v10.19`。
- 凭证详情汇总行可点击查看说明浮层，字段为 `结算方式`、`银行账户`，值显示 `-`。
- 到账认账规则分账设置中，`捐赠收入` 需要选择捐赠来源，非捐赠收入按收入类型展示对应必填字段。
- 明细认账规则分账设置不再选择收入类型，捐赠来源固定显示为 `互联网募捐平台`。
- 入账结果明细列表不再展示认账类型列，应展示捐赠来源、反馈类型、备注列，空值显示 `-`。

## 回退

- 代码可通过上一版部署包 `finance-platform-v10.15-local.tar.gz` 回退。
- 数据库结构回退前必须确认已备份并且新字段数据可丢弃，再按实际执行过的迁移反向处理；`migrate-v10.17` 涉及枚举值和历史数据回填，建议优先通过数据库备份恢复。
