# v9.56-local 版本快照

## 发布范围

- 本版用于替代已生成的 v9.55-local 包，包含 v9.54、v9.55 以及本轮后续修正。
- 部署包：`releases/finance-platform-v9.56-local.tar.gz`。
- 推荐继续使用 `deploy-update-optimized.sh` 部署。

## 单条多分账与待拆分

- 明细认账规则新增规则级配置：`明细分账判断字段`、`判断关键字`、`明细匹配字段`。
- 订单明细上传预匹配顺序为：`等于 -> 待拆分 -> 包含`。
- 单条多分账只在配置字段末尾做关键字命中，命中后标记 `pending_split`，不绑定规则条件 ID。
- 手动开始认账补匹配未匹配明细时，同样按 `等于 -> 待拆分 -> 包含` 重跑。

## 缓存与汇总口径

- 新增统计缓存字段：
  - `order_files.order_total_amount`
  - `order_files.pending_split_count`
  - `recognition_tasks.pending_split_count`
  - `recognition_date_summaries.pending_split_count`
- `订单明细包` 列表继续读取 `order_files` 汇总字段，不实时聚合 `bill_details` 大表。
- `认账及分账` 日期列表和日期详情继续读取 `recognition_date_summaries`，不在读路径实时重算。
- 上传订单明细、手动认账、补匹配、删除订单明细包等写路径会刷新订单明细包、任务和日期汇总缓存。
- `认账及分账` 订单明细统计按认账行为展示：`已认账`、`未认账`、`未认账中待拆分`。
- `订单明细包` 列表按预匹配结果展示：`未匹配 / 待拆分`，其中未匹配数量包含待拆分；查看未匹配明细时同时返回 `unmatched` 和 `pending_split`。

## 明细认账规则编辑

- 恢复并固定交互边界：明细认账规则列表中的 `编辑` 必须进入整体编辑页，所有条件和分账在同一页维护。
- 单条件独立编辑只保留在规则详情页的 `编辑条件` 入口，用于查看条件后的定向维护。
- 保留 v9.50 的整体编辑性能优化：草稿延迟合并保存、树形下拉关闭时不遍历大字典树，避免规则基本信息输入卡顿。
- 后续迭代不得把普通 `编辑` 入口改成摘要卡片或单条件跳转，除非先重新设计整体编辑性能方案。

## 到账信息汇总

- `到账信息汇总` 已记录列表列顺序调整为：
  `到账别称 - 认账类型 - 到账匹配方式 - 匹配条件 - 地区 - 对方账号 - 对方户名 - 用途 - 附言 - 操作`。
- 原 `匹配方式` 表头改为 `到账匹配方式`。
- 多组匹配条件时，对方账号、对方户名、用途、附言显示 `-`，避免误把首组条件当成唯一条件。
- 记录/编辑到账信息时，匹配条件多于 2 组后条件卡片区域支持上下滚动，避免弹窗被撑得过高。

## 数据库迁移

- `migrate-v9.55-multi-split-order-details.sql`
  - `recognition_rules` 新增单条多分账配置字段。
  - `bill_details.match_status` 枚举新增 `pending_split`。
- `migrate-v9.55-summary-cache-fields.sql`
  - 新增待拆分和订单明细包金额缓存字段。
  - 回填 `order_files`、`recognition_tasks`、`recognition_date_summaries` 汇总数据。

## 验证

- `npm run check` 通过。
- `npm run build` 通过。
