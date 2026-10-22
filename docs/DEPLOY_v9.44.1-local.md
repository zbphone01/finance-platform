# v9.44.1-local 部署说明

## 文件

- `releases/finance-platform-v9.44.1-local.tar.gz`：源码部署包
- `deploy-update-optimized.sh`：推荐服务器部署脚本
- `docs/VERSION_SNAPSHOT_v9.44.1-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：最新技能文档
- `migrate-v9.41-income-rule-counterparty-alias.sql`：线上尚未部署 v9.41 时补执行
- `migrate-v9.40-recognition-summary-variance-diff.sql`：线上尚未执行 v9.40 日期汇总差异金额修正时补执行

## 重要说明

- v9.44.1 没有新增数据库迁移。
- 本版本调整明细认账规则条件导入/导出：文件格式为 CSV，操作时需要先在弹窗选择规则。
- 本版本调整部门初始化：首次部署或部门表为空时，进入部门管理页面会自动初始化默认部门结构，不再显示手动初始化按钮。
- 如果线上尚未升级 v9.41，部署前先确认 `income_recognition_rules.matched_counterparty_alias` 字段已存在。

## 线上部署步骤

### 1. 上传部署文件

```bash
cd /home/deploy/Documents/资金池认账

scp releases/finance-platform-v9.44.1-local.tar.gz \
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
./deploy-update-optimized.sh finance-platform-v9.44.1-local.tar.gz
```

如果服务器依赖状态异常，改用：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.44.1-local.tar.gz
```

### 4. 查看服务状态和日志

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 进入 `认账规则 / 明细认账`，顶部应显示 `导出条件` 和 `导入条件` 按钮。
- 点击 `导出条件`，应先弹窗选择规则；导出的文件应为 CSV。
- 点击 `导入条件`，应先弹窗选择规则，再选择 CSV 文件；确认后应替换所选规则条件内容。
- 新部署空库进入 `认账信息设置 / 部门`，应自动出现默认部门结构，页面不再显示 `初始化预设部门` 按钮。
