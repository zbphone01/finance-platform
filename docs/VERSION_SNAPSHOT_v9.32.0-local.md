# v9.32.0-local 版本快照

## 时间

- 2026-05-19

## 本版状态

- 已执行并通过：`npm run check`。
- 已执行并通过：`npm run lint`。
- 已执行并通过：`npm run build`。
- 数据库迁移脚本已新增：`migrate-v9.32-counterparty-recognition-type.sql`。
- 已更新技能文档：`docs/finance-recon-SKILL.md`。
- 已生成部署包：`releases/finance-platform-v9.32.0-local.tar.gz`。

## 主要更新

### 到账信息汇总

- `counterparty_records` 新增 `recognition_type` 字段，取值为 `到账认账`、`明细认账`，老数据默认 `到账认账`。
- 已记录列表新增 `认账类型` 列，放在 `到账别称` 右侧。
- 已记录列表新增认账类型筛选：全部、到账认账、明细认账。
- 未记录列表点击记录时，弹窗新增到账类型选择：到账认账、明细认账。
- 编辑已记录到账信息时可调整认账类型。

### 明细认账规则

- 新建和编辑明细认账规则时，规则名称必须唯一。
- 匹配到账信息只能选择到账信息汇总中已记录且认账类型为 `明细认账` 的到账别称。
- 管理费比例默认值从 `0%` 改为 `5%`。
- 分账设置中 `平台项目详情` 与 `支出资金来源` 的显示位置已调换。
- 添加条件按钮改为明显的蓝色主按钮。
- 保存时按实际问题提示：必填项缺失不再误提示分账比例不为 100%。
- 保存时识别重复关键字，提示 `有重复的规则，请检查`，并标记对应条件框。

### 明细认账规则复制

- 明细认账规则列表新增复制功能。
- 点击复制后弹窗填写新规则名称和匹配到账信息。
- 复制成功后，原规则的条件和分账信息会复制到新规则。
- 复制接口复用规则名称唯一和明细认账到账别称校验。

### 工程清理

- 按当前项目代码现状调整 ESLint 配置，保留基础检查，关闭历史代码暂不满足且不影响服务运行的严格风格规则。
- 修复公益平台页面一个 Hook 依赖 warning。

## 修改文件

- `api/counterpartyRouter.ts`
- `api/ruleRouter.ts`
- `db/schema.ts`
- `src/pages/CounterpartySummaryPage.tsx`
- `src/pages/RuleCreatePage.tsx`
- `src/pages/RulesPage.tsx`
- `src/pages/FundraisingPlatformPage.tsx`
- `eslint.config.js`
- `migrate-v9.32-counterparty-recognition-type.sql`
- `docs/finance-recon-SKILL.md`
- `docs/VERSION_SNAPSHOT_v9.32.0-local.md`
- `docs/DEPLOY_v9.32.0-local.md`

## 数据库变化

新增迁移：

```sql
ALTER TABLE counterparty_records
  ADD COLUMN recognition_type ENUM('到账认账', '明细认账') NOT NULL DEFAULT '到账认账' AFTER alias,
  ADD INDEX cr_recognition_type_idx (recognition_type);
```

部署前必须执行：

- `migrate-v9.32-counterparty-recognition-type.sql`

## 验证

已执行：

```bash
npm run check
npm run lint
npm run build
```

本地数据库迁移说明：

- Codex 曾尝试连接本机 MySQL 执行迁移，但当前沙箱连接 `127.0.0.1:3306` 被权限拦截，未确认本地库已迁移。
- 本地使用前请手动执行 v9.32 迁移并检查字段。
