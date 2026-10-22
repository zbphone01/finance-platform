# v10.28-local 版本快照

## 发布范围

- 本版聚焦订单明细表字段瘦身，删除已不再使用或可从其他字段读取的冗余列。
- 右上角系统版本号更新为 `v10.28`。
- 部署包：`releases/finance-platform-v10.28-local.tar.gz`。
- 推荐继续使用 `deploy-update-optimized.sh` 部署。

## 订单明细字段瘦身

- `bill_details` 和已有 `bill_details_archive_YYYYMM` 归档表删除以下冗余字段：
  - `order_date`
  - `recognition_date`
  - `amount`
  - `quantity`
  - `unit_price`
  - `tax_amount`
  - `counterparty`
  - `category`
  - `matched_account_name`
- `bill_detail_locator` 删除 `recognition_date`。
- 订单原始日期统一使用 `bill_date`。
- 认账/到账归属日期和分区日期统一使用 `partition_date`。
- 订单明细金额只维护 `total_amount`。
- 上传原始字段继续保存在 `raw_data`；订单包匹配账户快照仍保留在 `order_files.matched_account_name`。

## 索引调整

- 删除依赖旧字段的索引：
  - `bd_rule_order_date_bill_no_idx`
  - `bd_recognition_date_idx`
  - `bd_partition_rec_status_idx`
  - `bd_operation_recognition_idx`
  - `bd_amount_idx`
  - `bdl_recognition_lifecycle_idx`
- 新增或保留新口径索引：
  - `bd_partition_status_idx(partition_date, rule_id, operation_status, match_status)`
  - `bd_operation_partition_idx(operation_status, partition_date, id)`
  - `bdl_partition_lifecycle_idx(partition_date, lifecycle_status)`

## 后端调整

- 订单明细上传、明细分账上传和旧上传路径不再写入已删除字段。
- 使用 `recognition_date` 的订单明细处理路径统一改为 `partition_date`。
- 订单明细金额筛选、差额查找、忽略明细汇总和归档读取统一使用 `total_amount`。
- 对前端仍返回 `amount` 兼容属性的接口，值由 `total_amount` 派生。
- 订单明细包详情按 `order_file_id` 直接打开时，通过 `bill_detail_locator.partition_date` 路由到热表或月归档表，修复已归档订单包详情为空的问题。

## 数据库迁移

- 本版新增迁移：`migrate-v10.28-drop-bill-details-redundant-columns.sql`。
- 已部署 `v10.27` 的环境执行本迁移后再部署 v10.28 代码包。
- 如果目标环境尚未部署 v10.27，需要先补齐 v10.26、v10.27 历史迁移。
- 本地 `finance_recon_sandbox` 已执行 v10.28 迁移，并复查热表、归档表和定位表的冗余字段已删除。
- 本地已验证 2026-05-09 财付通 4601 腾讯公益订单包明细仍在 `bill_details_archive_202605`，修复后应通过 locator 归档路由读取。

## 本地验证

- `npm run check` 通过。
- `npm test -- api/lib/orderUploadStream.test.ts` 通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- `releases/finance-platform-v10.28-local.tar.gz` 已生成并通过内容检查。
