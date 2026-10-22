# v10.14-local 部署说明

## 文件

- `releases/finance-platform-v10.14-local.tar.gz`：v10.14 部署包
- `migrate-v10.14-voucher-receipt-channels.sql`：凭证收款渠道维护表迁移
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.14-local.md`：版本快照

## 重要说明

- 从 v10.13 升级到 v10.14，需要上传代码包和迁移脚本，先执行 `migrate-v10.14-voucher-receipt-channels.sql`，再部署代码包。
- 该迁移只新增 `voucher_receipt_channels` 表，不改动现有业务表数据。
- 如果目标环境尚未部署 v10.13，需要先按 v10.13 文档完成 `migrate-v10.13-order-detail-partitioning.sql`。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.14-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.14-voucher-receipt-channels.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

迁移前检查、执行和复查：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'voucher_receipt_channels';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.14-voucher-receipt-channels.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'voucher_receipt_channels'; SHOW COLUMNS FROM voucher_receipt_channels; SHOW INDEX FROM voucher_receipt_channels WHERE Key_name = 'vrc_channel_code_idx';"
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.14-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.14-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.14-voucher-receipt-channels.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

迁移前检查、执行和复查：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'voucher_receipt_channels';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.14-voucher-receipt-channels.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'voucher_receipt_channels'; SHOW COLUMNS FROM voucher_receipt_channels; SHOW INDEX FROM voucher_receipt_channels WHERE Key_name = 'vrc_channel_code_idx';"
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.14-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.14-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.14-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.14-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.14-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号应显示 `v10.14`。
- `到账信息汇总` 页签栏应显示 `凭证收款渠道`。
- 凭证收款渠道可新增、编辑、删除，重复编号应提示错误。
- 账号管理重置密码后点击复制应提示复制成功。
- `认账及分账` 第 N 页进入日期汇总详情后，点击返回应回到第 N 页。
- 手动认账银行直捐利息可不填反馈类型、支出资金来源、地区、匿名、会员姓名和管理费。

## 回退

- 代码可通过上一版部署包 `finance-platform-v10.13-local.tar.gz` 回退。
- 如需回退数据库结构，可在确认不再需要凭证收款渠道数据后执行：

```sql
DROP TABLE voucher_receipt_channels;
```
