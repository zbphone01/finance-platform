# v9.61-local 部署说明

## 文件

- `releases/finance-platform-v9.61-local.tar.gz`：v9.61 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v9.61-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：项目技能文档，已更新到 v9.61

## 重要说明

- 本版替代 v9.60-local 部署包；线上部署时上传 v9.61 包即可。
- 本版不新增数据库迁移。
- 部署前需确认线上已完成 v9.59 迁移。
- `migrate-v9.59-exclude-order-rule.sql` 虽然文件名为 v9.59，但它属于排除订单前置迁移；继续作为线上检查项，缺少时先补齐。
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
scp releases/finance-platform-v9.61-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

部署代码：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.61-local.tar.gz
```

如果服务器依赖状态异常：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.61-local.tar.gz
```

如需在线上强制执行类型检查：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.61-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 删除同日汇总订单明细包后，相关流水应按剩余入账结果重新显示未认账、部分认账或已认账。
- 已匹配且金额为 `0.01` 的订单明细应能生成入账结果；只有明确 `0.00` 才不生成入账结果。
- 上传订单明细和上传明细分账过程中，点击 `取消上传` 应立即停止前端上传或轮询。
- 上传订单明细弹窗应显示服务端每 `5000` 行分批入库。
- 明细分账待拆分预匹配应按 `等于 -> 组合等于 -> 组合包含 -> 普通包含` 执行。
- 明细分账组合关键字应由条件认账关键字和明细分账判断关键字组成，且字段一致时才参与组合。

## 未来维护约束

- 订单明细认账前置金额校验、同日汇总按规则条件汇总入账、明细分账组合关键字预匹配，均已写入 skill 文档；后续改动前必须先确认。
- 既有显示、交互、性能优化边界已记录；涉及这些边界或有更优执行建议时，必须先询问确认。
