# v9.59-local 部署说明

## 文件

- `releases/finance-platform-v9.59-local.tar.gz`：v9.59 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `migrate-v9.59-detail-split-files.sql`：明细分账包迁移
- `docs/VERSION_SNAPSHOT_v9.59-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：项目技能文档，已更新到 v9.59

## 重要说明

- 本版替代 v9.58-local 部署包；线上部署时上传 v9.59 包即可。
- 部署顺序：先上传部署包、部署脚本和迁移脚本，再执行数据库迁移，最后运行部署脚本。
- `migrate-v9.59-exclude-order-rule.sql` 虽然文件名为 v9.59，但它属于 v9.58 包中的排除订单前置迁移；本轮部署把它作为检查项，线上缺少时先补齐。
- 如果线上尚未部署 v9.58，必须先按 v9.58 部署说明补齐 `migrate-v9.58-condition-recognition-enabled.sql` 和 `migrate-v9.59-exclude-order-rule.sql`。
- 如果目标环境尚未部署 v9.57 及以前迁移，必须先按历史部署说明补齐到 v9.58。
- 字段或表已存在时不要重复执行同一迁移脚本，先用 `SHOW TABLES` 或 `SHOW COLUMNS` 检查。

## 本地迁移

检查迁移状态：

```bash
cd /home/deploy/Documents/资金池认账
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM recognition_rules LIKE 'exclude_order_enabled';"
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW TABLES LIKE 'detail_split_files'; SHOW COLUMNS FROM bill_details LIKE 'detail_split_file_id'; SHOW COLUMNS FROM bill_details LIKE 'split_source_detail_id';"
```

如 `exclude_order_enabled` 不存在，先补前置迁移：

```bash
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.59-exclude-order-rule.sql
```

如明细分账包表或字段不存在，执行本轮迁移：

```bash
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.59-detail-split-files.sql
```

再次检查：

```bash
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW TABLES LIKE 'detail_split_files'; SHOW COLUMNS FROM bill_details LIKE 'detail_split_file_id'; SHOW COLUMNS FROM bill_details LIKE 'split_source_detail_id';"
```

## 线上部署

上传部署包、部署脚本和迁移脚本：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.59-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.59-detail-split-files.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

登录服务器：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
```

检查迁移状态：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_rules LIKE 'exclude_order_enabled';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'detail_split_files';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM bill_details LIKE 'detail_split_file_id';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM bill_details LIKE 'split_source_detail_id';"
```

如 `exclude_order_enabled` 不存在，先补 v9.58 前置迁移：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.59-exclude-order-rule.sql
```

如明细分账包表或字段不存在，执行本轮迁移：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.59-detail-split-files.sql
```

再次检查：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'detail_split_files'; SHOW COLUMNS FROM bill_details LIKE 'detail_split_file_id'; SHOW COLUMNS FROM bill_details LIKE 'split_source_detail_id';"
```

部署代码：

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.59-local.tar.gz
```

如果服务器依赖状态异常：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.59-local.tar.gz
```

如需在线上强制执行类型检查：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.59-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 左侧菜单应显示 `明细分账包`，进入后列表可正常加载。
- `认账及分账` 页面应在 `上传订单明细` 左侧显示 `上传明细分账`。
- 上传订单明细 CSV 时，缺少明细认账规则配置字段应直接失败；单行缺少订单号、日期或收入金额应跳过并继续入库。
- 上传 300M 以上 CSV 订单明细时，服务端应边读边解析，中文字段不应出现 `�` 乱码。
- 订单明细包删除过程中切换菜单再返回，应保持删除中状态并禁用删除按钮。
- 失败上传且入库条数为 0 的订单明细包应可删除。
- 明细分账包上传后，金额匹配且命中条件的分账明细应入库为已匹配，并触发认账队列。

## 未来维护约束

- CSV 大文件上传必须保持分片合并后再流式解析，不能改回整文件读入内存。
- 订单明细规则字段按精确列头匹配，不再做别名兼容。
- 订单明细包和认账及分账列表首屏继续读取缓存字段，不得改回实时扫描大明细表。
