# v10.70-local 版本快照

## 发布范围

- 本版本从 `v10.69-local` 升级，将明细认账规则的“票据用单号”从三个固定业务含义的字段收敛为两个通用可选字段：“其他单号1”和“其他单号2”。
- 现有“订单号字段”及其订单识别、入库和去重口径保持不变；上传时只把已配置的其他单号原始列非空值写入 `bill_details.raw_data`。
- 规则查看页在“票据用单号”中统一展示订单号字段、其他单号1和其他单号2。
- 认账侧投影任务字段快照升级为 v2，只固化 `orderNo` 、`otherOrderNo1` 和 `otherOrderNo2`。
- 页面右上角版本号更新为 `v10.70`。
- 部署包为 `releases/finance-platform-v10.70-local.tar.gz`，包含本次验证生成的预构建 `dist/`。
- 部署脚本新增 `--check-database` 只读入口和显式 `--migrate-database <SQL 路径>` 入口：检查结果会直接说明是否需要迁移、给出下一条完整命令，并在已迁移时明确提示可以部署；普通部署也会复核 v10.70 数据库完成态。

## 数据库、依赖与配置

- 认账平台必须执行 `migrate-v10.70-generic-invoice-order-no-fields.sql`：把 `invoice_financial_flow_no_field` 直接改名为 `invoice_other_order_no_1_field`，把 `invoice_business_flow_no_field` 直接改名为 `invoice_other_order_no_2_field`，删除 `invoice_merchant_order_no_field`，并把现有投影任务快照改为 v2。
- 本版本不保留旧字段或旧投影快照协议兼容，不得单独对仍运行旧版票据系统的共享环境执行迁移。
- 票据系统必须同步使用通用单号版本及其 `migrate-v0.1.13-generic-order-no-fields.sql`；该迁移不属于认账系统发布包。
- 不新增 npm 依赖、环境变量或运行配置，不使用 `drizzle schema push`。

## 验证结果

- `npm run check`、`npm test -- api/lib/orderUploadStream.test.ts api/lib/invoiceOrderIndexJobs.test.ts`、`npm run build` 和 `git diff --check` 均通过。
- 认账平台相关测试共 19 项通过，覆盖其他单号列去重、非空原始值保存和 v2 投影快照。
- 认账侧和票据侧迁移均已在本地 `codex_test_` 临时表实际执行，字段改名、第三个额外单号删除和快照转换结果符合预期；临时表已删除。
- 构建生成非空 `dist/boot.js`、`dist/public/index.html` 和前端资源。
- 发布包必需构建产物、当前版本文档和禁止内容已按仓库发版规则复核。
- 数据库控制入口已通过 shell 语法、只读完成态、待迁移态、迁移执行和异常状态分支验证；部署文档不再要求粘贴内联 Node 迁移脚本。

## 风险与回退

- 迁移会直接删除 `invoice_merchant_order_no_field` 及其数据，并覆盖旧投影任务快照；未做数据库备份时无法从本版迁移自动恢复。
- 迁移后不能只回退认账平台代码到 `v10.69-local`；回退必须同时恢复认账规则旧三字段、v1 投影快照、票据窄表旧字段及两套旧版应用。
- 认账 `v10.70-local` 与旧版票据系统的字段快照和窄表协议不兼容；部署前必须确认配套票据发布产物已准备完成，并在同一维护窗口协同切换。
