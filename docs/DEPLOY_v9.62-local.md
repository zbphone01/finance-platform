# v9.62-local 部署说明

## 文件

- `releases/finance-platform-v9.62-local.tar.gz`：v9.62 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v9.62-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：项目技能文档，已更新到 v9.62

## 重要说明

- 本版替代 v9.61-local 部署包；线上部署时上传 v9.62 包即可。
- 本版不新增数据库迁移。
- 部署前需确认线上已完成 v9.59 迁移。
- `migrate-v9.59-exclude-order-rule.sql` 虽然文件名为 v9.59，但它属于排除订单前置迁移；继续作为线上检查项，缺少时先补齐。
- 字段或表已存在时不要重复执行同一迁移脚本，先用 `SHOW TABLES` 或 `SHOW COLUMNS` 检查。
- 如果线上已经被旧逻辑写入了超额打包明细认账结果，新版只会防止后续继续发生；已有 pending 结果需确认后单独回滚。

## 迁移检查

登录服务器：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
```

检查 v9.58 / v9.59 迁移状态：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_rules LIKE 'exclude_order_enabled';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'detail_split_files';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM bill_details LIKE 'detail_split_file_id';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM bill_details LIKE 'split_source_detail_id';"
```

如 `exclude_order_enabled` 不存在，先补前置迁移：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.59-exclude-order-rule.sql
```

如明细分账包表或字段不存在，先执行 v9.59 迁移：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.59-detail-split-files.sql
```

## 线上部署

上传部署包和部署脚本：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.62-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

部署代码：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.62-local.tar.gz
```

如果服务器依赖状态异常：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.62-local.tar.gz
```

如需在线上强制执行类型检查：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.62-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 打包明细规则的日期字段、订单号字段可以留空保存，保存后不应自动回填默认字段。
- 上传打包订单明细时，如果日期字段和订单号字段都为空，应按文件内容入库并保留原始列数据。
- 同一到账别称、同一匹配日期的多个打包明细包金额超过银行到账金额时，点击开始认账应快速进入差异状态并显示差异金额。
- 明细认账规则列表应一次展示全部规则，不再分页。

## 未来维护约束

- 打包明细的日期字段和订单号字段可空逻辑只适用于匹配到账信息为打包明细的规则。
- 打包明细金额差异必须先于补匹配和明细扫描判断；不要恢复为先大量计算再报差异。
- 已有历史超额认账结果不在版本部署时自动清理，避免误删真实人工确认结果。
