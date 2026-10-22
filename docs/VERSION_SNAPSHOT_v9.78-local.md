# v9.78-local 版本快照

## 发布范围

- 本版用于替代 v9.77-local 包，补齐订单明细包退款金额的文件级快照能力。
- 部署包：`releases/finance-platform-v9.78-local.tar.gz`。
- 推荐继续使用 `deploy-update-optimized.sh` 部署。

## 退款金额快照

- `bill_details` 新增并使用 `refund_amount_snapshot` 保存单行退款金额快照，退款订单入库时按退款金额字段保存为正数。
- `order_files` 新增 `refund_amount` 保存订单文件级退款金额汇总快照。
- 订单明细上传完成后，退款金额会像收入金额一样汇总写入订单文件表。
- 订单明细包列表中的退款金额改为直接汇总 `order_files.refund_amount`，不再打开列表时实时扫描订单明细表。

## 订单明细包

- 订单明细包列表“收入金额 / 退款金额”统一使用订单文件级快照口径。
- 普通进入订单明细内容页时，顶部收入金额和退款金额读取当前订单文件快照。
- 从“查看未匹配明细 / 查看待拆分明细”等范围入口进入时，顶部汇总继续按当前范围的明细快照动态统计。

## 数据库迁移

- 新增迁移脚本：`migrate-v9.78-refund-amount-snapshot.sql`。
- 已部署 v9.77 的环境，部署 v9.78 前需执行该迁移。
- 该迁移会新增：
  - `bill_details.refund_amount_snapshot`
  - `order_files.refund_amount`
- 迁移会按历史退款订单回填明细退款快照，并按订单文件回填文件级退款金额。
- 从更旧版本升级时，仍需先补齐 `migrate-v9.70-detail-split-rule-upload-fields.sql`、`migrate-v9.74-finance-role.sql` 和 `migrate-v9.77-refund-order-rule-fields.sql`。

## 验证

- `npm run check` 通过。
- `npm test` 通过。
- `npm run build` 通过。
- `npm test -- api/lib/orderUploadStream.test.ts` 通过。
- `git diff --check` 通过。
- 发布包完整性检查通过，沿用历史轻量发布方式，不包含本地 `dist`，由服务器部署脚本重新构建。
