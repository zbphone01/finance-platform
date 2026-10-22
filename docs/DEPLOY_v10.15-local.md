# v10.15-local 部署说明

## 文件

- `releases/finance-platform-v10.15-local.tar.gz`：v10.15 部署包
- `migrate-v10.15-voucher-line-explanation-json.sql`：凭证结果行浮层快照字段迁移
- `migrate-v10.14-voucher-receipt-channels.sql`：凭证收款渠道维护表迁移，仅未部署 v10.14 的环境需要执行
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.15-local.md`：版本快照

## 重要说明

- 从 v10.14 升级到 v10.15，需要上传代码包和 `migrate-v10.15-voucher-line-explanation-json.sql`，先执行迁移，再部署代码包。
- 该迁移为 `voucher_result_lines` 新增 `line_type` 和 `explanation_json` 字段，用于保存制单结果行类型和浮层静态 JSON。
- 如果目标环境尚未部署 v10.14，需要先执行 `migrate-v10.14-voucher-receipt-channels.sql`，再执行 v10.15 迁移。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.15-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.14-voucher-receipt-channels.sql \
  migrate-v10.15-voucher-line-explanation-json.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

迁移前检查、执行和复查：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'voucher_receipt_channels'; SHOW COLUMNS FROM voucher_result_lines LIKE 'line_type'; SHOW COLUMNS FROM voucher_result_lines LIKE 'explanation_json';"
if ! mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW TABLES LIKE 'voucher_receipt_channels';" | grep -q '^voucher_receipt_channels$'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.14-voucher-receipt-channels.sql
fi
if ! mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW COLUMNS FROM voucher_result_lines LIKE 'line_type';" | grep -q '^line_type'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.15-voucher-line-explanation-json.sql
fi
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'voucher_receipt_channels'; SHOW COLUMNS FROM voucher_result_lines LIKE 'line_type'; SHOW COLUMNS FROM voucher_result_lines LIKE 'explanation_json';"
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.15-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.15-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.14-voucher-receipt-channels.sql \
  migrate-v10.15-voucher-line-explanation-json.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

迁移前检查、执行和复查：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'voucher_receipt_channels'; SHOW COLUMNS FROM voucher_result_lines LIKE 'line_type'; SHOW COLUMNS FROM voucher_result_lines LIKE 'explanation_json';"
if ! mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW TABLES LIKE 'voucher_receipt_channels';" | grep -q '^voucher_receipt_channels$'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.14-voucher-receipt-channels.sql
fi
if ! mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -N -B -e "SHOW COLUMNS FROM voucher_result_lines LIKE 'line_type';" | grep -q '^line_type'; then
  mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.15-voucher-line-explanation-json.sql
fi
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'voucher_receipt_channels'; SHOW COLUMNS FROM voucher_result_lines LIKE 'line_type'; SHOW COLUMNS FROM voucher_result_lines LIKE 'explanation_json';"
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.15-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.15-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.15-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.15-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.15-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号应显示 `v10.15`。
- `财务凭证信息` 应展开显示 `凭证模板` 和 `收入渠道管理`。
- 收入渠道管理可新增、编辑、删除渠道，列表按 `n.n` 编号数值顺序排序。
- 到账信息编辑页的 `凭证收款渠道` 应为下拉选择，保存后制单使用渠道名称。
- 明细认账制单后，凭证详情项目资金和管理费行可点击查看浮层，浮层展示已保存的 `编号_名称` 渠道快照。

## 回退

- 代码可通过上一版部署包 `finance-platform-v10.14-local.tar.gz` 回退。
- 如需回退数据库结构，需要先确认不再依赖已生成凭证行的浮层快照，再执行：

```sql
ALTER TABLE voucher_result_lines
  DROP COLUMN explanation_json,
  DROP COLUMN line_type;
```
