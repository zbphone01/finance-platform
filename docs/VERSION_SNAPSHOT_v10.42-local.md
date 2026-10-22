# v10.42-local 版本快照

## 发布范围

- 到账信息汇总的多组匹配条件新增“摘要”关键字，到账认账、明细认账和未记录到账识别统一按摘要参与匹配。
- “账号管理”菜单更名为“管理员功能”，页面新增“账号管理 / 系统信息”一级页签；系统信息以饼图展示每日订单明细归档后的最新数据盘使用量。
- 数据盘使用量只保留一条最新快照，不保存历史记录；归档成功后由数据库发起采集请求，Node 服务读取操作系统磁盘容量并覆盖更新。
- 银行流水进入手动认账时，固定在右侧的“差额金额”和“状态”两列同步显示选中行蓝色背景。
- 取消凭证后重新制单时，凭证详情缓存立即失效；每次进入凭证详情均重新查询，凭证汇总与详情不再短暂显示不同凭证 ID。
- 右上角系统版本号更新为 `v10.42`。
- 部署包：`releases/finance-platform-v10.42-local.tar.gz`。

## 到账信息摘要匹配

- `counterparty_records`、`counterparty_match_accounts` 和 `unrecorded_counterparties` 增加摘要字段，历史记录统一为空，不从历史银行流水回填。
- 摘要、用途和附言均为选填；未填写的字段不参与判断，填写后按关键词包含匹配。
- 多组匹配条件的去重、同步、未记录到账识别和规则优先级均包含摘要，避免前后端匹配口径不一致。
- 已记录到账信息列表在对方户名后展示摘要；多组条件继续在账号、户名、摘要、用途和附言列显示 `-`。

## 最新数据盘快照

- `system_storage_snapshot` 通过 `id = 1` 保证只保留最新状态和快照，不累计 30 天历史。
- 每日归档事件改为调用 `archive_bill_details_daily_with_storage_request`；原归档过程成功返回后才将快照行置为待采集。
- Node 服务启动 30 秒后首次检查，之后最多每 5 分钟处理一次待采集请求；采集失败时保留上一次成功容量数据并记录错误。
- 统计路径由 `DATA_DISK_PATH` 指定，默认 `/`。部署时应配置为 MySQL 数据盘所在挂载点。
- “管理员功能 > 系统信息”展示总容量、已占用、可用、使用率、统计路径、统计时间和对应归档日期，沿用 `account_management_menu_access` 权限。

## 凭证详情一致性

- 凭证详情仍按银行流水 ID 读取当前生成凭证，但取消和单笔/批量重新生成后会主动失效对应详情缓存。
- 详情页设置为每次挂载重新查询，避免全局 60 秒缓存继续展示已经删除的旧凭证。
- 数据库取消和重新生成事务逻辑不变，本次不修改凭证业务数据结构。

## 数据库、配置与依赖

- 先执行 `migrate-v10.41-counterparty-match-summary.sql`，再执行 `migrate-v10.42-latest-system-storage-snapshot.sql`，最后部署代码包。
- 执行 v10.42 前必须确认 `archive_bill_details_daily()` 已存在且 MySQL `event_scheduler = ON`。
- `.env` 增加可选配置 `DATA_DISK_PATH`；线上建议明确配置，不依赖默认根分区。
- 本版不新增 npm 依赖，不执行 `drizzle schema push`。

## 验证结果

- `npm run check` 通过。
- `npm test -- api/lib/counterpartyMatchers.test.ts api/lib/diskUsageSnapshot.test.ts` 通过：2 个测试文件、7 项测试。
- `npm run build` 通过。
- `git diff --check` 通过。
- 发布包已生成并通过内容排除检查。
