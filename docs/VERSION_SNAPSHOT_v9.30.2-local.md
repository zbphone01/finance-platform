# v9.30.2-local 版本快照

## 时间

- 2026-05-18

## 本版状态

- 已执行并通过：`npm run check`。
- 已执行并通过：`npm run build`。
- 数据库迁移脚本已新增：`migrate-v9.31-order-file-abnormal-status.sql`。
- 已更新技能文档：`docs/finance-recon-SKILL.md`。
- 已生成部署包：`releases/finance-platform-v9.30.2-local.tar.gz`。

## 主要更新

### 订单明细上传诊断

- 上传失败提示改为简短提示，仅展示错误行和错误原因。
- 订单号、账单日期、收入金额字段无法识别时，分别返回明确错误。

### 微信订单明细尾部汇总过滤

- 保留 v9.30 的尾部汇总行过滤逻辑。
- 补充兼容 `0.0_1`、`0.0_2` 这类 PapaParse 自动去重后缀，避免纯数字汇总行进入订单明细校验。
- 补充微信账单汇总标题：`总交易额`、`总企业红包退款金额`。

### 异常订单明细数据包

- `order_files.upload_status` 新增 `abnormal`。
- 上传成功但订单总金额为 `0` 的订单明细数据包标记为“异常”。
- 异常数据包保留明细用于查看，但不参与自动明细认账。
- 手动点击“开始认账”时，认账引擎排除异常数据包明细。
- 订单明细列表和详情页支持展示“异常”状态。

## 修改文件

- `api/boot.ts`
- `api/lib/orderUploadStream.ts`
- `api/orderFileRouter.ts`
- `api/taskRouter.ts`
- `db/schema.ts`
- `src/pages/RecognitionPage.tsx`
- `src/pages/OrderFilesPage.tsx`
- `src/pages/OrderFileDetailPage.tsx`
- `migrate-v9.31-order-file-abnormal-status.sql`
- `docs/finance-recon-SKILL.md`
- `docs/VERSION_SNAPSHOT_v9.30.2-local.md`
- `docs/DEPLOY_v9.30.2-local.md`
- `deploy-update-optimized.sh`
- `README.md`

## 数据库变化

新增迁移：

```sql
ALTER TABLE order_files
  MODIFY COLUMN upload_status ENUM('processing','completed','failed','abnormal') NOT NULL DEFAULT 'completed';
```

部署前必须执行：

- `migrate-v9.31-order-file-abnormal-status.sql`

## 验证

已执行：

```bash
npm run check
npm run build
```

本地业务验证：

- `0.0_1`、`0.0_2` 这类尾部汇总数值会被识别为纯数字汇总行并跳过。
- 订单明细上传错误提示已简化为“错误行 + 错误原因”。
