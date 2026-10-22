# v9.42.0-local 部署说明

## 文件

- `releases/finance-platform-v9.42.0-local.tar.gz`：源码部署包
- `deploy-update-optimized.sh`：推荐服务器部署脚本
- `docs/VERSION_SNAPSHOT_v9.42.0-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：最新技能文档
- `migrate-v9.41-income-rule-counterparty-alias.sql`：线上尚未部署 v9.41 时补执行
- `migrate-v9.40-recognition-summary-variance-diff.sql`：线上尚未执行 v9.40 日期汇总差异金额修正时补执行

## 重要说明

- v9.42.0 没有新增数据库迁移。
- 本次新增订单明细 XLSX 解析依赖，`package-lock.json` 已变化；推荐部署脚本会自动安装新依赖。
- 如果线上尚未升级 v9.41，部署 v9.42 代码前先确认 `income_recognition_rules.matched_counterparty_alias` 是否存在。

以下 `finance_user` 指令只能在线上服务器执行。先登录服务器并进入项目目录：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
```

检查 v9.41 字段：

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

scp releases/finance-platform-v9.42.0-local.tar.gz \
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

### 3. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.42.0-local.tar.gz
```

如果服务器依赖状态异常，改用：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.42.0-local.tar.gz
```

### 4. 查看服务状态和日志

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 订单明细上传应支持 `.csv` 和 `.xlsx`，易宝 XLSX 可识别下单时间和商品信息。
- `入账结果` 点击某天后当天明细列表每页显示 15 条。
- `入账结果` 按天汇总“批量制单”可把当天待制单明细改为已制单，并同步汇总数量。
- 新增银行到账后进入 `到账信息汇总`，不先打开“未记录”页签也应看到正确的未记录数量。
- 公益平台最后一行“添加平台项目名称”入口应与上方展开箭头对齐。
