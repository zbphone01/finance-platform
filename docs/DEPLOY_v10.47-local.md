# v10.47-local 部署说明

## 文件

- `releases/finance-platform-v10.47-local.tar.gz`：v10.47 部署包
- `migrate-v10.47-bank-accounts.sql`：v10.47 银行到账账号迁移
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.47-local.md`：版本快照

## 重要说明

- 本部署说明仅适用于从 v10.46 升级到 v10.47，只执行 `migrate-v10.47-bank-accounts.sql`。
- 已执行过的迁移不得重复执行；部署脚本不会自动执行 SQL，也不会执行 `drizzle schema push`。
- 迁移只创建银行账号档案表并为银行流水增加可空账号关联，不改写现有银行流水数据。
- 权限分组和新增权限键不需要数据库结构迁移；旧配置缺少新键时应用会使用兼容默认值。
- 检查、停止应用、迁移、迁移后检查、部署和最终验证必须逐步执行。

## 测试服务器1部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.47-local.tar.gz \
  migrate-v10.47-bank-accounts.sql \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 登录服务器

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
```

### 3. 迁移前检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'bank_accounts'; SHOW COLUMNS FROM bank_flows LIKE 'bank_account_id';"
```

- 表和字段均不存在：执行 v10.47 迁移。
- 表和字段均已存在：不要重复执行迁移，停止应用后直接部署代码。
- 只存在表或只存在字段：停止部署并核查此前迁移中断原因。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 执行数据库迁移

仅在迁移前确认表和字段均不存在时执行：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.47-bank-accounts.sql
```

### 6. 迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW CREATE TABLE bank_accounts; SHOW COLUMNS FROM bank_flows LIKE 'bank_account_id'; SHOW INDEX FROM bank_accounts WHERE Key_name = 'ba_bank_account_uq'; SHOW INDEX FROM bank_flows WHERE Column_name = 'bank_account_id'; SELECT COUNT(*) AS bank_account_count FROM bank_accounts;"
```

确认 `bank_accounts` 表存在，唯一索引依次包含 `bank_name`、`account_no`，`bank_account_id` 为可空 `BIGINT UNSIGNED`；`SHOW INDEX FROM bank_flows` 不应返回 `bank_account_id` 普通索引。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.47-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
```

## 测试服务器2部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.47-local.tar.gz \
  migrate-v10.47-bank-accounts.sql \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

### 2. 登录服务器

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
```

### 3. 迁移前检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'bank_accounts'; SHOW COLUMNS FROM bank_flows LIKE 'bank_account_id';"
```

- 表和字段均不存在：执行 v10.47 迁移。
- 表和字段均已存在：不要重复执行迁移，停止应用后直接部署代码。
- 只存在表或只存在字段：停止部署并核查此前迁移中断原因。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 执行数据库迁移

仅在迁移前确认表和字段均不存在时执行：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.47-bank-accounts.sql
```

### 6. 迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW CREATE TABLE bank_accounts; SHOW COLUMNS FROM bank_flows LIKE 'bank_account_id'; SHOW INDEX FROM bank_accounts WHERE Key_name = 'ba_bank_account_uq'; SHOW INDEX FROM bank_flows WHERE Column_name = 'bank_account_id'; SELECT COUNT(*) AS bank_account_count FROM bank_accounts;"
```

确认 `bank_accounts` 表存在，唯一索引依次包含 `bank_name`、`account_no`，`bank_account_id` 为可空 `BIGINT UNSIGNED`；`SHOW INDEX FROM bank_flows` 不应返回 `bank_account_id` 普通索引。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.47-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角显示 `v10.47`。
- 管理员功能的权限管理按 `删除权限 / 操作权限 / 菜单访问权限` 分组展示。
- 删除银行到账、取消制单分别受独立权限控制；关闭菜单访问权限后相应一级菜单隐藏，直接访问路由也被拦截。
- 入账汇总的年份、部门和汇总口径输入框等宽；部门选择后清空按钮位于下拉箭头左侧，箭头贴近右侧。
- `财务凭证信息` 下显示 `银行/到账账号`，空数据时页面正常打开。
- 手工新增工商银行账号后可以编辑账号、别称和默认状态；同一银行账号不能重复新增。
- 上传广发银行标准到账文件后，页面自动出现文件表头中的本方账号，来源显示为 `上传采集`，账号号码不可编辑，别称可以编辑。
- 重复上传已经存在的广发流水时不创建重复流水，但可以回填缺失的账号关联。
- 工商银行文件不含本方账号时，新增流水关联当前工商银行默认账号；未设置默认账号时上传不被阻断。
- 本版账号别称不改变新生成凭证的现有银行账户说明，已制单凭证快照也不变化。
- `npm run --silent db:events:ensure -- --check-only` 返回订单明细 Event 校验通过。

## 回退

- 代码可使用 `releases/finance-platform-v10.46-local.tar.gz` 回退。
- v10.47 新增 `bank_accounts` 表和 `bank_flows.bank_account_id` 可空字段可以暂时保留，旧代码不会访问。
- 新版已经保存的银行账号档案、别称和流水关联不会因代码回退自动删除。
- 新增权限键可以保留在 `role_permissions` 中，旧代码会忽略未知键。
- 本说明不提供数据库结构回退操作；删除字段或账号表前必须确认已经恢复旧代码且不再需要新版保存的数据。
