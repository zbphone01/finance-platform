# v10.00-local 部署说明

## 文件

- `releases/finance-platform-v10.00-local.tar.gz`：v10.00 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `migrate-v10.00-bank-flow-recognition-status.sql`：银行流水认账状态字段迁移
- `docs/VERSION_SNAPSHOT_v10.00-local.md`：版本快照

## 重要说明

- 本版替代 v9.99-local 部署包。
- 本版新增数据库迁移：`migrate-v10.00-bank-flow-recognition-status.sql`。
- 已部署 v9.99 的环境，部署 v10.00 代码前需要执行本版迁移。
- 如果目标环境尚未部署 v9.99，需要先补齐历史迁移，再执行本版迁移。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.00-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.00-bank-flow-recognition-status.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

执行迁移：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM bank_flows LIKE 'recognition_status';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.00-bank-flow-recognition-status.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM bank_flows LIKE 'recognition_status';"
```

部署：

```bash
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.00-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.00-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.00-bank-flow-recognition-status.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

执行迁移：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM bank_flows LIKE 'recognition_status';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.00-bank-flow-recognition-status.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM bank_flows LIKE 'recognition_status';"
```

部署：

```bash
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.00-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.00-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.00-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.00-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.00-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号应显示 `v10.00`。
- 2026-05-09 支付宝 T+1 同日汇总中，被部分覆盖的银行流水应显示为部分认账。
- 删除 2026-05-08 支付宝订单明细包时，不应再出现 `match_result_id = ?` 空参数报错。
- 删除百万级订单明细包时，接口不应再长时间卡在读取全部明细阶段。
- 上传大订单明细包时，处理明细阶段进度应按行数逐步推进。

## 回退

- 代码可通过上一版部署包 `finance-platform-v9.99-local.tar.gz` 回退。
- 本版修改了 `bank_flows` 的认账状态字段名；如需完全回退数据库结构，需要先确认旧版代码已恢复，再将 `recognition_status` 改回旧字段。
