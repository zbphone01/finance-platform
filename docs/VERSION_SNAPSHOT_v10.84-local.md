# v10.84-local 版本快照

## 发布范围

- 本版本从上一实际部署包 `v10.83-local` 升级。
- 银行流水上传继续在入库前完成滤重，入库时固化到账信息 ID 和匹配状态。
- 本次上传的流水全部入库后，到账认账规则和分账规则各读取一次并在内存建立索引；只处理本次新增、正收入、已固化到账匹配的流水，不扫描历史流水。
- 候选流水按 ID 排序后每 100 条一个事务，批量写入 `match_results` 并更新流水状态，不进入数据库重任务队列。
- 每批事务内按升序锁定本批精确流水 ID，回读状态和已有结果后再写入，防止上传、人工认账或重试并发重复产生结果。
- 百分比规则直接产生结果；“认账时填写”只固化规则并保持待认账。某批失败时回滚当批并停止后续批次，已成功批次和已入库流水保留。
- 上传结果展示完成认账、待填写、无规则、失败和跳过数量。

## 数据库、依赖与配置

- 本版无 SQL 迁移，不新增或修改表、字段、索引、外键和数据。
- `scripts/check-v10.84-counterparty-match-accounts-database.mjs` 只读验证 v10.83 完成态：主表旧匹配字段已移除，子表唯一键、级联外键及数据完整性正常。
- 不新增 npm 依赖、环境变量、端口或 PM2 配置。

## 验证要求

- `npm run check`、`npm test`、`npm test -- api/lib/orderUploadStream.test.ts`、`npm test -- api/lib/uploadedIncomeRecognition.test.ts`、`npm run build` 和 `git diff --check` 必须通过。
- `node --test scripts/runtime-lock-fingerprint.test.mjs scripts/deploy-database-control.test.mjs` 与 `bash -n deploy-update-optimized.sh` 必须通过。
- 发布包必须包含非空预构建 `dist/`、v10.84 只读数据库检查器和批量到账认账源码，不包含 v10.84 迁移 SQL、环境文件、依赖目录、Git、发布目录、缓存或本地数据库备份。

## 风险与回退

- 上传到账认账以每 100 条为提交边界；某批失败时该批及后续候选保持未认账，可从日期任务重试，不会回滚已上传流水或已成功批次。
- 其他认账入口和既有队列保持不变；本版优化仅作用于银行流水上传后的到账认账。
- 回退时恢复 v10.83 应用包即可，无数据库回迁。已产生的认账结果与旧逻辑结构一致，不需要删除。
