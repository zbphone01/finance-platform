# v9.46-local 部署说明

## 文件

- `releases/finance-platform-v9.46-local.tar.gz`：源码部署包
- `deploy-update-optimized.sh`：推荐服务器部署脚本
- `migrate-v9.45-management-fee-amount.sql`：v9.45 管理费金额字段迁移，如线上已执行可跳过
- `migrate-v9.46-income-direct-donation-fields.sql`：v9.46 银行直捐字段和管理费类型迁移
- `docs/VERSION_SNAPSHOT_v9.46-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：最新技能文档

## 重要说明

- v9.46 新增数据库字段，必须先执行迁移，再部署新版代码。
- 如果线上尚未执行 v9.45，先执行 `migrate-v9.45-management-fee-amount.sql`。
- v9.46 迁移为 `income_rule_splits` 和 `match_results` 新增会员姓名、地区、匿名、管理费类型和管理费数值字段。
- 字段已存在时不要重复执行同一迁移脚本，先用检查命令确认。

## 本地迁移

如本地尚未执行 v9.45：

```bash
cd /home/deploy/Documents/资金池认账
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.45-management-fee-amount.sql
```

执行 v9.46：

```bash
cd /home/deploy/Documents/资金池认账
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.46-income-direct-donation-fields.sql
```

本地检查：

```bash
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM income_rule_splits LIKE 'member_name';"
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM match_results LIKE 'management_fee_type';"
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM match_results LIKE 'region';"
```

## 线上部署步骤

### 1. 上传部署文件

```bash
cd /home/deploy/Documents/资金池认账

scp releases/finance-platform-v9.46-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.45-management-fee-amount.sql \
  migrate-v9.46-income-direct-donation-fields.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 登录服务器并检查字段

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM match_results LIKE 'management_fee_amount';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM income_rule_splits LIKE 'member_name';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM match_results LIKE 'management_fee_type';"
```

如果没有返回 `management_fee_amount`，先执行 v9.45：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.45-management-fee-amount.sql
```

如果没有返回 `income_rule_splits.member_name` 或 `match_results.management_fee_type`，执行 v9.46：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.46-income-direct-donation-fields.sql
```

### 3. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.46-local.tar.gz
```

如果服务器依赖状态异常，改用：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.46-local.tar.gz
```

### 4. 查看服务状态和日志

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 进入 `认账信息设置 / 公益平台`，展开平台后新增平台项目名称，保存后当前展开平台应立即显示新项目。
- 进入 `认账信息设置 / 预算编码`，新增或编辑下级节点后，当前已展开节点应刷新显示。
- 进入 `到账认账` 新建规则，渠道捐赠分账的管理费默认为 `百分比 5`。
- 到账认账银行直捐字段顺序应为 `反馈类型 / 支出资金来源 / 地区 / 匿名 / 会员姓名 / 管理费`，匿名为下拉且默认否。
- 手动认账渠道捐赠应在管理费前显示 `地区`。
- 入账结果日明细列顺序应包含 `支出资金来源 / 地区 / 匿名 / 会员姓名 / 入账金额`。
- 公益平台搜索 `PM1911110_` 这类 `编码_` 格式应能匹配结果。
