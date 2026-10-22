# v10.80-local 版本快照

## 发布范围

- 本版本从上一实际部署包 `v10.79-local` 升级。
- 明细认账规则的“分账包设置”增加必填子订单号字段，并在分账文件上传时固化字段快照。
- 新增 `认账规则 ID + 标准化子订单号` 的持久滤重键；同一文件、跨 5000 行批次、跨分账包和归档后均只保留第一条成功明细，重复行丢弃并计入分账包重复数。
- 新上传分账明细的 `bill_details.bill_no` 固定为 `SPLIT-分账包ID-文件行号`；原始子订单号保留在 `raw_data`，标准化子订单号写入独立滤重表。
- 金额比较改为分值整数完全相等：同一主订单下所有唯一分账明细金额合计必须等于来源订单金额；任一唯一分账行无法匹配当前认账规则时，整组不绑定、不认账、不改状态。
- 来源订单的 `bill_date` 与 `partition_date` 分开写入分账子明细；重试认账时会修复已有的已关联但日期错误、尚未认账热表明细，避免再次因日期分区不一致而认账失败。
- 未归档分账包删除仍回滚绑定结果、来源状态并释放其持久滤重键；已归档分账包继续禁止删除。已归档订单明细包删除仍按既有规则恢复关联子明细到热表后解绑。

## 数据库、依赖与配置

- 从 `v10.79-local` 升级只执行 `migrate-v10.80-detail-split-order-dedup.sql`。
- 迁移新增：
  - `recognition_rules.detail_split_order_no_field`，默认 `子订单编号`；
  - `detail_split_files.order_no_field`（历史包为空，不伪造历史快照）；
  - `detail_split_files.duplicate_count`；
  - `detail_split_order_dedup_keys`，主键为 `(rule_id, normalized_order_no)`，并以分账包外键级联释放滤重键。
- 历史分账包不自动回填滤重键；只有新上传且具有子订单号字段快照的分账包进入持久滤重口径。
- 不新增 npm 依赖、环境变量、端口或 PM2 配置；不执行 `drizzle schema push`。
- `deploy-update-optimized.sh --check-and-migrate-database` 只处理本版 `v10.79-local -> v10.80-local` 迁移：先只读探测 v10.80 字段与滤重表状态，已完成时不执行 SQL；需要迁移时确认两个联动应用已停止后自动执行并回读字段、主键、外键和字符集。它不检查或补执行 v10.79 及更早迁移。

## 验证结果

- `npm run check` 通过。
- `npm test` 通过：47 个测试文件、246 个测试通过（以本次执行输出为准）。
- `npm run build` 通过；Vite 浏览器数据过期和大资源体积提示为非阻断警告。
- `node --test scripts/runtime-lock-fingerprint.test.mjs scripts/deploy-database-control.test.mjs`、`bash -n deploy-update-optimized.sh` 和 `git diff --check` 通过。
- 发布包内容检查确认包含非空 `dist/boot.js`、`dist/public/index.html`、`dist/public/assets/`、运行依赖指纹脚本和 v10.80 迁移，且排除环境文件、依赖目录、Git、旧发布包和本地备份。

## 性能、回退与运行注意

- 分账上传仍按每 5000 行批处理；每批只批量抢占持久滤重键并读取本批归属，不逐行查询，也不把整文件子订单号长期保存在无界集合中。
- 金额解析拒绝超过两位小数的输入，不进行四舍五入；金额比较在整数分值上完成。
- v10.80 应用代码依赖 v10.80 迁移完成后的字段和滤重表。迁移未完成时部署守卫必须拒绝部署；部署守卫只验证当前版本迁移，历史补迁必须使用对应历史版本的发布包和部署说明单独处理。
- 若需回退应用代码，可重新部署 `finance-platform-v10.79-local.tar.gz`；不要删除 v10.80 新表或字段来回退，避免破坏已经生成的滤重键。若必须回退数据库，先停止两个联动应用并由人工评估新上传分账数据，再制定可恢复的备份/反向迁移方案。
- 本地已生成发布包但尚未执行线上迁移、部署、提交或推送；测试服务器上的最新分账包状态不会因本次本地发版自动改变。
