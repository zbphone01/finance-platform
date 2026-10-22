# v10.78-local 版本快照

## 发布范围

- 本版本从上一实际部署包 `v10.77-local` 升级。
- 明细认账的退款订单判断恢复为单个判断字段和单个退款字段值，不再支持多值 JSON 配置。
- 同一判断字段可选配置单个收支方向值。命中该值时，收入金额非 0 且退款金额为 0 按收入处理；退款金额非 0 且收入金额为 0 按退款处理；两者均为 0 直接待匹配；两者都非 0 或金额非数字会拒绝上传。
- 直接命中退款字段值时，退款金额必须是非 0 数字，否则拒绝上传。未命中两个值的明细继续走原有收入和待匹配流程。
- 流式上传与旧 `taskRouter` 路径共用分类器。每行只读取一个判断字段、最多比较两个单值，仅在命中时解析金额，无逐行 JSON 解析或新增数据库查询。
- 页面版本号更新为 `v10.78`，部署包为 `releases/finance-platform-v10.78-local.tar.gz`，包含本轮生成的预构建 `dist/`。

## 数据库、依赖与配置

- 从 `v10.77-local` 升级只执行 `migrate-v10.78-refund-direction-value.sql`。
- 迁移先将 `refund_judge_values` 的唯一元素恢复到 `refund_judge_value`，再新增 `recognition_rules.refund_direction_judge_value VARCHAR(500) NULL`，最后删除 `recognition_rules.refund_judge_values` JSON 字段。
- 部署脚本只允许上一结构是 nullable JSON 且所有非空数组都是非空的单元素数组。如存在多值、空值、非数组或启用规则无法恢复的配置，必须失败退出，不执行 DDL。
- 迁移后回读验证旧 JSON 字段不存在、新单值字段类型正确、启用规则配置完整且两个值不重复。
- 本版本无 npm 依赖、环境变量、端口、PM2 配置或 MySQL Event 变更，不执行 `drizzle schema push`。

## 验证结果

- `npm run check`、`npm run build`、`npm test -- api/lib/orderUploadStream.test.ts`、`git diff --check` 通过。
- Vitest 全量测试通过（44 个测试文件、231 个测试）；Node 原生迁移与部署测试通过（28 个测试）。
- `bash -n deploy-update-optimized.sh` 通过。Vite 仅保留浏览器数据过期和大包体积的非阻断提示。
- 发包后必须核验非空 `dist/boot.js`、`dist/public/index.html`、`dist/public/assets/`、运行依赖指纹脚本及 v10.78 迁移 SQL，并确认禁止文件和 AppleDouble 条目为 0。

## 性能评估

- 分类器在规则加载后预先规范化两个单值，不会因重复字段读取、数组遍历或 JSON 解析增加预匹配开销。
- 收支方向只在命中其单值时解析两个金额，未命中明细保持原有预匹配路径。

## 风险与回退

- v10.78 代码依赖新的收支方向字段。正式部署前如有多值 JSON 配置，守卫会拒绝迁移；应先把每个规则修正为单值，再重新执行检查。
- 此 DDL 删除旧 JSON 字段，但它的唯一值已在删除前恢复到 `refund_judge_value`。若需回退代码，可重新添加兼容字段并从单值回填；如需恢复历史多值数据，必须依赖迁移前的数据库备份。
- 应用启动或业务验证异常时，可停止应用并重新部署 `finance-platform-v10.77-local.tar.gz` 回退代码；数据库保留 v10.78 结构和已恢复的单值配置。
