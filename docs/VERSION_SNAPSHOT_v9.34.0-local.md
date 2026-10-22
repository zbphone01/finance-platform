# v9.34.0-local 版本快照

## 时间

- 2026-05-19

## 本版状态

- 已执行并通过：`npm run check`。
- 已执行并通过：`npm run build`。
- 数据库迁移脚本已新增：`migrate-v9.33-match-result-display-snapshot.sql`、`migrate-v9.34-recognition-date-summaries.sql`。
- 已更新技能文档：`docs/finance-recon-SKILL.md`。
- 已生成部署包：`releases/finance-platform-v9.34.0-local.tar.gz`。

## 重要前提

- 线上环境当前尚未升级 v9.33，也尚未执行 v9.33 及后续数据库迁移。
- 部署 v9.34 前必须先执行 v9.33 迁移，再执行 v9.34 迁移。

## 主要更新

### v9.33 入账结果展示快照

- `match_results` 新增平台项目展示名和银行流水快照字段，入账结果页不再按行补查 `bank_flows`。
- 生成到账认账、明细认账、手动认账结果时统一写入银行流水展示快照。
- 入账结果页继续按 `entry_time`、预算编码和制单状态查询，并直接展示快照字段。

### v9.34 认账及分账性能优化

- 新增 `recognition_date_summaries` 日期汇总表。
- `认账及分账` 列表改为直接读取日期汇总表，不再打开页面时实时扫描大明细。
- `查看日期汇总` 顶部汇总改为读取日期汇总表。
- 银行流水列表去掉大明细实时汇总，改用任务状态和流水认账状态判断展示状态。
- 订单明细 tab 默认只展示汇总信息，点击 `查看具体明细` 后才读取明细分页数据。
- 上传明细、认账、删除、忽略、转移等写路径会刷新对应日期汇总。

## 修改文件

- `api/incomeRuleRouter.ts`
- `api/lib/matchResultSnapshot.ts`
- `api/lib/orderUploadStream.ts`
- `api/lib/recognitionDateSummary.ts`
- `api/orderFileRouter.ts`
- `api/resultRouter.ts`
- `api/taskRouter.ts`
- `db/schema.ts`
- `src/pages/ResultsPage.tsx`
- `src/pages/TaskDetailPage.tsx`
- `src/components/Layout.tsx`
- `src/providers/trpc.tsx`
- `migrate-v9.33-match-result-display-snapshot.sql`
- `migrate-v9.34-recognition-date-summaries.sql`
- `docs/finance-recon-SKILL.md`
- `docs/VERSION_SNAPSHOT_v9.34.0-local.md`
- `docs/DEPLOY_v9.34.0-local.md`

## 数据库变化

新增 v9.33 迁移：

- `match_results.platform_project_display_name`
- `match_results.bank_reference_no`
- `match_results.bank_transaction_time`
- `match_results.bank_income`
- `match_results.bank_counterparty_account`
- `match_results.bank_counterparty_name`
- `match_results.bank_counterparty_bank`
- `match_results.bank_summary`
- `match_results.bank_purpose`
- `match_results.bank_post_script`
- `mr_entry_time_id_idx`
- `mr_entry_time_budget_idx`
- `mr_entry_time_voucher_idx`

新增 v9.34 迁移：

- `recognition_date_summaries`

部署前必须按顺序执行：

1. `migrate-v9.33-match-result-display-snapshot.sql`
2. `migrate-v9.34-recognition-date-summaries.sql`

## 验证

已执行：

```bash
npm run check
npm run build
```

本地数据库迁移说明：

- Codex 曾尝试连接本机 MySQL，但当前环境无法连接 `127.0.0.1:3306`，未由 Codex 完成本地数据库迁移。
- 本地使用前请手动按顺序执行 v9.33 和 v9.34 迁移并检查字段/汇总表。
