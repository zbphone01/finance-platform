# v10.23-local 部署说明

## 文件

- `releases/finance-platform-v10.23-local.tar.gz`：v10.23 部署包
- `migrate-v10.21-membership-payment-years.sql`：手动认账会费收入新增缴纳年限
- `migrate-v10.22-budget-code-associated-departments.sql`：预算编码部门新增关联收入部门
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.23-local.md`：版本快照

## 重要说明

- 从 v10.20 升级到 v10.23，需要上传代码包和 v10.21、v10.22 两个迁移脚本，先执行迁移，再部署代码包。
- 如果目标环境尚未部署 v10.20，需要先按 v10.20 部署说明补齐历史迁移。
- 本地数据库已确认 `match_results.membership_payment_years` 和 `budget_codes.associated_departments` 均存在。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.23-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.21-membership-payment-years.sql \
  migrate-v10.22-budget-code-associated-departments.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

迁移前检查、执行和复查：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM match_results LIKE 'membership_payment_years'; SHOW COLUMNS FROM budget_codes LIKE 'associated_departments';"
if ! mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW COLUMNS FROM match_results LIKE 'membership_payment_years';" | grep -q '^membership_payment_years'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.21-membership-payment-years.sql
fi
if ! mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW COLUMNS FROM budget_codes LIKE 'associated_departments';" | grep -q '^associated_departments'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.22-budget-code-associated-departments.sql
fi
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM match_results LIKE 'membership_payment_years'; SHOW COLUMNS FROM budget_codes LIKE 'associated_departments';"
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.23-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.23-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.21-membership-payment-years.sql \
  migrate-v10.22-budget-code-associated-departments.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

迁移前检查、执行和复查：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM match_results LIKE 'membership_payment_years'; SHOW COLUMNS FROM budget_codes LIKE 'associated_departments';"
if ! mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW COLUMNS FROM match_results LIKE 'membership_payment_years';" | grep -q '^membership_payment_years'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.21-membership-payment-years.sql
fi
if ! mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW COLUMNS FROM budget_codes LIKE 'associated_departments';" | grep -q '^associated_departments'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.22-budget-code-associated-departments.sql
fi
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM match_results LIKE 'membership_payment_years'; SHOW COLUMNS FROM budget_codes LIKE 'associated_departments';"
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.23-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.23-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.23-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.23-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.23-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号应显示 `v10.23`。
- 预算编码一级部门可维护关联收入部门；关联部门选择预算编码时可筛出对应预算编码和 NC 项目。
- 新增渠道预算编码时编号可留空，留空时继承 NC 项目的 `n.n` 编号。
- 会费收入认账不再要求填写支出资金来源，凭证收款活动类型默认 `101_日常捐赠`。
- 凭证浮层不显示项目费用行 `结算方式`，`客户` 显示到账户名。
- 凭证模板页标题显示 `模板变量说明`，且不展示 `【凭证收款渠道】`。
- 左侧菜单 `账号管理` 上方显示 `操作指引`。

## 回退

- 代码可通过上一版部署包 `finance-platform-v10.20-local.tar.gz` 回退。
- 如需回退数据库结构，可在确认不再需要会费缴纳年限和预算编码关联部门数据后执行：

```sql
ALTER TABLE match_results
  DROP COLUMN membership_payment_years;

ALTER TABLE budget_codes
  DROP COLUMN associated_departments;
```
