# v9.30.0-local 版本快照

## 时间

- 2026-05-16

## 本版状态

- 已执行并通过：`npm run check`。
- 已执行并通过：`npm run build`。
- 已更新技能文档：`docs/finance-recon-SKILL.md`。
- 已生成部署包：`releases/finance-platform-v9.30.0-local.tar.gz`。

## 主要更新

### 银行到账文件识别

- “添加银行到账”支持上传银行标准 `.xls` 文件。
- 支持解析 Excel 97-2003 二进制工作簿中的“账户交易明细表”。
- 自动识别表头：`流水号`、`交易时间`、`收入`、`对方账号`、`对方户名`、`交易行所`、`对方开户行`、`摘要`、`备注`、`附言`。
- 只导入收入金额大于 0 的到账流水，支出行不会生成认账任务。

### 银行流水字段映射

- 银行到账文件中的 `备注` 映射到系统银行流水的 `用途` 字段。
- 银行到账文件中的 `附言` 映射到系统银行流水的 `附言` 字段。
- 如果文件本身有 `用途` 字段，优先使用 `用途`，再使用 `备注`。

### 订单明细尾部汇总过滤

- 微信支付订单明细 CSV 末尾的汇总行不再进入订单明细入库。
- 自动跳过包含 `总交易单数`、`应结订单总金额`、`退款总金额`、`充值券退款总金额`、`手续费总金额`、`订单总金额`、`申请退款总金额` 的非订单行。
- 自动跳过紧随其后的纯数字汇总行。
- 订单明细建任务前强制校验日期必须为 `YYYY-MM-DD`，避免 `413.0` 这类汇总值生成认账分账汇总和明细数据包。

### 非日期脏数据清理

- 新增清理脚本：`migrate-v9.30-clean-invalid-date-packages.sql`。
- 用于删除历史上传中误生成的非日期认账任务、订单明细数据包和对应明细。
- 清理范围限制为 `bill_date` 不符合 `YYYY-MM-DD` 的数据。

## 修改文件

- `src/pages/RecognitionPage.tsx`
- `api/lib/orderUploadStream.ts`
- `api/taskRouter.ts`
- `docs/finance-recon-SKILL.md`
- `docs/VERSION_SNAPSHOT_v9.30.0-local.md`
- `docs/DEPLOY_v9.30.0-local.md`
- `deploy-update-optimized.sh`
- `migrate-v9.30-clean-invalid-date-packages.sql`

## 数据库变化

本版没有新增表结构字段。

本版包含一个数据清理脚本：

- `migrate-v9.30-clean-invalid-date-packages.sql`

线上如已经出现 `413.0` 这类非日期数据包，部署前先备份数据库，再执行该脚本。

## 验证

已执行：

```bash
npm run check
npm run build
```

本地业务验证：

- 银行标准 `.xls` 到账文件可识别为银行流水。
- 银行到账文件中 `备注` 内容进入银行流水 `用途` 字段。
- 微信支付订单明细尾部汇总行不会再生成非日期认账任务。
- 订单明细上传流程只允许真实 `YYYY-MM-DD` 日期进入明细数据包和认账任务。
