# v10.83-local 版本快照

## 发布范围

- 本版本从上一实际部署包 `v10.82-local` 升级，包含当前工作区全部已确认业务改动。
- `counterparty_match_accounts` 成为到账匹配条件唯一来源，不限制匹配条件组数；`counterparty_records` 只保存到账别称、认账类型、明细匹配方式、地区、凭证渠道等业务元数据。
- 银行流水上传、重新匹配、未记录到账滤重、明细候选、多日汇总和订单文件快照均不再读取主表条件；订单文件需要单组展示字段时，固定取启用子项中 `sort_order, id` 最小的一组。
- 到账信息新增、编辑和批量记录在事务中同步写主记录与至少一组有效子项，排序号在同一主记录内唯一，删除主记录时子项级联删除。
- 认账及分账主列表移除 ID 列；银行收入列表的“待认账”状态悬停仅显示固化匹配的到账别称。

## 数据库、依赖与配置

- 执行 `migrate-v10.83-counterparty-match-accounts-source.sql`：为完全没有子表记录的历史主记录补建第一组子项，增加 `counterparty_match_accounts(counterparty_record_id, sort_order)` 唯一索引和指向 `counterparty_records(id)` 的 `ON DELETE CASCADE` 外键。
- 同一迁移删除 `counterparty_records.bank_name/account_no/account_name/summary/purpose/post_script` 六个重复条件字段及 `cr_account_no_idx`。
- 迁移前检查拒绝孤立子项、空启用条件、重复排序、有子项但无启用条件、不可回填主记录和部分字段状态；迁移后独立回读字段、索引、外键及数据完整性。
- 不修改 `bank_flows` 表、已有固化到账匹配状态和历史认账结果；不新增 npm 依赖、环境变量、端口或 PM2 配置。

## 验证要求

- `npm run check`、`npm test`、`npm test -- api/lib/orderUploadStream.test.ts`、`npm run build` 和 `git diff --check` 必须通过。
- `node --test scripts/runtime-lock-fingerprint.test.mjs scripts/deploy-database-control.test.mjs` 与 `bash -n deploy-update-optimized.sh` 必须通过。
- 发布包必须包含非空的预构建 `dist/`、v10.83 数据库检查器和当前迁移；不得包含环境文件、依赖目录、Git、发布目录、缓存和本地数据库备份。

## 风险与回退

- 本次会删除主表字段，旧版代码无法直接运行在迁移后的数据库上。代码回退前必须先恢复迁移前两表备份，或重建六个主表字段并用每个到账信息排序第一的子项回填，再部署 v10.82。
- 迁移 DDL 由当前版本检查器限定在完整 v10.82 基线执行；两个联动应用迁移期间必须停止，禁止用 `drizzle schema push` 代替迁移。
- 上传匹配继续一次批量读取主表业务元数据和启用子表条件后在内存计算，不在列表读取时重新匹配或写回。
