# v9.44.0-local 部署说明

## 文件

- `releases/finance-platform-v9.44.0-local.tar.gz`：源码部署包
- `deploy-update-optimized.sh`：推荐服务器部署脚本
- `docs/VERSION_SNAPSHOT_v9.44.0-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：最新技能文档
- `migrate-v9.41-income-rule-counterparty-alias.sql`：线上尚未部署 v9.41 时补执行
- `migrate-v9.40-recognition-summary-variance-diff.sql`：线上尚未执行 v9.40 日期汇总差异金额修正时补执行

## 重要说明

- v9.44.0 没有新增数据库迁移。
- 本版本调整入账结果操作列，并允许对尚未制单的手动认账入账结果取消认账。
- 如果线上尚未升级 v9.41，部署前先确认 `income_recognition_rules.matched_counterparty_alias` 字段已存在。

## 线上部署步骤

### 1. 上传部署文件

```bash
cd /home/deploy/Documents/资金池认账

scp releases/finance-platform-v9.44.0-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.41-income-rule-counterparty-alias.sql \
  migrate-v9.40-recognition-summary-variance-diff.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 登录服务器并检查迁移

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "
SHOW COLUMNS FROM income_recognition_rules LIKE 'matched_counterparty_alias';
"
```

如果没有返回 `matched_counterparty_alias`，执行：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.41-income-rule-counterparty-alias.sql
```

如果线上尚未执行 v9.40 日期汇总差异金额修正，再补执行：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.40-recognition-summary-variance-diff.sql
```

### 3. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.44.0-local.tar.gz
```

如果服务器依赖状态异常，改用：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.44.0-local.tar.gz
```

### 4. 查看服务状态和日志

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 进入 `入账结果`，当天明细操作列的单条制单操作应显示为图标。
- 找一条尚未制单的手动认账入账结果，操作列应出现取消认账图标。
- 取消该结果后，入账结果记录应减少，关联流水应恢复对应可认账金额。
- 已制单入账结果、自动到账认账结果和明细认账结果不应允许取消认账。
