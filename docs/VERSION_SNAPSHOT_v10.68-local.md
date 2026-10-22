# v10.68-local 版本快照

## 发布范围

- 本版本从 `v10.67-local` 升级，完成认账平台对旧票据订单索引方案的代码清理。
- 删除 Drizzle 模型中 `invoice_order_index_jobs` 的表声明及其类型导出，认账平台不再把旧任务表视为当前系统结构的一部分。
- 已认账订单投影继续使用 `invoice_recognized_projection_jobs`：上传时固化字段快照，认账状态变化后递增代次并由票据平台低优先级分批写入一行一订单窄表。
- 本版本不删除数据库中的 `invoice_order_index_jobs` 或 `invoice_order_identifiers`，也不包含删除旧表的 SQL；旧表清理由票据平台后续版本在两个系统均完成兼容清理并核验新投影后独立执行。
- 页面右上角版本号更新为 `v10.68`。
- 部署包为 `releases/finance-platform-v10.68-local.tar.gz`，包含本次验证生成的预构建 `dist/`。

## 数据库、依赖与配置

- 本版本没有认账平台数据库迁移，不执行 SQL，不使用 `drizzle schema push`。
- 不修改 `bill_details`、订单文件、认账结果、新投影任务或已认账订单窄表的数据和索引。
- 不新增 npm 依赖、环境变量或运行配置。
- 现存旧索引表继续留在数据库不会影响 v10.68 运行；是否删除由票据平台对应版本的迁移条件决定。

## 验证结果

- `npm run check`、`npm test`、`npm run build` 和 `git diff --check` 均通过。
- 构建生成非空 `dist/boot.js`、`dist/public/index.html` 和前端资源。
- 认账平台运行时代码和 Drizzle 当前模型不再引用 `invoice_order_index_jobs` 或 `invoice_order_identifiers`。
- 发布包必需构建产物、当前版本文档和禁止内容已按仓库发版规则复核。

## 风险与回退

- v10.68 本身不删除任何数据库表，单独部署认账平台不会使仍在运行的旧票据版本立即失去旧表。
- 后续一旦票据平台迁移删除旧表，回退到仍依赖旧表的历史票据版本前必须先按票据平台备份与回退方案恢复兼容结构；该风险不由本认账平台发布包自动处理。
- 回退认账平台时可直接重新部署 `v10.67-local` 发布包，不执行数据库回退 SQL；现有 `invoice_recognized_projection_jobs` 和投影数据继续保留。

