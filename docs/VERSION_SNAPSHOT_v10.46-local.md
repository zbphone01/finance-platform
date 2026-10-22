# v10.46-local 版本快照

## 发布范围

- 同日汇总匹配改为以单个认账任务作为聚合载体：同一到账日期、同一到账信息的多笔银行流水和订单明细包始终绑定一个任务。
- 新增同日流水、上传更多订单明细或更新认账条件时，只刷新并提交该聚合任务一次，不再按银行流水笔数重复进入认账队列。
- 认账前继续比较“待认账明细金额”和“流水剩余可认账金额”；金额允许时沿用默认订单明细认账流程。
- 认账完成后按交易时间、流水 ID 顺序，以实际入账总额逐笔覆盖银行流水，分别计算已认账、部分认账和未认账状态。
- 同日汇总的手动认账、明细转移、状态刷新和凭证范围统一使用聚合任务内的银行流水集合。
- 日期汇总银行流水列表为未认账流水增加删除图标和确认弹窗；已绑定多日匹配组或所属任务已绑定订单明细包时，前端禁用且后端事务内拒绝单独删除。
- 银行流水表右侧差额金额、状态固定列跟随行悬停变化时使用不透明背景，避免横向滚动内容透出。
- 编辑到账信息时，凭证收款渠道保持非必填，并改为在下拉框内使用清空图标；图标贴近右侧边框。
- 右上角系统版本号更新为 `v10.46`。
- 部署包：`releases/finance-platform-v10.46-local.tar.gz`。

## 数据库与迁移

### 升级范围

- 当前迁移脚本为 `migrate-v10.46-same-day-single-task.sql`。
- 本快照只记录从 v10.45 升级到 v10.46 所需的数据库变化。
- 必须先完成 v10.46 数据库迁移，再部署 v10.46 代码包；迁移脚本已执行时不得重复执行。
- 本版不新增 npm 依赖、不调整运行配置、不执行 `drizzle schema push`，部署脚本也不会自动执行 SQL。

### 结构变化

- `recognition_tasks` 新增可空字段 `same_day_counterparty_id`，保存同日汇总任务对应的到账信息 ID。
- 新增唯一索引 `rt_same_day_counterparty_date_uq (bill_date, same_day_counterparty_id)`，防止并发上传为同一天、同一到账信息创建多个聚合任务。
- 历史上本来只有一个任务的同日汇总分组由迁移直接回填；存在多个旧任务的分组保持空标记，后续新增流水、更新订单包或开始认账时由应用事务归并。
- 应用归并历史任务时同步迁移银行流水、订单包、热表与归档订单明细、明细分账文件、认账结果及日期汇总引用。

### 迁移前检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_tasks LIKE 'same_day_counterparty_id'; SHOW INDEX FROM recognition_tasks WHERE Key_name = 'rt_same_day_counterparty_date_uq'; SELECT rt.bill_date, cr.id AS counterparty_id, COUNT(*) AS task_count FROM recognition_tasks rt INNER JOIN recognition_rules rr ON rr.id = rt.rule_id INNER JOIN counterparty_records cr ON cr.alias = rr.matched_counterparty_alias AND cr.recognition_type = '明细认账' AND cr.detail_matching_mode = '同日汇总匹配' GROUP BY rt.bill_date, cr.id HAVING COUNT(*) > 1 ORDER BY rt.bill_date DESC LIMIT 20; SHOW VARIABLES LIKE 'event_scheduler'; SHOW EVENTS WHERE Db = DATABASE() AND Name IN ('ev_bill_details_rolling_partitions','ev_bill_details_archive_old_daily_partitions');"
```

- 字段和索引均不存在：可以执行 v10.46 迁移。
- 字段和索引均已存在：不要重复执行迁移。
- 仅存在字段或仅存在索引：停止部署，核查此前迁移中断原因。
- 检查到历史重复分组不阻止迁移；这些分组不会在 SQL 阶段盲目合并。

### 执行迁移

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.46-same-day-single-task.sql
```

### 迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_tasks LIKE 'same_day_counterparty_id'; SHOW INDEX FROM recognition_tasks WHERE Key_name = 'rt_same_day_counterparty_date_uq'; SELECT COUNT(*) AS assigned_same_day_tasks FROM recognition_tasks WHERE same_day_counterparty_id IS NOT NULL; SELECT rt.bill_date, cr.id AS counterparty_id, COUNT(*) AS task_count, SUM(rt.same_day_counterparty_id IS NULL) AS null_marker_count FROM recognition_tasks rt INNER JOIN recognition_rules rr ON rr.id = rt.rule_id INNER JOIN counterparty_records cr ON cr.alias = rr.matched_counterparty_alias AND cr.recognition_type = '明细认账' AND cr.detail_matching_mode = '同日汇总匹配' GROUP BY rt.bill_date, cr.id HAVING COUNT(*) > 1 ORDER BY rt.bill_date DESC LIMIT 20; SHOW EVENTS WHERE Db = DATABASE() AND Name IN ('ev_bill_details_rolling_partitions','ev_bill_details_archive_old_daily_partitions');"
```

确认字段为可空 `BIGINT UNSIGNED`，唯一索引包含 `bill_date` 和 `same_day_counterparty_id`。历史重复分组允许继续显示空标记，首次被新版业务触发后再事务归并。

## 本地迁移结果

- 本地数据库 `finance_recon_sandbox` 已成功执行 `migrate-v10.46-same-day-single-task.sql`。
- 字段和唯一索引复查通过。
- 本地发现 4 组历史同日汇总重复任务，每组 3 个任务，均按设计保持空标记，未在迁移阶段直接合并。
- 本地检查只显示 `ev_bill_details_archive_old_daily_partitions`；`ev_bill_details_rolling_partitions` 未显示。该状态在迁移前后保持一致，不是 v10.46 迁移造成，部署时仍需执行 Event 检查。

## 验证结果

- `npm run check` 通过。
- `npm test` 通过：20 个测试文件、104 项测试。
- `npm test -- api/lib/orderUploadStream.test.ts` 通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- 发布包已生成并通过内容排除检查。

## 风险与回退

- 未执行 v10.46 迁移就部署代码，会因缺少 `same_day_counterparty_id` 字段导致任务查询或创建失败。
- 代码可使用 `releases/finance-platform-v10.45-local.tar.gz` 回退；新增可空字段和唯一索引可以暂时保留。
- 历史重复任务一旦被新版应用事务归并，其关联数据已经统一到一个任务；代码回退不会自动把任务拆回，必要时应从部署前数据库备份恢复。
- 如果只做紧急代码回退，不建议立即删除新增字段或索引；结构回退应在确认没有新版同日汇总任务后单独制定方案。
