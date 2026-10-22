# v9.83-local 版本快照

## 发布范围

- 本版包含财务信息设置下的 `制单摘要` 配置功能，以及入账结果列表的 `订单明细数` 展示快照。
- 部署包：`releases/finance-platform-v9.83-local.tar.gz`。
- 推荐继续使用 `deploy-update-optimized.sh` 部署。

## 财务信息设置

- 左侧菜单 `财务信息设置` 改为可展开菜单。
- 新增二级菜单 `制单摘要`。
- `制单摘要` 支持从 `到账信息汇总` 已记录到账信息中选择到账信息，并维护摘要文案。
- 支持制单摘要的新建、编辑、删除和列表展示。

## 入账结果

- `match_results` 新增 `order_detail_count_snapshot`，用于保存每条入账结果对应的实际订单明细数快照。
- 明细认账生成的每条入账结果都会写入该条入账对应匹配组的订单明细数。
- 到账认账和手动认账写入 `0`，页面展示为 `-`。
- 入账结果页的入账明细列表在 `入账金额` 左侧新增 `订单明细数` 列。
- 现有 `detail_count` 继续保留给汇总统计使用，不改变既有汇总口径。

## 数据库迁移

- 新增 `migrate-v9.82-voucher-summaries.sql`：创建 `voucher_summaries` 制单摘要表。
- 新增 `migrate-v9.83-match-result-order-detail-count-snapshot.sql`：为 `match_results` 增加 `order_detail_count_snapshot` 并回填历史数据。
- 本地迁移已执行并校验通过。

## 验证

- `npm run check` 通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- 发布包完整性检查通过，沿用历史轻量发布方式，不包含本地 `dist`，由服务器部署脚本重新构建。
