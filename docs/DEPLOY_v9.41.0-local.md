# v9.41.0-local 部署说明

## 文件

- `releases/finance-platform-v9.41.0-local.tar.gz`：源码部署包
- `deploy-update-optimized.sh`：推荐服务器部署脚本
- `migrate-v9.41-income-rule-counterparty-alias.sql`：v9.41 到账认账规则匹配到账别称迁移
- `migrate-v9.40-recognition-summary-variance-diff.sql`：如线上尚未执行 v9.40 日期汇总差异金额修正时补执行
- `docs/VERSION_SNAPSHOT_v9.41.0-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：最新技能文档

## 重要说明

v9.41.0 有数据库结构迁移。部署新版代码前，先确认并执行：

以下 `finance_user` 指令只能在线上服务器执行。先登录服务器并进入项目目录：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
```

```bash
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

## 线上部署步骤

### 1. 上传部署文件

```bash
cd /home/deploy/Documents/资金池认账

scp releases/finance-platform-v9.41.0-local.tar.gz \
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

若字段不存在，执行：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.41-income-rule-counterparty-alias.sql
```

迁移后再次检查字段。

### 3. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.41.0-local.tar.gz
```

如果服务器依赖状态异常，改用：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.41.0-local.tar.gz
```

### 4. 查看服务状态和日志

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 登录页首次检查登录状态或提交登录时应显示进度反馈。
- `认账规则 -> 到账认账` 列表应有查看和复制入口；新建规则选择到账别称后对方户名、用途、附言自动回填且不可改。
- 使用同一到账别称再次创建到账认账规则应提示相同规则，关闭提示后仍保留当前填写信息。
- 编辑明细认账规则保存后立即返回列表再进入编辑，已保存条件应直接回显。
- 明细规则的匹配到账信息、规则列表和上传订单明细选规则处应显示明细包类型。
- 新增未保存条件标题应显示 `（未保存）`。
- 预算编码关联 NC项目重复添加应提示；关联超过 15 个时编辑弹窗内列表滚动。
- 预算编码列表搜索条滚动时固定在顶部。
- 公益平台新增平台项目名称时，同 NC项目已有项目提示只受当前公益平台影响。
