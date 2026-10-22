# v9.55-local 部署说明

## 文件

- `releases/finance-platform-v9.55-local.tar.gz`：v9.55 部署包，包含 v9.54 和 v9.55 代码变更
- `migrate-v9.55-multi-split-order-details.sql`：v9.55 数据库迁移
- `docs/VERSION_SNAPSHOT_v9.55-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：项目技能文档，已更新到 v9.55

## 重要说明

- 本版用于随 v9.54 一起部署线上；不要再单独部署 v9.54 包。
- 部署顺序：先上传部署包和迁移脚本，再执行数据库迁移，最后运行部署脚本。
- v9.55 主要包含：
  - 明细认账规则新增规则级单条多分账配置。
  - 订单明细上传预匹配按 `等于 -> 待拆分 -> 包含` 顺序执行。
  - 命中单条多分账后标记 `pending_split`，不绑定规则条件 ID。
  - 单条多分账使用末尾关键字快路径，命中后跳过包含规则扫描。
  - 明细认账规则列表中的编辑入口保持整体编辑交互；单条件编辑只保留在规则详情页。
  - 明细认账规则整体编辑继续保留 v9.50 输入性能优化。

## 本地迁移

```bash
cd /home/deploy/Documents/资金池认账
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.55-multi-split-order-details.sql
```

本地检查：

```bash
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM recognition_rules LIKE 'multi_split_%';"
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM bill_details LIKE 'match_status';"
```

## 线上部署

上传部署包、部署脚本和迁移脚本：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.55-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.55-multi-split-order-details.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

登录服务器：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
```

检查并执行迁移：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_rules LIKE 'multi_split_%';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.55-multi-split-order-details.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_rules LIKE 'multi_split_%'; SHOW COLUMNS FROM bill_details LIKE 'match_status';"
```

部署代码：

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.55-local.tar.gz
```

如果服务器依赖状态异常：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.55-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 进入 `认账规则 -> 明细认账`，新建或编辑规则，应能开启 `明细分账` 并填写明细分账判断字段、判断关键字和明细匹配字段。
- 规则配置 `明细分账判断字段=商品名称`、`判断关键字=等多件` 后，上传订单明细时，字段值以 `等多件` 结尾的明细应标记为待拆分。
- 待拆分明细不应绑定具体规则条件 ID。
- 字段值不以 `等多件` 结尾时，应继续按原有 `等于` / `包含` 规则预匹配。
- 从明细认账规则列表点击 `编辑` 时，应进入整体编辑页，已有条件和分账应直接在当前页展开维护。
- 从明细认账规则详情页点击某条条件的 `编辑条件` 时，才进入单条件编辑页。
- 整体编辑页顶部规则信息输入应保持顺畅，草稿延迟保存和树形下拉性能优化应继续生效。
- 进入 `认账及分账 -> 日期详情 -> 订单明细`，汇总统计应显示 `已认账`、`未认账`、`未认账中待拆分`；具体明细状态应显示 `待拆分`，并可使用 `待拆分` 筛选。
- 日期详情汇总中的 `未认账` 数量应按未生成入账结果统计，包含真正未匹配、待拆分和已匹配但未入账的明细；具体明细筛选里的 `未认账` 按不含待拆分展示，待拆分使用独立筛选查看。
- 进入 `订单明细包 -> 订单明细内容`，待拆分明细的匹配状态应显示为 `待拆分`。
- 进入 `订单明细包` 主表，状态统计应显示 `未匹配 / 待拆分`，其中未匹配数量包含待拆分；点击查看未匹配明细时应同时展示真正未匹配和待拆分明细。
- 对已有未匹配明细补充单条多分账配置后，点击 `开始认账`，符合尾部关键字的未匹配明细应更新为待拆分。
