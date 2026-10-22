# v10.47-local 版本快照

## 发布范围

- `财务凭证信息` 新增二级菜单 `银行/到账账号`，集中展示银行到账账号、账号别称、来源和默认状态。
- 广发银行 `XLS/XLSX` 到账文件上传时读取交易表头之前的本方账号，账号始终按文本处理，避免 18 位账号精度或前导零丢失。
- 广发上传账号自动写入账号档案并关联银行流水；重复流水仍不重复创建，但允许回填原流水缺失的账号关联。
- 工商银行文件不含本方账号，支持在账号页面手工新增、编辑和设置默认账号；缺少账号信息的流水关联当前银行默认账号，未设置默认账号时允许保持空关联。
- `bank_flows.bank_name` 继续保留作为银行来源和空账号关联的兜底；本版不把账号别称接入制单，现有凭证银行账户说明保持不变。
- 账号管理的权限页面按 `删除权限 / 操作权限 / 菜单访问权限` 分组展示，并使用用户指定的权限名称。
- 删除银行到账与删除认账任务使用不同权限；取消制单与制单使用不同权限；旧权限配置缺少新键时沿用对应旧权限作为兼容默认值。
- `入账汇总`、`认账信息设置`、`财务凭证信息`、`管理员功能` 同时执行菜单隐藏与路由访问校验；入账汇总接口同步校验权限。
- 入账汇总的年份、部门和汇总口径三个筛选条件使用等宽布局；部门有选择时在下拉箭头左侧显示清空按钮，箭头保持贴近右侧。
- 右上角系统版本号更新为 `v10.47`。
- 部署包：`releases/finance-platform-v10.47-local.tar.gz`。

## 数据库与迁移

### 升级范围

- 当前迁移脚本为 `migrate-v10.47-bank-accounts.sql`。
- 本快照只记录从 v10.46 升级到 v10.47 所需的数据库变化。
- 必须先完成 v10.47 数据库迁移，再部署 v10.47 代码包；迁移脚本已执行时不得重复执行。
- 权限键继续存放在现有 `role_permissions.permission_key` 字符字段中，不需要额外数据库迁移。
- 本版不新增 npm 依赖、不调整运行配置、不执行 `drizzle schema push`，部署脚本也不会自动执行 SQL。

### 结构变化

- 新增 `bank_accounts` 表，字段包含银行名称、账号、账号别称、来源类型、默认状态以及创建/更新时间。
- `bank_accounts` 只新增组合唯一索引 `ba_bank_account_uq (bank_name, account_no)`，用于防止并发上传或手工维护生成重复账号。
- `bank_flows` 新增可空字段 `bank_account_id BIGINT UNSIGNED`，保存银行流水关联的账号档案 ID。
- 按当前账号数量和查询方式，本版不为 `bank_flows.bank_account_id` 新增普通索引，也不为别称、默认状态和更新时间新增索引。
- 本版不增加数据库外键；删除测试业务流水时保留 `bank_accounts` 配置数据。

### 迁移前检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'bank_accounts'; SHOW COLUMNS FROM bank_flows LIKE 'bank_account_id';"
```

- 表和字段均不存在：可以执行 v10.47 迁移。
- 表和字段均已存在：不要重复执行迁移。
- 只存在表或只存在字段：停止部署，核查此前迁移中断原因。

### 执行迁移

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.47-bank-accounts.sql
```

### 迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW CREATE TABLE bank_accounts; SHOW COLUMNS FROM bank_flows LIKE 'bank_account_id'; SHOW INDEX FROM bank_accounts WHERE Key_name = 'ba_bank_account_uq'; SHOW INDEX FROM bank_flows WHERE Column_name = 'bank_account_id'; SELECT COUNT(*) AS bank_account_count FROM bank_accounts;"
```

确认 `bank_accounts` 存在，唯一索引依次包含 `bank_name`、`account_no`，`bank_account_id` 为可空 `BIGINT UNSIGNED`，且 `bank_flows.bank_account_id` 没有普通索引。

## 本地迁移结果

- 本地数据库 `finance_recon_sandbox` 已成功执行 `migrate-v10.47-bank-accounts.sql`。
- `bank_accounts` 表、组合唯一索引和 `bank_flows.bank_account_id` 字段复查通过。
- 本地确认 `bank_flows.bank_account_id` 未创建普通索引。
- 迁移后账号档案初始数量为 `0`；后续由广发上传或手工维护生成。

## 验证结果

- 用户提供的广发旧版 `XLS` 样例成功解析完整 18 位本方账号。
- `npm run check` 通过。
- `npm test` 通过：22 个测试文件、109 项测试。
- `npm test -- api/lib/orderUploadStream.test.ts` 通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- 发布包已生成并通过内容排除检查。

## 风险与回退

- 未执行 v10.47 迁移就部署代码，打开银行账号页面或上传银行到账时会因缺少表或字段失败。
- 代码可使用 `releases/finance-platform-v10.46-local.tar.gz` 回退；新增表和可空字段可以暂时保留，旧代码不会访问。
- 使用新版上传后，`bank_accounts` 和 `bank_flows.bank_account_id` 会产生关联数据；紧急代码回退不会删除这些数据。
- 如果需要彻底回退结构，应先恢复 v10.46 代码并确认不再需要新版账号档案，再单独制定删除字段和账号表的 SQL，不在紧急回退中直接删除。
- 新增权限键可能已经写入 `role_permissions`；旧版代码会忽略未知权限键，可以保留。
- 账号别称本版只维护不参与制单，后续接入制单时应继续以已生成凭证的 `explanation_json` 快照为历史边界。
