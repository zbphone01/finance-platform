# v9.47-local 部署说明

## 文件

- `releases/finance-platform-v9.47-local.tar.gz`：源码部署包
- `deploy-update-optimized.sh`：推荐服务器部署脚本
- `migrate-v9.45-management-fee-amount.sql`：v9.45 管理费金额字段迁移，如线上已执行可跳过
- `migrate-v9.46-income-direct-donation-fields.sql`：v9.46 银行直捐字段和管理费类型迁移，如线上已执行可跳过
- `migrate-v9.47-detail-arrival-aggregate.sql`：v9.47 到账信息地区和明细汇总匹配迁移
- `docs/VERSION_SNAPSHOT_v9.47-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：最新技能文档

## 重要说明

- v9.47 新增数据库字段，必须先执行迁移，再部署新版代码。
- 如果线上尚未执行 v9.45 或 v9.46，必须先按顺序执行对应迁移。
- v9.47 迁移为 `counterparty_records` 新增 `detail_matching_mode` 和 `arrival_region`。
- 字段已存在时不要重复执行同一迁移脚本，先用检查命令确认。

## 本地迁移

如本地尚未执行 v9.45：

```bash
cd /home/deploy/Documents/资金池认账
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.45-management-fee-amount.sql
```

如本地尚未执行 v9.46：

```bash
cd /home/deploy/Documents/资金池认账
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.46-income-direct-donation-fields.sql
```

执行 v9.47：

```bash
cd /home/deploy/Documents/资金池认账
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.47-detail-arrival-aggregate.sql
```

本地检查：

```bash
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM counterparty_records LIKE 'detail_matching_mode';"
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM counterparty_records LIKE 'arrival_region';"
```

## 线上部署步骤

### 1. 上传部署文件

```bash
cd /home/deploy/Documents/资金池认账

scp releases/finance-platform-v9.47-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.45-management-fee-amount.sql \
  migrate-v9.46-income-direct-donation-fields.sql \
  migrate-v9.47-detail-arrival-aggregate.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 登录服务器并检查字段

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM match_results LIKE 'management_fee_amount';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM income_rule_splits LIKE 'member_name';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM counterparty_records LIKE 'detail_matching_mode';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM counterparty_records LIKE 'arrival_region';"
```

如果没有返回 `management_fee_amount`，先执行 v9.45：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.45-management-fee-amount.sql
```

如果没有返回 `income_rule_splits.member_name`，执行 v9.46：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.46-income-direct-donation-fields.sql
```

如果没有返回 `counterparty_records.detail_matching_mode` 或 `counterparty_records.arrival_region`，执行 v9.47：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.47-detail-arrival-aggregate.sql
```

### 3. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.47-local.tar.gz
```

如果服务器依赖状态异常，改用：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.47-local.tar.gz
```

### 4. 查看服务状态和日志

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 进入 `到账信息汇总` 记录或编辑到账认账信息，应显示 `渠道认账地区`。
- 进入 `到账信息汇总` 记录或编辑明细认账信息，应显示 `到账地区` 和 `明细匹配到账方式`。
- 明细认账信息选择 `同日汇总匹配` 后，同日同到账信息的多条未认账银行到账应能汇总判断是否可认，并按每条银行流水分别进入认账队列。
- 到账认账渠道捐赠生成入账结果时，应写入到账信息配置的 `渠道认账地区`。
- 明细认账生成入账结果时，应写入到账信息配置的 `到账地区`。
