# v10.71-local 版本快照

## 发布范围

- 本版本从 `v10.70-local` 升级，为票据平台订单开票提供上传时固化的订单明细单号值。主单号继续写入 `bill_details.bill_no`，其他单号1、其他单号2分别写入 `invoice_other_order_no_1`、`invoice_other_order_no_2`；相关原始列值仍保留在 `raw_data` 用于审计、回填和排错。
- 主上传路径和兼容上传路径都会把订单号、其他单号1、其他单号2的字段名快照写入 `order_files.invoice_order_no_field_snapshot`，规则后续修改不改变历史文件含义。
- 认账平台删除 `invoice_recognized_projection_jobs` 的登记、认账变化入队、代码与 Drizzle 模型，不再把认账结果投影到票据侧窄表。票据侧 `recognized_invoice_orders` 的删除由票据平台独立发布处理。
- `bill_details`、现存月归档表和未来月归档表保持相同票据单号列顺序；应用归档写入和数据库归档过程改用显式列清单，不再依赖 `INSERT ... SELECT bd.*`。
- 票据平台订单开票的配套业务口径为：同一输入单号可以命中多条订单明细，每个 `bill_detail_id` 只能全额开票一次；查询不得读取上海当前月月初减 24 个月之前的订单。
- 页面右上角版本号更新为 `v10.71`，部署包为 `releases/finance-platform-v10.71-local.tar.gz`，包含本次验证生成的预构建 `dist/`。

## 数据库、依赖与配置

- 从 `v10.70-local` 升级必须执行 `migrate-v10.71-order-invoice-fields.sql`。迁移先停止每日归档 Event，再为主表、所有现存 `bill_details_archive_YYYYMM` 和 `order_files` 增加字段；随后从旧投影任务转存文件字段快照，按 50000 行批次回填最近 24 个月热表和归档表，替换归档过程并重新启用 Event，最后删除 `invoice_recognized_projection_jobs`。
- 历史回填只使用上传文件固化快照和 `raw_data`；缺少快照、缺少原始值或早于截止日期的数据保持空值，不套用当前规则猜测。
- 本版本不新增订单号索引、npm 依赖、环境变量或运行配置，不使用 `drizzle schema push`。
- 迁移要求 `finance-platform` 和 `ticket-platform` 均已停止；票据平台必须在同一维护窗口完成兼容版本切换后才能恢复。

## 验证结果

- 订单上传、字段快照、归档显式列和 v10.71 迁移静态测试共 42 项通过；部署数据库控制测试 5 项通过。
- `npm run check`、`npm run build`、`git diff --check` 和 `bash -n deploy-update-optimized.sh` 均通过。
- SQL `DELIMITER` 解析得到 31 条完整语句；部署脚本内嵌 Node.js 数据库控制代码通过语法检查。
- 构建生成非空 `dist/boot.js`、`dist/public/index.html` 和前端资源；发布包必需项、禁止内容和 AppleDouble 条目已按仓库发版规则复核。

## 风险与回退

- 主表和归档表 `ALTER TABLE` 可能等待元数据锁，并可能产生明显 I/O；必须预留维护窗口，确认上传、旧投影和归档任务均为零后执行。
- MySQL DDL 会自动提交。迁移中断后可能处于部分加列、归档 Event 已禁用或旧投影表尚未删除的混合状态；不要直接重跑脚本，应先检查字段、Event、归档过程和快照回填进度，必要时手工恢复 Event，再制定续迁方案。
- 删除 `invoice_recognized_projection_jobs` 后，本迁移不能自动恢复旧投影任务。需要回退到 `v10.70-local` 时，必须使用迁移前数据库备份恢复旧表、旧归档过程和旧应用，并与票据平台版本一起回退。
- 缺少文件快照或原始字段值的历史订单不会被猜测回填；票据开票查询可能因此无法通过其他单号命中这些记录，主单号 `bill_no` 不受影响。
- 认账平台迁移完成后不再生产已认账订单投影；若票据平台仍依赖旧窄表，禁止恢复 `ticket-platform`。
