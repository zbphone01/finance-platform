# v10.30-local 版本快照

## 发布范围

- 本版聚焦订单明细包大数据读取和大包上传稳定性。
- 右上角系统版本号更新为 `v10.30`。
- 部署包：`releases/finance-platform-v10.30-local.tar.gz`。
- 推荐继续使用 `deploy-update-optimized.sh` 部署。

## 订单明细包性能

- 新增 `order_file_partitions` 文件级分区定位表，用 `order_file_id + partition_date` 聚合记录订单包明细分区，订单明细包详情不再依赖明细级 locator。
- 订单明细包详情、包范围读取、删除、转移和取消转移改为维护/读取文件级分区定位，减少大包和归档表场景下的定位数据量。
- 保留旧 `bill_detail_locator` 的数据迁移回滚余地，但业务代码不再读写该表。

## 大包入库稳定性

- 新增进程内数据库重任务队列，订单明细大包入库和自动认账执行共用串行限流，避免同时压 `bill_details`、`match_results` 和 MySQL IO。
- 分片上传完成后，订单明细导入进入队列等待，前端可看到“等待服务器排队”进度文案。
- 原有认账队列保留任务合并逻辑，实际执行前进入数据库重任务队列。

## 数据库迁移

- 本版新增迁移：`migrate-v10.30-order-file-partitions.sql`。
- 已部署 `v10.29` 的环境执行本迁移后再部署 v10.30 代码包。
- 如果目标环境尚未部署 v10.29，需要先补齐 v10.26、v10.27、v10.28、v10.29 历史迁移。

## 本地验证

- `npm run check` 通过。
- `npm test -- api/lib/orderUploadStream.test.ts` 通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- `releases/finance-platform-v10.30-local.tar.gz` 已生成并通过内容检查。
