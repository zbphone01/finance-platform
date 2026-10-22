# v10.13-local 版本快照

## 发布范围

- 本版用于订单明细大表分区改造，并恢复打包明细上传时可选的到账日期。
- 右上角系统版本号更新为 `v10.13`。
- 部署包：`releases/finance-platform-v10.13-local.tar.gz`。
- 推荐继续使用 `deploy-update-optimized.sh` 部署。

## 订单明细分区

- `bill_details` 新增日期语义字段：
  - `order_date`：订单原始日期。
  - `recognition_date`：认账/到账归属日期。
  - `partition_date`：数据库分区日期。
  - `lifecycle_status`：`normal / unmatched_package / archived`。
  - `original_recognition_date`：转移日期取消时恢复使用。
- 新增 `bill_detail_locator`，用于全局订单明细 ID 到分区日期的定位。
- `bill_details` 改为按 `partition_date` 分区：
  - `p_unmatched`：未匹配打包明细和分账暂存明细。
  - 最近 90 天按日分区。
  - 90 天前历史数据按自然月分区。
  - `p_future` 兜底未来日期。
- 上传、忽略、取消忽略、转移、取消转移、打包明细补匹配和明细分账绑定会同步维护 locator。

## 打包明细上传

- `认账及分账 / 上传订单明细` 中，明细认账规则为 `打包明细` 时恢复 `到账日期` 选填项。
- 不填写到账日期时，继续自动匹配符合到账信息的最早未认账银行流水。
- 填写到账日期时，只在指定日期查找到账；找不到时不会自动绑定其他日期。

## 数据库迁移

- 从 v10.12 升级到 v10.13 需要执行：
  - `migrate-v10.13-order-detail-partitioning.sql`
- 该脚本会重建 `bill_details` 大表，必须维护窗口执行，并建议先在测试库预演。
- 本地库已清空业务数据后执行该迁移并复查通过。

## 本地验证

- `npm run check` 通过。
- `npm run build` 通过。
- `npm test -- api/lib/orderUploadStream.test.ts` 通过。
- `git diff --check` 通过。
- `releases/finance-platform-v10.13-local.tar.gz` 已生成并通过内容检查。
