# v10.02-local 部署说明

## 文件

- `releases/finance-platform-v10.02-local.tar.gz`：v10.02 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `migrate-v10.01-voucher-summary-flow-index.sql`：凭证汇总筛选读取索引
- `migrate-v10.02-match-result-recognition-type.sql`：入账结果认账类型字段
- `docs/VERSION_SNAPSHOT_v10.02-local.md`：版本快照

## 重要说明

- 本版替代 v10.00-local 部署包。
- 已部署 v10.00 的环境，部署 v10.02 代码前需要先执行 v10.01、v10.02 迁移。
- 如果目标环境尚未部署 v10.00，需要先补齐 `migrate-v10.00-bank-flow-recognition-status.sql`，再执行本版迁移。
- 迁移脚本不要重复执行；执行前先用检查命令确认字段或索引是否已存在。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.02-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.01-voucher-summary-flow-index.sql \
  migrate-v10.02-match-result-recognition-type.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

执行迁移：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW INDEX FROM bank_flows WHERE Key_name = 'bf_status_time_id_idx'; SHOW COLUMNS FROM match_results LIKE 'recognition_type';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.01-voucher-summary-flow-index.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.02-match-result-recognition-type.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW INDEX FROM bank_flows WHERE Key_name = 'bf_status_time_id_idx'; SHOW COLUMNS FROM match_results LIKE 'recognition_type';"
```

部署：

```bash
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.02-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.02-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.01-voucher-summary-flow-index.sql \
  migrate-v10.02-match-result-recognition-type.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

执行迁移：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW INDEX FROM bank_flows WHERE Key_name = 'bf_status_time_id_idx'; SHOW COLUMNS FROM match_results LIKE 'recognition_type';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.01-voucher-summary-flow-index.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.02-match-result-recognition-type.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW INDEX FROM bank_flows WHERE Key_name = 'bf_status_time_id_idx'; SHOW COLUMNS FROM match_results LIKE 'recognition_type';"
```

部署：

```bash
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.02-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.02-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.02-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.02-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.02-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号应显示 `v10.02`。
- 认账及分账上传重复银行流水时，弹窗应显示忽略流水的日期、流水号和金额。
- 凭证汇总应按时间倒序显示，每页 50 条，并支持日期范围和流水状态筛选。
- 多笔到账生成同一凭证时，凭证汇总中银行流水列应展示多条流水，到账金额应为合计。
- 入账明细列表应展示“认账类型”，位置在流水号和收入类型之间。
- 凭证详情底部应展示实时总计行，点击明细行应高亮并出现核对浮层。

## 回退

- 代码可通过上一版部署包 `finance-platform-v10.00-local.tar.gz` 回退。
- 本版新增了 `match_results.recognition_type` 字段和 `bank_flows` 索引；如需完全回退数据库结构，需要先确认旧版代码已恢复，再评估是否移除新增字段与索引。
