# v10.77-local 版本快照

## 发布范围

- 本版本从上一实际部署包 `v10.73-local` 累计升级，合并 v10.74 至 v10.77 的全部代码和数据库变更。
- 明细认账规则的排除订单支持多组“识别字段 + 等于/包含 + 关键字”；退款订单保持单一判断字段，判断值支持 1 至 3 个精确值，首值同步保留到旧字段供回退兼容。
- 订单上传按有限批次执行排除、退款和认账预匹配；退款和收入共用规则条件查找与汇总，不认账规则继续支持日期字段留空、由时间字段直接提供完整日期时间。
- 日期汇总的银行流水支持在同一行右侧切换收入和支出，服务端按金额方向分别分页和计数。
- 正数流水继续参与到账、手动和明细认账；负数支出流水只读查看，不再新增认账、取消认账或制单。支出列表走轻量分页分支，操作列只保留可用操作并自适应宽度。
- 日期汇总顶部使用“银行流水收入总额”口径，流水条数同样只统计正数收入。银行流水状态由认账、取消、删除和任务收尾等写路径维护，列表打开和轻量轮询只读持久化状态。
- `recognition_date_summaries` 新增收入总额和已认账收入流水条数缓存。`task.getById` 不再因打开详情而刷新汇总或实时聚合 `bank_flows`。
- 页面右上角版本号更新为 `v10.77`，部署包为 `releases/finance-platform-v10.77-local.tar.gz`，包含本轮生成的预构建 `dist/`。

## 数据库、依赖与配置

- 从 `v10.73-local` 升级必须按顺序执行：`migrate-v10.74-rule-exclude-conditions.sql`、`migrate-v10.75-bank-flow-income-expense-view.sql`、`migrate-v10.76-refund-judge-values.sql`、`migrate-v10.77-recognized-bank-flow-count-cache.sql`。
- v10.74 新增 `recognition_rule_exclude_conditions`，保留 `recognition_rules.exclude_order_*` 旧字段和第一组兼容快照。
- v10.75 新增 `recognition_date_summaries.bank_flow_income_total`，回填正数收入总额，并把既有 `bank_flow_count` 回填为正数收入条数；把仍为待认账的纯支出任务改为完成，按“支出不参与认账”口径刷新日期状态。该迁移不删除历史支出认账结果或凭证。
- v10.76 新增 `recognition_rules.refund_judge_values` JSON 数组，并把旧 `refund_judge_value` 回填为单元素数组；旧字段继续保留首值快照。
- v10.77 新增 `recognition_date_summaries.recognized_bank_flow_count`，回填正数且 `recognition_status = 'recognized'` 的流水条数。
- 部署脚本的 `--check-database` 会逐段读取四个迁移完成态；`--migrate-database` 只允许四个明确文件名，后一段迁移前必须通过前置迁移回读。普通部署模式不自动执行 SQL。
- 本版本没有 npm 依赖、环境变量、端口、PM2 配置或 MySQL Event 变化。不执行 `drizzle schema push`。

## 验证结果

- `npm run check` 通过；Vitest 全量测试通过（44 个测试文件、231 个测试），订单上传专项测试通过（24 个测试）。
- Node 原生迁移与部署测试通过（25 个测试）；`npm run lint` 通过，保留 2 条既有非阻断告警。
- `npm run build`、`bash -n deploy-update-optimized.sh` 和 `git diff --check` 通过；Vite 仅提示浏览器数据更新和大 chunk 的非阻断告警。
- 发包后继续核验非空 `dist/boot.js`、`dist/public/index.html`、`dist/public/assets/`、运行依赖指纹脚本及四个迁移 SQL，并确认禁止文件和 AppleDouble 条目为 0。

## 性能评估

- 支出列表不读取认账结果、凭证、收入规则或同日/多日聚合状态，浏览成本随当前分页规模变化。
- 收入列表不再在打开时重算并写回流水状态；日期详情顶部直接读取收入总额和已认账条数缓存，避免读路径聚合大表。
- 已认账条数复用日期汇总原有的收入流水聚合，不新增独立 SQL 查询。

## 风险与回退

- v10.77 代码依赖四段迁移的最终结构；任一表、字段、回填或缓存完成态不正常时，部署脚本会拒绝普通部署。
- v10.75 会改写纯支出待认账任务状态与日期汇总状态。代码回退到 v10.73 不会自动恢复这些数据状态；如果必须完整恢复旧口径，需依据迁移前的数据库备份独立评估。
- 四段迁移都保留旧兼容字段或仅增加结构，回退代码时不建议删除新表或新字段，避免丢失多组排除条件、退款多值和汇总缓存。
- 如果应用启动或业务验证异常，可停止应用并重新部署 `finance-platform-v10.73-local.tar.gz` 回退代码；数据库保留已执行的兼容性结构和回填结果。
