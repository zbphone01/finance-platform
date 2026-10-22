# v10.27-local 版本快照

## 发布范围

- 本版聚焦订单明细大表分区自动维护和 60 天热数据归档。
- 右上角系统版本号更新为 `v10.27`。
- 部署包：`releases/finance-platform-v10.27-local.tar.gz`。
- 推荐继续使用 `deploy-update-optimized.sh` 部署。

## 订单明细分区

- 新增 MySQL Event Scheduler 自动维护未来日分区：
  - `ensure_bill_details_next_month_partitions`
  - `ev_bill_details_next_month_partitions`
- 每月 5 日 02:30 自动补齐到下个月月底之后一天的 `bill_details` 日分区。
- 迁移执行时会先补齐一次，避免已经错过本月执行日。

## 订单明细归档

- 新增月归档表策略：
  - 热表 `bill_details` 保留近 60 天日分区数据。
  - 冷数据写入 `bill_details_archive_YYYYMM`，每月一张表，表内按日分区。
  - `bill_detail_archive_runs` 记录每日归档状态、数量、金额和错误信息。
- 新增每日归档任务：
  - `ensure_bill_details_archive_month_table`
  - `ensure_bill_details_archive_tables_around`
  - `archive_bill_details_day`
  - `archive_bill_details_daily`
  - `ev_bill_details_archive_old_daily_partitions`
- 每日 03:10 归档 `CURDATE() - INTERVAL 60 DAY` 的热表日分区；归档前自动确保目标日期前一月、当月、后一月 3 张月归档表存在。

## 后端查询

- 新增 `api/lib/billDetailArchiveRead.ts`，按 `bill_detail_archive_runs.completed` 状态自动判断读取热表或对应月归档表。
- 日期汇总页订单明细查询 `task.getDetails` 支持热表/归档表自动路由。
- 订单明细包详情 `orderFile.getDetails` 在按日期包范围查看时支持热表/归档表自动路由。

## 数据库迁移

- 本版包含两个新增迁移：
  - `migrate-v10.26-order-detail-auto-partitions.sql`
  - `migrate-v10.27-order-detail-monthly-archives.sql`
- 两个迁移均依赖 MySQL Event Scheduler；部署前需要确认 `event_scheduler=ON`。
- 如果目标环境尚未部署 v10.25，需要先按 v10.25 文档补齐历史迁移。

## 本地验证

- `npm run check` 通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- `npm test -- api/lib/orderUploadStream.test.ts` 通过。
- v10.26、v10.27 迁移均已用临时 MySQL 测试库验证关键过程。
- `releases/finance-platform-v10.27-local.tar.gz` 已生成并通过内容检查。
