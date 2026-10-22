# v9.35.0-local 版本快照

## 时间

- 2026-05-20

## 本版状态

- 已执行并通过：`npm run check`。
- 已执行并通过：`npm run build`。
- 数据库迁移脚本已新增：`migrate-v9.35-budget-code-associated-nc-projects.sql`。
- 已更新技能文档：`docs/finance-recon-SKILL.md`。
- 已生成部署包：`releases/finance-platform-v9.35.0-local.tar.gz`。

## 重要前提

- 线上如果尚未执行 v9.33 和 v9.34 迁移，必须先按顺序补齐：
  1. `migrate-v9.33-match-result-display-snapshot.sql`
  2. `migrate-v9.34-recognition-date-summaries.sql`
  3. `migrate-v9.35-budget-code-associated-nc-projects.sql`
- 字段已存在时不要重复执行迁移；先用 `SHOW COLUMNS` 检查。

## 主要更新

### 预算编码关联 NC项目

- `budget_codes` 新增 `associated_income_projects` JSON 字段。
- 预算编码管理中，编辑已有 NC项目时可添加关联 NC项目；新建 NC项目时不允许关联。
- 同一个 NC项目可追加多个关联 NC项目，每次操作添加一个。
- 预算编码树搜索支持命中关联 NC项目。

### 分账选择联动

- 新增/编辑明细认账规则、到账认账规则、手动认账、日期汇总页手动认账中，选择预算编码后，NC项目名称限定为主 NC项目和关联 NC项目。
- 平台项目名称、平台项目详情继续按当前选中的 NC项目和现有公益平台规则筛选。
- 手动认账入口补齐平台项目详情选择，保存到 `match_results.platform_project_detail`。

## 修改文件

- `api/budgetCodeRouter.ts`
- `db/schema.ts`
- `src/components/TreeSelects.tsx`
- `src/pages/BudgetCodePage.tsx`
- `src/pages/IncomeRecognitionPage.tsx`
- `src/pages/ManualRecognitionPage.tsx`
- `src/pages/RuleCreatePage.tsx`
- `src/pages/TaskDetailPage.tsx`
- `migrate-v9.35-budget-code-associated-nc-projects.sql`
- `docs/finance-recon-SKILL.md`
- `docs/VERSION_SNAPSHOT_v9.35.0-local.md`
- `docs/DEPLOY_v9.35.0-local.md`

## 数据库变化

新增 v9.35 迁移：

- `budget_codes.associated_income_projects`

## 验证

已执行：

```bash
npm run check
npm run build
```

本地迁移：

```bash
mysql -u finance_sandbox -p finance_recon_sandbox < migrate-v9.35-budget-code-associated-nc-projects.sql
```
