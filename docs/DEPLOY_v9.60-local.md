# v9.60-local 部署说明

## 文件

- `releases/finance-platform-v9.60-local.tar.gz`：v9.60 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v9.60-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：项目技能文档，已更新到 v9.60

## 重要说明

- 本版替代 v9.59-local 部署包；线上部署时上传 v9.60 包即可。
- 本版不新增数据库迁移。
- 部署前需确认线上已完成 v9.59 迁移。
- `migrate-v9.59-exclude-order-rule.sql` 虽然文件名为 v9.59，但它属于 v9.58 包中的排除订单前置迁移；继续作为线上检查项，缺少时先补齐。
- 字段或表已存在时不要重复执行同一迁移脚本，先用 `SHOW TABLES` 或 `SHOW COLUMNS` 检查。

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

如 `exclude_order_enabled` 不存在，先补 v9.58 前置迁移：

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
scp releases/finance-platform-v9.60-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

部署代码：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.60-local.tar.gz
```

如果服务器依赖状态异常：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.60-local.tar.gz
```

如需在线上强制执行类型检查：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.60-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 编辑明细认账规则时，规则基本信息区域输入应明显更顺畅，页面仍保持所有条件和分账展开。
- 规则详情页中的 `编辑条件` 仍进入单条件编辑页。
- 订单明细包列表存在未匹配明细时显示 `查看未匹配明细`，点击后详情页只显示未匹配明细。
- 订单明细包列表存在待拆分明细时显示 `查看待拆分明细`，点击后详情页只显示待拆分明细。
- 订单明细包列表和详情页顶部应分别展示未匹配与待拆分数量。

## 未来维护约束

- 明细认账规则普通编辑页必须保持整体展开编辑；不要改成摘要卡片或单条件跳转。
- 订单明细包 `未匹配` 和 `待拆分` 入口必须保持独立筛选。
