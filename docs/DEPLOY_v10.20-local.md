# v10.20-local 部署说明

## 文件

- `releases/finance-platform-v10.20-local.tar.gz`：v10.20 部署包
- `migrate-v10.20-manual-recognition-voucher-receipt-channel.sql`：手动认账入账结果保存制单收款渠道编号
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.20-local.md`：版本快照

## 重要说明

- 从 v10.19 升级到 v10.20，需要上传代码包和 `migrate-v10.20-manual-recognition-voucher-receipt-channel.sql`，先执行迁移，再部署代码包。
- 如果目标环境尚未部署 v10.19，需要先按 v10.19 部署说明补齐 v10.16-v10.19 迁移。
- 本地数据库已执行 v10.20 迁移，字段 `match_results.voucher_receipt_channel_code` 已确认存在。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.20-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.20-manual-recognition-voucher-receipt-channel.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

迁移前检查、执行和复查：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM match_results LIKE 'voucher_receipt_channel_code';"
if ! mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW COLUMNS FROM match_results LIKE 'voucher_receipt_channel_code';" | grep -q '^voucher_receipt_channel_code'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.20-manual-recognition-voucher-receipt-channel.sql
fi
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM match_results LIKE 'voucher_receipt_channel_code';"
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.20-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.20-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.20-manual-recognition-voucher-receipt-channel.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

迁移前检查、执行和复查：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM match_results LIKE 'voucher_receipt_channel_code';"
if ! mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW COLUMNS FROM match_results LIKE 'voucher_receipt_channel_code';" | grep -q '^voucher_receipt_channel_code'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.20-manual-recognition-voucher-receipt-channel.sql
fi
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM match_results LIKE 'voucher_receipt_channel_code';"
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.20-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.20-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.20-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.20-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.20-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号应显示 `v10.20`。
- 手动认账分账设置默认只显示分账形式和收入类型。
- 到账认账手动认账选择 `捐赠收入` 后，捐赠来源默认 `银行直捐`。
- 订单明细手动认账选择 `捐赠收入` 后，捐赠来源默认 `互联网募捐平台`。
- 手动认账 `收款渠道` 下拉可选择收款渠道，制单时使用所选渠道。
- 财务凭证信息菜单应显示 `收款渠道管理`。

## 回退

- 代码可通过上一版部署包 `finance-platform-v10.19-local.tar.gz` 回退。
- 如需回退数据库结构，可在确认不再需要手动认账制单收款渠道数据后执行：

```sql
ALTER TABLE match_results
  DROP COLUMN voucher_receipt_channel_code;
```
