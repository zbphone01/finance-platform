# v9.28.0-local 版本快照

## 时间

- 2026-05-16

## 本版状态

- 本地上传、认账分账、入账流程测试通过。
- 已执行并通过：`npm run check`、`npm run build`。
- 已更新技能文档：`docs/finance-recon-SKILL.md`。
- 已生成部署包：`releases/finance-platform-v9.28.0-local.tar.gz`。

## 主要更新

### T+1 明细认账

- 订单明细菜单继续按订单真实日期展示数据包。
- 认账及分账日期汇总按 T+1 使用订单明细：`订单真实日期 + 1 = 银行到账日期`。
- 日期汇总订单明细列表增加订单日期列，展示真实订单日期。
- 入账结果的入账时间取银行流水日期。
- 修复日期计算时区问题，避免中国时区下 `2026-05-10 - 1` 错算为 `2026-05-08`。

### 订单明细入库和查重

- 订单号必填。
- 订单入库查重按 `明细认账规则 + 真实订单日期 + 订单号` 执行。
- 发现重复订单时放弃该条待入库订单，不中止整次上传。
- 增加 `bill_details.rule_id` 并建立 `rule_id + bill_date + bill_no` 唯一索引，提高查重可靠性。

### 增量补认账

- 已认账的订单明细不重复处理。
- 新上传或仍未入账的订单明细继续补认账。
- 金额校验使用 `未认账订单明细金额` 对比 `银行流水总额 - 已认账明细金额`。
- 本轮认账后按累计结果重算任务状态、已认账数量、未认账数量和银行流水状态。

### 明细忽略和转移

- 日期汇总订单明细支持未认账明细操作：暂时忽略、转移日期。
- 已忽略和已转移均可取消。
- 忽略的订单不参与认账和差异金额计算。
- 转移后的订单进入目标日期数据包参与认账。

### 订单明细数据包删除

- 订单明细菜单增加删除操作。
- 删除范围是当前数据包：`订单日期 + 明细认账规则`。
- 不会删除同一上传文件中属于其他数据包的订单。
- 删除后同步删除相关入账结果，刷新上传文件统计、认账任务状态和银行流水状态。

### 日期汇总和列表展示

- 日期汇总差异金额按当天明细认账任务订单总额与银行流水差计算，避免重复计算。
- 银行流水列表展示差异大和部分认账状态。
- 订单明细列表增加订单金额搜索。
- 状态列固定右侧，列宽和表头顺序已调整。

## 修改文件

- `api/lib/orderUploadStream.ts`
- `api/orderFileRouter.ts`
- `api/taskRouter.ts`
- `db/schema.ts`
- `src/pages/OrderFilesPage.tsx`
- `src/pages/TaskDetailPage.tsx`
- `docs/finance-recon-SKILL.md`
- `migrate-v9.27-bill-details-rule-dedupe.sql`
- `migrate-v9.28-bill-detail-operations.sql`

## 数据库变化

新增迁移：

- `migrate-v9.27-bill-details-rule-dedupe.sql`
  - `bill_details.rule_id`
  - 历史数据回填规则 ID
  - 创建 `bd_rule_date_bill_no_uq` 唯一索引
- `migrate-v9.28-bill-detail-operations.sql`
  - `bill_details.operation_status`
  - `bill_details.original_task_id`
  - 对应索引

## 验证

已执行：

```bash
npm run check
npm run build
```

本地业务验证：

- 上传订单明细按订单真实日期入库。
- 日期汇总按 T+1 展示和认账。
- 银行流水金额等于 T+1 订单数据包金额时不再误判差异大。
- 部分认账状态可正确展示。
- 增量上传只补认账新增未认账明细。
- 订单明细数据包删除后可同步刷新入账结果和认账任务状态。
