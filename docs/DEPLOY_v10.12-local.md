# v10.12-local 部署说明

## 文件

- `releases/finance-platform-v10.12-local.tar.gz`：v10.12 部署包
- `migrate-v10.11-bill-date-date-type.sql`：将 `bill_date` 字段改为 `DATE`
- `migrate-v10.12-bank-flow-bank-name.sql`：银行流水新增 `bank_name`
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.12-local.md`：版本快照

## 重要说明

- 从 v10.10 升级到 v10.12，需要先上传代码包和迁移脚本，再按顺序执行 `migrate-v10.11-bill-date-date-type.sql` 和 `migrate-v10.12-bank-flow-bank-name.sql`，最后部署代码包。
- `migrate-v10.11-bill-date-date-type.sql` 会修改 `bill_details` 大表字段类型，建议在测试环境维护窗口执行。
- 如果目标环境尚未部署 v10.10，需要先按 v10.10 文档补齐 v10.00、v10.01、v10.02 迁移，再执行本版迁移。
- 本版不包含历史银行直捐入账结果 NC 项目名称的数据修复。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.12-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.11-bill-date-date-type.sql \
  migrate-v10.12-bank-flow-bank-name.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

迁移前检查、执行和复查：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_tasks LIKE 'bill_date'; SHOW COLUMNS FROM recognition_date_summaries LIKE 'bill_date'; SHOW COLUMNS FROM bill_details LIKE 'bill_date'; SHOW COLUMNS FROM bank_flows LIKE 'bank_name';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.11-bill-date-date-type.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.12-bank-flow-bank-name.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_tasks LIKE 'bill_date'; SHOW COLUMNS FROM recognition_date_summaries LIKE 'bill_date'; SHOW COLUMNS FROM bill_details LIKE 'bill_date'; SHOW COLUMNS FROM bank_flows LIKE 'bank_name'; SELECT bank_name, COUNT(*) AS cnt FROM bank_flows GROUP BY bank_name;"
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.12-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.12-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.11-bill-date-date-type.sql \
  migrate-v10.12-bank-flow-bank-name.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

迁移前检查、执行和复查：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_tasks LIKE 'bill_date'; SHOW COLUMNS FROM recognition_date_summaries LIKE 'bill_date'; SHOW COLUMNS FROM bill_details LIKE 'bill_date'; SHOW COLUMNS FROM bank_flows LIKE 'bank_name';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.11-bill-date-date-type.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.12-bank-flow-bank-name.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_tasks LIKE 'bill_date'; SHOW COLUMNS FROM recognition_date_summaries LIKE 'bill_date'; SHOW COLUMNS FROM bill_details LIKE 'bill_date'; SHOW COLUMNS FROM bank_flows LIKE 'bank_name'; SELECT bank_name, COUNT(*) AS cnt FROM bank_flows GROUP BY bank_name;"
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.12-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.12-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.12-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.12-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.12-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号应显示 `v10.12`。
- 添加银行到账弹窗应支持广发银行和工商银行流水文件；解析失败时应在弹窗内显示错误提示。
- 日期汇总的银行流水列表最左侧应显示 `银行` 列。
- 工商银行流水应进入日期汇总银行流水列表，状态为 `手动认账`，只走手动认账。
- 银行直捐手动认账时，预算编码后应出现 `NC项目名称` 下拉；确认认账后入账结果应显示所选 NC 项目名称。

## 回退

- 代码可通过上一版部署包 `finance-platform-v10.10-local.tar.gz` 回退。
- `bill_date` 字段已改为 `DATE`，如需数据库结构回退，需要单独评估并在维护窗口执行反向 SQL。
- `bank_flows.bank_name` 字段如需回退，可在确认旧代码不再访问该字段后删除。
