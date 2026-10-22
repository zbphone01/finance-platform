# v9.73-local 部署说明

## 文件

- `releases/finance-platform-v9.73-local.tar.gz`：v9.73 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `migrate-v9.70-detail-split-rule-upload-fields.sql`：v9.70 明细认账规则分账包设置字段迁移，未执行过 v9.70 时才需要
- `docs/VERSION_SNAPSHOT_v9.73-local.md`：版本快照

## 重要说明

- 本版替代 v9.72-local 部署包；线上部署时上传 v9.73 包即可。
- 本版不新增数据库迁移。
- 已部署并迁移过 v9.70 的环境，直接部署 v9.73 代码。
- 尚未部署 v9.70 的环境，需要先执行 `migrate-v9.70-detail-split-rule-upload-fields.sql`。
- 本版重点优化日期汇总银行流水列表中的取消认账入口、部分手动认账取消选择，以及认账差额列显示。

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
scp releases/finance-platform-v9.73-local.tar.gz \
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
./deploy-update-optimized.sh finance-platform-v9.73-local.tar.gz
```

如果服务器依赖状态异常：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.73-local.tar.gz
```

如需在线上强制执行类型检查：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.73-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 日期汇总银行流水列表中，已认账的到账认账或手动认账流水状态后应出现三个点菜单。
- 点击菜单中的“取消认账”，应弹出确认框；确认后对应银行到账回滚为未认账。
- 对部分手动认账流水，弹窗选项应显示预算编码和金额，可只取消选中的手动认账金额。
- 对已有明细认账又手动补认账的流水，取消手动认账后原明细认账结果应保留。
- 当前银行流水列表没有差异金额时，不应显示“认账差额”列；存在差异金额时该列应显示并固定。

## 回退

- 代码可通过上一版部署包 `finance-platform-v9.72-local.tar.gz` 回退。
- 本版不新增数据库结构，通常不需要数据库回退。
