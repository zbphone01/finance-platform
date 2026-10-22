# v9.36.0-local 版本快照

## 时间

- 2026-05-20

## 本版状态

- 已执行并通过：`npm run check`。
- 已执行并通过：`npm run build`。
- 数据库迁移脚本已新增：`migrate-v9.36-order-file-list-indexes.sql`。
- 已更新技能文档：`docs/finance-recon-SKILL.md`。
- 已生成部署包：`releases/finance-platform-v9.36.0-local.tar.gz`。

## 重要前提

- 线上如果尚未执行 v9.33 到 v9.35 迁移，必须先按顺序补齐：
  1. `migrate-v9.33-match-result-display-snapshot.sql`
  2. `migrate-v9.34-recognition-date-summaries.sql`
  3. `migrate-v9.35-budget-code-associated-nc-projects.sql`
  4. `migrate-v9.36-order-file-list-indexes.sql`
- 索引已存在时不要重复执行迁移；先用 `SHOW INDEX` 检查。

## 主要更新

### 订单明细数据包列表性能优化

- `orderFile.list` 不再从 `bill_details` 明细大表实时聚合数据包列表。
- 数据包列表改为基于 `order_files` 上传处理后的汇总字段展示条目数、已匹配数、未匹配数和上传状态。
- 通过 `recognition_tasks.bill_date - 1` 还原订单真实日期，保持列表展示口径不变。
- 大量明细包或单包明细量很大时，打开 `订单明细` 菜单不再随 `bill_details` 行数线性变慢。

### 数据库索引

- `recognition_tasks` 新增 `(bill_date, rule_id)` 复合索引。
- `order_files` 新增 `(task_id, rule_id, created_at)` 复合索引。

## 修改文件

- `api/orderFileRouter.ts`
- `db/schema.ts`
- `migrate-v9.36-order-file-list-indexes.sql`
- `docs/finance-recon-SKILL.md`
- `docs/VERSION_SNAPSHOT_v9.36.0-local.md`
- `docs/DEPLOY_v9.36.0-local.md`

## 数据库变化

新增 v9.36 迁移：

- `recognition_tasks.rt_date_rule_idx`
- `order_files.of_task_rule_created_idx`

## 验证

已执行：

```bash
npm run check
npm run build
```

本地迁移：

```bash
mysql -h 127.0.0.1 -u finance_sandbox -p finance_recon_sandbox < migrate-v9.36-order-file-list-indexes.sql
```
