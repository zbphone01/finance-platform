# v10.12-local 版本快照

## 发布范围

- 本版用于将对账日期字段改为 `DATE` 类型，支持工商银行到账流水上传，并补齐银行直捐手动认账的 NC 项目名称保存。
- 右上角系统版本号更新为 `v10.12`。
- 部署包：`releases/finance-platform-v10.12-local.tar.gz`。
- 推荐继续使用 `deploy-update-optimized.sh` 部署。

## 数据库结构

- `recognition_tasks.bill_date`、`recognition_date_summaries.bill_date`、`bill_details.bill_date` 从 `VARCHAR(20)` 改为 `DATE`。
- `bank_flows` 新增 `bank_name` 字段，默认值为 `广发银行`。
- 新鲜初始化 SQL 已同步上述结构。

## 银行到账

- 添加银行到账支持自动识别广发银行和工商银行流水。
- 广发银行继续沿用原上传解析逻辑。
- 工商银行流水按固定表头映射入库，并进入日期汇总的银行流水列表。
- 银行流水列表最左侧新增 `银行` 列，用于区分广发银行到账和工商银行到账。
- 上传解析失败时，添加银行到账弹窗内会展示错误提示，不再停留在无反馈状态。

## 手动认账

- 银行直捐的分账设置在预算编码后新增 `NC项目名称` 下拉，复用现有 NC 项目选择组件。
- 银行直捐手动认账保存时会写入所选 NC 项目名称。
- 本版不修复历史已入库且 `income_project` 为空的银行直捐入账结果。
- `支出资金来源` 文案调整为 `支出资金来源（选择捐赠活动后自动生成）`。

## 数据库迁移

- 从 v10.10 升级到 v10.12 需要上传代码包和迁移脚本后，先按顺序执行迁移，再部署代码包：
  - `migrate-v10.11-bill-date-date-type.sql`
  - `migrate-v10.12-bank-flow-bank-name.sql`
- `migrate-v10.11-bill-date-date-type.sql` 会修改 `bill_details` 大表字段类型，建议在测试环境维护窗口执行。
- 已执行过的脚本不要重复执行；执行前后请检查字段类型和字段是否存在。

## 本地验证

- `npm run check` 通过。
- `npm run build` 通过。
- `npm test -- api/lib/orderUploadStream.test.ts` 通过。
- `git diff --check` 通过。
- `releases/finance-platform-v10.12-local.tar.gz` 已生成并通过内容检查。
