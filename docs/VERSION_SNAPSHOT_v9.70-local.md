# v9.70-local 版本快照

## 发布范围

- 本版用于替代 v9.69-local 包，包含明细分账上传字段迁移到明细认账规则维护、明细分账上传入口简化，以及日期汇总任务快照口径修复。
- 部署包：`releases/finance-platform-v9.70-local.tar.gz`。
- 推荐继续使用 `deploy-update-optimized.sh` 部署。

## 明细认账规则

- 明细分账设置新增“分账包设置”，字段顺序为：认账条件字段、收入字段、明细匹配字段。
- 分账包设置默认值为：认账条件字段 `商品标题`，收入字段 `买家实付金额`，明细匹配字段 `主订单编号`。
- 新建、编辑、复制规则时会保存并回显上述三个字段。

## 明细分账

- 上传明细分账时不再手工填写明细匹配字段、收入字段、认账条件字段。
- 上传弹窗选择明细认账规则后，直接读取规则中的分账包设置做表头校验和上传处理。
- 上传弹窗展示所选规则的分账包设置，便于上传前核对。

## 日期汇总

- 订单上传后的任务快照刷新只统计来源订单明细，排除明细分账子明细。
- 修复空任务残留旧订单明细快照时，日期汇总订单明细条数被重复放大的问题。

## 数据库迁移

- 新增 `migrate-v9.70-detail-split-rule-upload-fields.sql`：
  - `recognition_rules.detail_split_recognition_keyword_field`
  - `recognition_rules.detail_split_income_field`
  - `recognition_rules.detail_split_match_field`
- 已执行过 v9.69 的环境，只需继续执行 v9.70 迁移。

## 验证

- `npm run check` 通过。
- `npm run build` 通过。
- `npm test -- api/lib/orderUploadStream.test.ts` 通过。
- `git diff --check` 通过。
