# v9.56-local 部署说明

## 文件

- `releases/finance-platform-v9.56-local.tar.gz`：v9.56 部署包，包含 v9.54、v9.55 和 v9.56 修正
- `deploy-update-optimized.sh`：推荐部署脚本
- `migrate-v9.55-multi-split-order-details.sql`：单条多分账与 `pending_split` 状态迁移
- `migrate-v9.55-summary-cache-fields.sql`：订单明细包、任务、日期汇总缓存字段迁移和回填
- `docs/VERSION_SNAPSHOT_v9.56-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：项目技能文档，已更新到 v9.56

## 重要说明

- 本版替代 v9.55-local 部署包；线上部署时上传 v9.56 包即可。
- 部署顺序：先上传部署包、部署脚本和迁移脚本，再执行数据库迁移，最后运行部署脚本。
- 如果线上已经执行过某个迁移，先用 `SHOW COLUMNS` 检查，不要重复执行同一个 `ALTER TABLE ADD COLUMN` 脚本。
- 本版读路径依赖缓存字段；如果未执行 `migrate-v9.55-summary-cache-fields.sql`，`认账及分账` 和 `订单明细包` 可能因字段缺失无法加载。

## 本地迁移

```bash
cd /home/deploy/Documents/资金池认账
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.55-multi-split-order-details.sql
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.55-summary-cache-fields.sql
```

本地检查：

```bash
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM recognition_rules LIKE 'multi_split_%';"
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM bill_details LIKE 'match_status';"
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM order_files LIKE 'order_total_amount'; SHOW COLUMNS FROM order_files LIKE 'pending_split_count'; SHOW COLUMNS FROM recognition_tasks LIKE 'pending_split_count'; SHOW COLUMNS FROM recognition_date_summaries LIKE 'pending_split_count';"
```

## 线上部署

上传部署包、部署脚本和迁移脚本：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.56-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.55-multi-split-order-details.sql \
  migrate-v9.55-summary-cache-fields.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

登录服务器：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
```

检查迁移状态：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_rules LIKE 'multi_split_%';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM bill_details LIKE 'match_status';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM order_files LIKE 'order_total_amount'; SHOW COLUMNS FROM order_files LIKE 'pending_split_count'; SHOW COLUMNS FROM recognition_tasks LIKE 'pending_split_count'; SHOW COLUMNS FROM recognition_date_summaries LIKE 'pending_split_count';"
```

如字段不存在，按顺序执行迁移：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.55-multi-split-order-details.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.55-summary-cache-fields.sql
```

再次检查：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_rules LIKE 'multi_split_%'; SHOW COLUMNS FROM bill_details LIKE 'match_status';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM order_files LIKE 'order_total_amount'; SHOW COLUMNS FROM order_files LIKE 'pending_split_count'; SHOW COLUMNS FROM recognition_tasks LIKE 'pending_split_count'; SHOW COLUMNS FROM recognition_date_summaries LIKE 'pending_split_count';"
```

部署代码：

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.56-local.tar.gz
```

如果服务器依赖状态异常：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.56-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 进入 `认账规则 -> 明细认账`，新建或编辑规则，应能开启 `明细分账` 并填写明细分账判断字段、判断关键字和明细匹配字段。
- 上传订单明细时，字段值以配置关键字结尾的明细应标记为 `待拆分`，且不绑定具体规则条件 ID。
- 进入 `认账及分账`，日期汇总和日期详情应正常加载，并显示 `已认账`、`未认账`、`未认账中待拆分`。
- 进入 `订单明细包`，列表应正常加载，状态统计显示 `未匹配 / 待拆分`，查看未匹配明细应包含待拆分明细。
- 从明细认账规则列表点击 `编辑`，应进入整体编辑页，已有条件和分账直接展开维护。
- 从明细认账规则详情页点击某条条件的 `编辑条件`，才进入单条件编辑页。
- 整体编辑页顶部规则信息输入应保持顺畅，草稿延迟保存和树形下拉性能优化应继续生效。
- 进入 `到账信息汇总`，已记录列表列顺序应为 `到账别称-认账类型-到账匹配方式-匹配条件-地区-对方账号-对方户名-用途-附言-操作`。
- 到账信息存在多组匹配条件时，对方账号、对方户名、用途、附言应显示 `-`。
- 编辑同日汇总匹配且条件多于 2 组时，条件卡片区域应可上下滚动，弹窗不应被撑得过高。

## 未来维护约束

- 明细认账规则列表的普通 `编辑` 入口必须保持整体编辑，不得随意改成摘要卡片或单条件跳转。
- 单条件编辑只用于规则详情页中查看某条条件后的定向维护。
- 订单明细包和认账及分账列表首屏必须继续读取缓存字段，不得改回实时扫描大明细表。
