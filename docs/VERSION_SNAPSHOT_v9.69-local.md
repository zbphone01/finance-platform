# v9.69-local 版本快照

## 发布范围

- 本版用于替代 v9.65-local 包，修复明细分账拆分认账后的来源订单状态、订单明细包和日期汇总快照口径、明细分账包复用回滚，以及相关列表展示。
- 部署包：`releases/finance-platform-v9.69-local.tar.gz`。
- 推荐继续使用 `deploy-update-optimized.sh` 部署。

## 明细分账

- 明细分账开始拆分认账后，列表显示“认账执行中”，并禁用上传、搜索、查看、筛选、删除和重复开始拆分等操作。
- 明细分账详情页按上传配置字段展示：订单日期、明细匹配字段、认账条件字段、收入字段和状态；分账包没有订单日期时显示 `-`。
- 明细分账详情表头使用实际字段名两行展示，例如 `主订单编号（明细匹配字段）`。
- 明细分账上传时保留明细匹配字段、认账条件字段和收入字段的实际值，收入字段保留原始单元格内容。
- 删除带明细分账的订单明细包时，会释放已绑定的分账子明细，后续重新上传待拆分订单包后可复用原分账包继续拆分认账。

## 订单明细包

- 明细分账完成后，来源订单明细状态显示为“已拆分”或“已认账”，不再误显示为“已忽略”。
- 订单明细包列表“条目数”改为“详情”，分两行展示条数和金额。
- 列表详情金额读取 `order_files` 快照字段，不实时汇总 `bill_details`。
- “已完成”文案改为“入库完成”，避免与认账完成混淆。
- “来自文件”和“上传信息”列改为小号字体。

## 认账及分账

- 日期汇总顶部“差异金额”文案改为“订单异常金额”。
- 日期汇总顶部订单明细条数和金额只统计来源订单明细，不再把明细分账子明细计入汇总。
- 日期汇总订单明细列表排除分账子明细，保留来源订单原订单号。
- 日期汇总订单明细状态筛选改为下拉筛选。

## 数据库迁移

- 本版包含 v9.64、v9.65 结构迁移，以及 v9.66-v9.69 快照/历史数据修复迁移：
  - `migrate-v9.64-detail-split-entry-recognition.sql`
  - `migrate-v9.65-detail-split-status-snapshot.sql`
  - `migrate-v9.66-detail-split-order-source-status.sql`
  - `migrate-v9.67-detail-split-source-recognized-status.sql`
  - `migrate-v9.68-release-orphan-detail-split-links.sql`
  - `migrate-v9.69-source-detail-summary-cache.sql`
- v9.69 迁移会按来源订单明细口径重算认账任务和日期汇总快照，修复明细分账后日期汇总订单明细条数偏大的历史数据。

## 验证

- `npm run check` 通过。
- `npm run build` 通过。
- `npm test -- api/lib/orderUploadStream.test.ts` 通过。
- `git diff --check` 通过。
