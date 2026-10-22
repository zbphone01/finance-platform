# v9.63-local 部署说明

## 文件

- `releases/finance-platform-v9.63-local.tar.gz`：v9.63 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v9.63-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：项目技能文档，已更新到 v9.63

## 重要说明

- 本版替代 v9.62-local 部署包；线上部署时上传 v9.63 包即可。
- 本版不新增数据库迁移。
- 本版修复省略整数位小数金额解析和多整包规则共用同一银行到账时的完成判断。
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
scp releases/finance-platform-v9.63-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

部署代码：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.63-local.tar.gz
```

如果服务器依赖状态异常：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.63-local.tar.gz
```

如需在线上强制执行类型检查：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.63-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 上传包含 `.99`、`.02` 等金额的打包明细文件后，订单总额应按真实小数金额计算。
- 同一匹配日期、同一到账别称下，多个打包明细包合计等于同一银行到账时，点击开始认账应将该到账标记为已认账。
- 认账及分账列表显示某日认账执行中时，应理解为日期汇总状态；明细队列只处理有订单明细的任务。

## 未来维护约束

- 订单明细上传和明细分账上传应继续共用统一金额解析，避免不同入口对 `.99` 等金额口径不一致。
- 无条件整包打包明细的完成判断必须按到账别称和匹配日期汇总所有打包明细包，不要退回只看当前 `rule_id`。
- 日期汇总显示 `processing` 是汇总状态，不应据此推断每条银行流水都在重跑明细认账。
