# v9.70-local 部署说明

## 文件

- `releases/finance-platform-v9.70-local.tar.gz`：v9.70 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `migrate-v9.70-detail-split-rule-upload-fields.sql`：明细认账规则分账包设置字段迁移
- `docs/VERSION_SNAPSHOT_v9.70-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：项目技能文档，已更新到 v9.70

## 重要说明

- 本版替代 v9.69-local 部署包；线上部署时上传 v9.70 包即可。
- 已部署过 v9.69 的环境，只需继续执行 v9.70 迁移。
- `migrate-v9.70-detail-split-rule-upload-fields.sql` 是结构迁移；字段已存在时不要重复执行，先用 `SHOW COLUMNS` 检查。

## 本地迁移

```bash
cd /home/deploy/Documents/资金池认账

mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.70-detail-split-rule-upload-fields.sql
```

复查：

```bash
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM recognition_rules LIKE 'detail_split_recognition_keyword_field'; SHOW COLUMNS FROM recognition_rules LIKE 'detail_split_income_field'; SHOW COLUMNS FROM recognition_rules LIKE 'detail_split_match_field';"
```

## 线上部署

上传部署包、部署脚本和迁移脚本：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.70-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.70-detail-split-rule-upload-fields.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

登录服务器并执行迁移：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform

mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.70-detail-split-rule-upload-fields.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_rules LIKE 'detail_split_recognition_keyword_field'; SHOW COLUMNS FROM recognition_rules LIKE 'detail_split_income_field'; SHOW COLUMNS FROM recognition_rules LIKE 'detail_split_match_field';"
```

部署代码：

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.70-local.tar.gz
```

如果服务器依赖状态异常：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.70-local.tar.gz
```

如需在线上强制执行类型检查：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.70-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 新建或编辑明细认账规则，开启明细分账后应看到“分账包设置”，默认值为 `商品标题`、`买家实付金额`、`主订单编号`。
- 上传明细分账时，弹窗不再要求填写三个字段，选择规则后应展示该规则的分账包设置。
- 明细分账上传应按规则中的分账包设置校验文件表头。
- 日期汇总订单明细数量不应因空任务旧快照或分账子明细而重复放大。
