# v9.29.0-local 版本快照

## 时间

- 2026-05-16

## 本版状态

- 本地测试通过。
- 已执行并通过：`npm run check`、`npm run build`。
- 已更新技能文档：`docs/finance-recon-SKILL.md`。
- 已生成部署包：`releases/finance-platform-v9.29.0-local.tar.gz`。

## 主要更新

### 开始认账入口

- 认账及分账日期汇总操作列合并为一个“开始认账”按钮。
- 手动开始认账按业务顺序执行：先执行当天银行流水的到账认账，再把有订单明细的流水任务加入明细认账队列。
- “已完成认账”的日期仍可点击“开始认账”，用于上传新增明细或新增规则后补认账。

### 最新规则补认账

- 明细认账执行前会按当前最新明细认账规则重新识别未入账明细。
- 新增规则条件后，不需要重新上传订单明细，也不需要先点击“同步认账字段”；点击“开始认账”即可对历史未认账明细补认账。
- 已生成入账结果的明细不会被重新匹配，避免覆盖已认账结果。

### 同步认账字段

- 认账规则下的“规则更新”子菜单改名为“同步认账字段”。
- 页面标题、按钮、提示、弹窗、空状态和表头统一使用“同步”文案。
- “同步认账字段”仅用于同步分账字段中的预算编码、平台项目名称、支出资金来源等基础资料，不是认账规则生效开关。

### 入账结果制单保护

- 保留 v9.29 数据库迁移：`match_results.voucher_status`。
- 删除认账任务、订单明细数据包等操作会阻止删除已有入账制单的数据。

## 修改文件

- `api/taskRouter.ts`
- `src/pages/RecognitionPage.tsx`
- `src/components/Layout.tsx`
- `src/pages/RuleUpdatePage.tsx`
- `docs/finance-recon-SKILL.md`
- `README.md`
- `deploy-update-optimized.sh`
- `migrate-v9.29-match-result-voucher-status.sql`

## 数据库变化

本版包含 v9.29 迁移：

- `migrate-v9.29-match-result-voucher-status.sql`
  - `match_results.voucher_status`
  - `mr_voucher_status_idx`

如果线上已经执行过该迁移，不要重复执行；可先用部署说明里的检查 SQL 确认字段是否存在。

## 验证

已执行：

```bash
npm run check
npm run build
```

本地业务验证：

- 新增明细认账规则条件后，点击“开始认账”可使用最新规则补认账历史未认账明细。
- “开始认账”按先到账认账、后明细认账的顺序执行。
- “同步认账字段”菜单文案和页面文案展示正确。
