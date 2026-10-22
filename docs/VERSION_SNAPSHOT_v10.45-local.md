# v10.45-local 版本快照

## 发布范围

- 到账信息的 `明细匹配到账方式` 新增 `多日汇总匹配`；选择后明细包类型固定为 `打包明细`。
- 多日汇总订单包支持单笔等额流水和跨日期多笔流水组合，单笔等额优先，候选方案最多展示 3 组。
- 没有可用方案时，订单包保持入库完成并独立显示 `流水未匹配`，`订单日期/匹配日期` 显示 `-`。
- 多解时显示 `匹配待确认`，点击弹窗选择方案；确认时重新校验订单包净额、流水未认账状态和占用状态。
- 订单上传、新增银行到账和日期汇总 `开始认账` 均支持自动重试。新增到账和手动开始认账只使用本次新增/所选日期流水作为触发种子。
- 唯一方案自动进入认账队列；匹配后订单包归属所选流水的最新到账日期，认账完成后组内所有流水均为已认账。
- 多日汇总凭证按一个凭证关联全部银行流水，凭证日期取最新到账日期；凭证详情显示起止日期和 `多日汇总 N 笔银行到账`。
- 凭证汇总第一列表头由 `流水日期` 改为 `凭证日期`。
- 删除订单包或任一关联日期时释放多日匹配组，剩余订单包恢复待匹配，避免流水残留占用。
- 右上角系统版本号更新为 `v10.45`。
- 部署包：`releases/finance-platform-v10.45-local.tar.gz`。

## 数据库与迁移

### 升级范围

- 当前迁移脚本为 `migrate-v10.45-multi-day-detail-matching.sql`。
- 本快照只记录从 v10.44 升级到 v10.45 所需的数据库变化；更早版本使用对应历史版本快照和部署说明查询。
- 必须先完成 v10.45 数据库迁移，再部署 v10.45 代码包；迁移脚本已执行时不得重复执行。
- 本版不新增 npm 依赖，不执行 `drizzle schema push`，部署脚本也不会自动执行 SQL。

### 结构变化

- `counterparty_records.detail_matching_mode` 枚举增加 `多日汇总匹配`。
- 新增 `multi_day_match_groups`，保存规则、`unmatched / pending_confirmation / matched` 状态、订单包净额、最新到账日期和认账锚点任务，并增加规则状态、锚点任务和最新到账日期索引。
- 新增 `multi_day_match_group_flows`，保存匹配组与银行流水的唯一关联及稳定顺序；同一银行流水只能属于一个多日匹配组。
- `order_files` 新增可空字段 `multi_day_match_group_id` 和索引 `of_multi_day_match_group_idx`。

### 迁移前检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM counterparty_records LIKE 'detail_matching_mode'; SHOW TABLES LIKE 'multi_day_match_groups'; SHOW TABLES LIKE 'multi_day_match_group_flows'; SHOW COLUMNS FROM order_files LIKE 'multi_day_match_group_id'; SHOW VARIABLES LIKE 'event_scheduler'; SHOW EVENTS WHERE Db = DATABASE() AND Name IN ('ev_bill_details_rolling_partitions','ev_bill_details_archive_old_daily_partitions');"
```

- 枚举没有 `多日汇总匹配`，两张新表和关联字段均不存在：可以执行 v10.45 迁移。
- 枚举、新表、字段和索引均已存在：不要重复执行迁移。
- 只有部分结构存在：停止部署，核查此前迁移中断原因。

### 执行迁移

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.45-multi-day-detail-matching.sql
```

两台测试服务器的登录、停止应用和部署命令以 `docs/DEPLOY_v10.45-local.md` 为准。

### 迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM counterparty_records LIKE 'detail_matching_mode'; SHOW CREATE TABLE multi_day_match_groups; SHOW CREATE TABLE multi_day_match_group_flows; SHOW COLUMNS FROM order_files LIKE 'multi_day_match_group_id'; SHOW INDEX FROM order_files WHERE Key_name = 'of_multi_day_match_group_idx'; SHOW EVENTS WHERE Db = DATABASE() AND Name IN ('ev_bill_details_rolling_partitions','ev_bill_details_archive_old_daily_partitions');"
```

确认枚举包含 `多日汇总匹配`，两张新表、关联字段、唯一约束和索引均存在；同时确认两个订单明细分区事件仍可用。

## 匹配规则

- 订单包上传完成后，在该到账信息的全部未认账流水中查找等额方案。
- 存在单笔等额方案时不再混入多笔组合；多个单笔等额方案同样进入待确认。
- 新增银行到账后，先尝试本次新增单笔，再尝试至少包含一笔新增流水的“新增 + 历史未认账”组合。
- 点击 `开始认账` 时，先尝试所选日期单笔，再尝试至少包含一笔所选日期流水的“当日 + 历史未认账”组合。
- 多个待匹配订单包按创建时间从早到晚处理；待确认候选不预占流水。
- 唯一方案绑定和人工确认均在事务内认领订单包及流水，避免并发重复占用。

## 验证结果

- `npm test` 通过：19 个测试文件、101 项测试。
- `npm test -- api/lib/orderUploadStream.test.ts` 通过：1 个测试文件、15 项测试。
- `npm run check` 通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- 本地数据库 `finance_recon_sandbox` 已执行 v10.45 迁移并复查枚举、新表、字段和索引。
- 发布包已生成并通过内容排除检查。

## 风险与回退

- 未执行 v10.45 迁移就部署代码，会因缺少匹配组表或 `order_files.multi_day_match_group_id` 导致多日匹配接口失败。
- 代码可使用 `releases/finance-platform-v10.44-local.tar.gz` 回退；新增表和字段可暂时保留。
- 回退前应停止新增多日订单包，并确认没有仍在 `流水未匹配`、`匹配待确认` 或已绑定的多日订单包，避免 v10.44 按旧模式处理多日配置。
- 如果只是代码回退，不建议立即删除 v10.45 表和字段；删除结构前必须先处理所有 `多日汇总匹配` 配置和匹配组数据。
- 本版本文档不提供数据库结构回退命令；如确需回退结构，应另行制定数据处理和结构恢复方案。
