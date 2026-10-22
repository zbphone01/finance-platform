# v9.86-local 版本快照

## 发布范围

- 本版用于把银行流水制单结果从前端临时快照升级为数据库持久化结果。
- 本版新增数据库迁移：`migrate-v9.86-voucher-result-storage.sql`。
- 部署包：`releases/finance-platform-v9.86-local.tar.gz`。
- 推荐继续使用 `deploy-update-optimized.sh` 部署。

## 制单结果落库

- 新增制单结果主表、制单关联银行流水表、制单明细行表。
- 点击银行流水列表的制单按钮后，后端生成制单结果并写入数据库，不再保存到浏览器 `localStorage`。
- 查看制单页只从数据库读取已生成的制单结果；如果没有制单结果，会显示暂无制单数据。
- 制单生成后会同步把对应入账结果 `voucherStatus` 标记为 `created`；取消制单会恢复为 `pending`。
- 制单生成和取消制单使用数据库事务，避免中途失败留下不完整数据。

## 同日汇总制单

- 同日汇总匹配的银行到账制单时，会先校验同日同到账信息命中的全部银行到账是否都已认账。
- 如果同组银行到账中仍有未认账或部分认账，会阻止制单并弹窗提醒。
- 校验通过后生成一张整体制单结果，并把同组所有银行到账关联到同一张制单。
- 点击同组任意一条银行到账的查看制单，都会展示同一份整体制单结果。

## 页面交互

- 银行流水列表中的 `已认账/已制单` 下拉菜单只保留 `查看制单`。
- `取消制单` 移到查看制单页顶部右侧，使用红色按钮展示。
- 取消制单成功后删除数据库中的制单结果，并返回上一页。

## 数据库迁移

- `migrate-v9.86-voucher-result-storage.sql`：新增 `voucher_results`、`voucher_result_flows`、`voucher_result_lines` 三张表。
- 已部署 v9.85 的环境，部署 v9.86 前需先执行该迁移。
- 从 v9.84 或更旧版本升级时，需先补齐 v9.85 及历史缺失迁移，再执行 v9.86 迁移。

## 验证

- 本地已执行 `migrate-v9.86-voucher-result-storage.sql` 并确认三张表存在。
- `npm run check` 通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- `releases/finance-platform-v9.86-local.tar.gz` 已生成并通过 `tar -tzf` 完整性检查。
