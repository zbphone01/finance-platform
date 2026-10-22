# v10.54-local 版本快照

## 发布范围

- 正式结束 `bill_details` 主表旧去重唯一索引的灰度期，删除 `bd_rule_partition_date_bill_no_uq(rule_id, partition_date, bill_date, bill_no)`。
- 保留并继续使用 `bd_rule_bill_date_bill_no_partition_uq(rule_id, bill_date, bill_no, partition_date)`，使订单上传按 `rule_id + bill_date + bill_no` 去重时可以使用连续左前缀。
- `db/schema.ts` 同步移除旧索引声明，避免后续结构维护重新创建已淘汰索引。
- 迁移仅处理主表，不修改既有 `bill_details_archive_YYYYMM` 月归档表；没有新索引的归档表继续保留旧唯一索引。
- 右上角系统版本号更新为 `v10.54`。
- 部署包：`releases/finance-platform-v10.54-local.tar.gz`，包含本地验证通过的预构建 `dist/`，服务器不执行 Vite/esbuild 构建。

## 数据库、依赖与配置

- 本快照只记录从 v10.53 升级到 v10.54 的变化。
- 数据库迁移脚本：`migrate-v10.54-drop-bill-details-legacy-dedupe-index.sql`。
- 迁移只删除主表旧索引，不修改数据、字段、分区和归档表。
- 脚本执行前验证新唯一索引存在、可见、唯一且列顺序为 `rule_id, bill_date, bill_no, partition_date`；不满足条件时主动报错并停止。
- 旧索引已经不存在时脚本不重复删除，因此本地、测试服务器1和测试服务器2已手工完成删除的数据库可以安全重复执行。
- 本版本不新增 npm 依赖、环境变量或运行配置。
- 不执行 `drizzle schema push`。

## 迁移验证

- 本地主表已执行迁移并重复执行验证幂等性。
- 本地主表只保留新去重唯一索引；旧索引不存在。
- 本地既有月归档表未被迁移修改。
- 去重查询继续命中新索引，日期状态查询继续使用日期状态复合索引。
- 测试服务器1和测试服务器2此前已手工删除主表旧索引；部署时仍执行本迁移，以验证目标数据库结构并统一迁移记录。

## 验证结果

- `npm test` 通过：31 个测试文件、163 项测试。
- `npm test -- api/lib/orderUploadStream.test.ts` 通过：1 个测试文件、15 项测试。
- `npm run check` 通过。
- `npm run build` 通过，已生成生产环境 `dist/`。
- `git diff --check` 通过。
- 发布包已按仓库发版规则检查预构建产物、迁移脚本和排除项。

## 风险与回退

- 删除旧索引会减少主表每次写入时维护一棵重复唯一索引的成本，并释放该索引占用的 InnoDB 空间；实际磁盘文件是否立即缩小取决于表空间配置。
- 新旧索引约束的是同一组四列的唯一性，仅列顺序不同；删除旧索引不会放宽唯一性约束。
- 如果新索引缺失、不可见、不是唯一索引或列顺序异常，迁移会在删除前失败，旧索引保持不变。
- 既有归档表没有统一具备新索引，本版不删除其旧唯一索引，避免削弱归档表约束或影响历史查询。
- 需要数据库回退时执行：

```sql
ALTER TABLE bill_details
  ADD UNIQUE INDEX bd_rule_partition_date_bill_no_uq
    (rule_id, partition_date, bill_date, bill_no),
  ALGORITHM = INPLACE,
  LOCK = NONE;
```

- 回退前必须确认没有同名索引；创建唯一索引期间会产生额外 I/O，并可能因并发写入或历史重复数据失败。
- 代码可使用 `releases/finance-platform-v10.53-local.tar.gz` 回退；代码回退不会自动重建数据库索引。
