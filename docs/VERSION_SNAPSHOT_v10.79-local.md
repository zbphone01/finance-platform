# v10.79-local 版本快照

## 发布范围

- 本版本从上一实际部署包 `v10.78-local` 升级。
- 修复明细分账增量认账写回：任务 746 的预检命中 70 条明细，但 MySQL 8 对分区表多表 `UPDATE` 误选 `index_merge`，实际更新 0 条并触发完整回滚。
- 分账增量写回现在以 `detail_split_file_id + task_id + rule_id + partition_date + 状态` 限定范围，并强制使用既有 `bd_rule_detail_split_status_idx`；不新增 `bill_details` 索引。
- 每日订单明细归档改为仅搬迁 `match_result_id IS NOT NULL` 的已认账明细。待拆分、已匹配未认账、已忽略和普通未匹配等未认账明细在超过 60 天后并入 `p_late`，继续可以自动或手动认账；认账成功后由后续归档再搬迁。
- `1970-01-01` 的未匹配打包明细保持原有 `p_unmatched` 路径。已归档的历史未认账明细不批量回迁，仍保留单条恢复认账兼容路径。
- 页面版本号更新为 `v10.79`，部署包为 `releases/finance-platform-v10.79-local.tar.gz`，包含本轮生成的预构建 `dist/`。

## 数据库、依赖与配置

- 从 `v10.78-local` 升级只执行 `migrate-v10.79-keep-unrecognized-bill-details-hot.sql`。
- 迁移重建 `archive_bill_details_day`、`archive_bill_details_daily` 和 `roll_bill_details_hot_window`，并启用既有归档 Event；不新增表、字段、索引、npm 依赖、环境变量、端口或 PM2 配置。
- 部署守卫要求 v10.78 已完成，并回读三个归档过程、`p_late`、`p_future` 和归档 Event。过程定义不完整或分区/Event 缺失时拒绝迁移和部署。
- 不执行 `drizzle schema push`。

## 验证结果

- `npm run check`、`npm run build`、`npm test`、`git diff --check` 通过。
- 明细分账和归档专项测试通过；隔离 MySQL 验证了“已认账归档、未认账保留并入 `p_late`、后续认账后再归档”的完整路径。
- `bash -n deploy-update-optimized.sh`、部署守卫 Node 原生测试和发布包内容检查通过。
- Vite 仅保留浏览器数据过期和大包体积的非阻断提示。

## 性能与回退

- 对每日约 150 万条明细、约 10 条未认账的口径，归档仍按 50000 行批次处理已认账行；未认账行不增加逐行关联查询或新索引，`p_late` 的增长受该少量留存量控制。
- 若需回退应用代码，可重新部署 `finance-platform-v10.78-local.tar.gz`。数据库迁移会保留未认账明细在热表的安全状态；不要通过重跑旧全量归档过程来“回退”，否则会再次归档未认账明细。
