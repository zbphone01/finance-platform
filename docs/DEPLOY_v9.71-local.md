# v9.71-local 部署说明

## 文件

- `releases/finance-platform-v9.71-local.tar.gz`：v9.71 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `migrate-v9.70-detail-split-rule-upload-fields.sql`：v9.70 明细认账规则分账包设置字段迁移，未执行过 v9.70 时才需要
- `docs/VERSION_SNAPSHOT_v9.71-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：项目技能文档，已更新到 v9.71

## 重要说明

- 本版替代 v9.70-local 部署包；线上部署时上传 v9.71 包即可。
- 本版不新增数据库迁移。
- 已部署并迁移过 v9.70 的环境，直接部署 v9.71 代码。
- 尚未部署 v9.70 的环境，需要先执行 `migrate-v9.70-detail-split-rule-upload-fields.sql`。

## 本地迁移检查

已执行过 v9.70 迁移时无需重复执行。可用下面命令确认字段存在：

```bash
cd /home/deploy/Documents/资金池认账

mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM recognition_rules LIKE 'detail_split_recognition_keyword_field'; SHOW COLUMNS FROM recognition_rules LIKE 'detail_split_income_field'; SHOW COLUMNS FROM recognition_rules LIKE 'detail_split_match_field';"
```

如果字段不存在，先执行：

```bash
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.70-detail-split-rule-upload-fields.sql
```

## 线上部署

上传部署包和部署脚本；未执行过 v9.70 迁移时同时上传迁移脚本：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.71-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.70-detail-split-rule-upload-fields.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

登录服务器：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
```

如未执行过 v9.70 迁移，先执行并复查：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.70-detail-split-rule-upload-fields.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_rules LIKE 'detail_split_recognition_keyword_field'; SHOW COLUMNS FROM recognition_rules LIKE 'detail_split_income_field'; SHOW COLUMNS FROM recognition_rules LIKE 'detail_split_match_field';"
```

部署代码：

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.71-local.tar.gz
```

如果服务器依赖状态异常：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.71-local.tar.gz
```

如需在线上强制执行类型检查：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.71-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 删除明细分账包后，来源订单明细应恢复为待拆分，相关银行流水应回到正确认账状态。
- 删除订单明细包后，认账及分账列表不应继续显示旧订单明细条数。
- 重传订单明细包后，同日期同规则空任务不应残留旧明细条数。
- 明细分账认账完成后，切换到认账及分账菜单应能看到最新银行流水状态。
- 上传明细分账时，字段仍从明细认账规则的分账包设置读取。
