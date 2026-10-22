# v9.38.1-local 版本快照

## 订单明细包菜单

- 左侧菜单 `订单明细` 改名为 `订单明细包`。
- `/order-files` 页面标题同步改为 `订单明细包`。
- 修复订单明细包列表查询：
  - 列表查询从 `recognition_tasks` 内关联调整为左关联，避免个别文件任务关联异常时整页不显示。
  - 排序改为按展示日期和最新上传时间排序，避免生产 MySQL 严格分组模式下因 `ORDER BY recognition_tasks.bill_date` 导致列表接口失败。
  - T+1 数据包展示日期增加回退值：任务日期缺失时回退 `order_files.upload_date` 或文件创建日期。

## 数据库

- 本版本无数据库迁移。
- 仍需确保线上已执行 v9.33 至 v9.37 的历史迁移。

## 验证

- `npm run check` 通过。
- `npm run build` 通过。

