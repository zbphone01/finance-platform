# v9.45-local 部署说明

## 文件

- `releases/finance-platform-v9.45-local.tar.gz`：源码部署包
- `deploy-update-optimized.sh`：推荐服务器部署脚本
- `migrate-v9.45-management-fee-amount.sql`：管理费金额字段迁移
- `docs/VERSION_SNAPSHOT_v9.45-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：最新技能文档

## 重要说明

- v9.45 新增数据库字段 `match_results.management_fee_amount`。
- 必须先执行迁移，再部署新版代码。
- 迁移会回填历史入账结果的管理费金额。
- 如果字段已存在，不要重复执行迁移，先用检查命令确认。

## 本地迁移

```bash
cd /home/deploy/Documents/资金池认账
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.45-management-fee-amount.sql
```

本地检查：

```bash
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM match_results LIKE 'management_fee_amount';"
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SELECT id, split_amount, management_fee_ratio, management_fee_amount FROM match_results ORDER BY id DESC LIMIT 10;"
```

## 线上部署步骤

### 1. 上传部署文件

```bash
cd /home/deploy/Documents/资金池认账

scp releases/finance-platform-v9.45-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.45-management-fee-amount.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 登录服务器并检查字段

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM match_results LIKE 'management_fee_amount';"
```

如果没有返回 `management_fee_amount`，执行迁移：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.45-management-fee-amount.sql
```

检查历史数据回填：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT id, split_amount, management_fee_ratio, management_fee_amount FROM match_results ORDER BY id DESC LIMIT 10;"
```

### 3. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.45-local.tar.gz
```

如果服务器依赖状态异常，改用：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.45-local.tar.gz
```

### 4. 查看服务状态和日志

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 进入 `入账结果`，选择日期后，日入账明细应显示“管理费”列。
- “管理费”位于“入账金额”右侧，金额保留两位小数。
- “入账金额”列不再固定，右侧只固定“状态”和“操作”。
- 左侧菜单“入账结果”下方应显示“入账汇总”。
- 进入 `入账汇总`，选择年份、部门、汇总口径后点击查询。
- 按“预算编码”查询时，列表应汇总入账金额和管理费。
- 按“支出资金来源”查询时，列表应汇总入账金额和管理费。
- 清除部门选择后，应查询全部部门。
