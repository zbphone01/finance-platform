# v9.89-local 版本快照

## 发布范围

- 本版用于优化支付宝 T+1 大订单明细包的认账执行性能。
- 新增数据库索引迁移：`migrate-v9.89-alipay-t1-recognition-index.sql`。
- 部署包：`releases/finance-platform-v9.89-local.tar.gz`。
- 推荐继续使用 `deploy-update-optimized.sh` 部署。

## 认账执行性能

- `bill_details` 新增复合索引 `bd_order_rec_item_idx`：
  - `order_file_id`
  - `match_status`
  - `match_result_id`
  - `rule_item_id`
- 该索引用于优化支付宝 T+1 这类单个订单明细包数据量很大的认账场景。
- 典型查询会按订单明细包、匹配状态、是否已生成入账结果、规则项定位明细，减少在同一大包内按规则项反复扫描的磁盘读写。

## 本地验证

- 已在本地沙盒库执行 `migrate-v9.89-alipay-t1-recognition-index.sql`。
- 以 2026-06-09 支付宝 T+1 订单明细包验证，核心查询已命中 `bd_order_rec_item_idx`。
- `npm run check` 通过。
- `npm run build` 通过。
- 发布包完整性检查通过。
