# v9.43.0-local 部署说明

## 文件

- `releases/finance-platform-v9.43.0-local.tar.gz`：源码部署包
- `deploy-update-optimized.sh`：推荐服务器部署脚本
- `docs/VERSION_SNAPSHOT_v9.43.0-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：最新技能文档
- `migrate-v9.41-income-rule-counterparty-alias.sql`：线上尚未部署 v9.41 时补执行
- `migrate-v9.40-recognition-summary-variance-diff.sql`：线上尚未执行 v9.40 日期汇总差异金额修正时补执行

## 重要说明

- v9.43.0 没有新增数据库迁移。
- 本版本优化公益平台、预算编码设置页加载，并支持部分认账继续按剩余金额手动认账。
- 如果线上尚未升级 v9.41，部署前先确认 `income_recognition_rules.matched_counterparty_alias` 字段已存在。

## 线上部署步骤

### 1. 上传部署文件

```bash
cd /home/deploy/Documents/资金池认账

scp releases/finance-platform-v9.43.0-local.tar.gz \
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
./deploy-update-optimized.sh finance-platform-v9.43.0-local.tar.gz
```

如果服务器依赖状态异常，改用：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.43.0-local.tar.gz
```

### 4. 查看服务状态和日志

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 进入 `认账信息设置 -> 公益平台`，页面应先展示平台；展开平台和项目后分别出现平台项目名称、项目详情。
- 进入 `认账信息设置 -> 预算编码`，页面应先展示部门；展开部门和 NC 项目后逐级出现下级。
- 在公益平台和预算编码搜索栏输入关键词，应能返回命中项目或编码路径。
- 日期详情银行流水中点击 `部分认账`，应打开手动认账表单并显示认账金额、可认账金额。
- 输入认账金额大于可认账金额时应阻止保存；小于等于可认账金额时应生成入账结果，并按剩余金额继续显示部分认账或已认账。
