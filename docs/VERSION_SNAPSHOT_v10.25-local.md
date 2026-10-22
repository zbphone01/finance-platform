# v10.25-local 版本快照

## 发布范围

- 本版聚焦订单明细大表索引瘦身和 schema 定义对齐。
- 右上角系统版本号更新为 `v10.25`。
- 部署包：`releases/finance-platform-v10.25-local.tar.gz`。
- 推荐继续使用 `deploy-update-optimized.sh` 部署。

## 数据库与索引

- `db/schema.ts` 对齐实际库的 v10.13 分区后索引定义：
  - `bd_rule_partition_date_bill_no_uq(rule_id, partition_date, bill_date, bill_no)`
  - `bd_rule_detail_split_status_idx(rule_id, detail_split_file_id, match_status, match_result_id)`
- 删除被 `bd_order_rec_item_idx(order_file_id, match_status, match_result_id, rule_item_id)` 左前缀覆盖的 `bd_order_pending_split_idx`。
- 删除当前前端搜索未使用的 `bd_account_idx(matched_account_name)`。
- 关键认账索引继续保留：`bd_order_rec_item_idx`、`bd_partition_rec_status_idx`、`bd_rule_detail_split_status_idx`。

## 数据库迁移

- 本版包含两个新增迁移：
  - `migrate-v10.24-drop-bd-order-pending-split-idx.sql`
  - `migrate-v10.25-drop-bd-account-idx.sql`
- 本地沙盒库已执行两个迁移，并确认被删除索引不存在、关键认账索引仍存在。
- 如果目标环境尚未部署 v10.23，需要先按 v10.23 文档补齐历史迁移。

## 本地验证

- `npm run check` 通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- `releases/finance-platform-v10.25-local.tar.gz` 已生成并通过内容检查。
