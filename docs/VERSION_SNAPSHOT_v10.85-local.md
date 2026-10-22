# v10.85-local 版本快照

## 发布范围

- 本版本从上一实际部署包 `v10.84-local` 升级。
- 明细认账菜单中的“编辑认账规则”页面，已有认账归属条件按原编号从大到小展示。
- 编辑页只保留条件列表上方的“添加条件”，去掉底部重复入口。
- 点击上部“添加条件”后，新条件继续取当前最大编号加 1，并显示在条件列表最上方。
- 页面只反转编辑状态下的展示顺序，条件数组、草稿延迟保存、校验索引、保存 `sort_order` 和认账匹配逻辑不变；新建规则页保持原有交互。

## 数据库、依赖与配置

- 本版无 SQL 迁移，不新增或修改表、字段、索引、外键和数据。
- `scripts/check-v10.85-rule-condition-editor-database.mjs` 只读验证 v10.84 所需的数据库完成态；不接受迁移动作，不执行写 SQL。
- 不新增 npm 依赖、环境变量、端口或 PM2 配置。

## 验证要求

- `npm run check`、`npm test`、`npm run build` 和 `git diff --check` 必须通过。
- 本次发布包仍包含 v10.84 上传规则批量认账改动，因此额外运行 `npm test -- api/lib/orderUploadStream.test.ts` 和 `npm test -- api/lib/uploadedIncomeRecognition.test.ts`。
- `node --test scripts/runtime-lock-fingerprint.test.mjs scripts/deploy-database-control.test.mjs` 与 `bash -n deploy-update-optimized.sh` 必须通过。
- 发布包必须包含非空预构建 `dist/`、v10.85 只读数据库检查器及当前工作区完整源码，不包含 v10.85 迁移 SQL、环境文件、依赖目录、Git、发布目录、缓存或本地数据库备份。

## 风险与回退

- 条件卡片的展示顺序与底层数组顺序不同；所有编辑、删除、分账、错误定位和新增后滚动都必须继续使用原条件索引，避免操作到相邻条件。
- 部署回退时恢复 v10.84 应用产物即可，无数据库回迁。
