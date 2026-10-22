# v10.51-local 部署说明

## 文件

- `releases/finance-platform-v10.51-local.tar.gz`：包含预构建 `dist/` 的 v10.51 部署包
- `migrate-v10.51-counterparty-match-bank.sql`：到账信息匹配银行字段迁移
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.51-local.md`：版本快照

## 重要说明

- 本说明仅适用于从 v10.50 升级到 v10.51；更早版本先按对应历史部署说明补齐到 v10.50。
- 本版必须执行 `migrate-v10.51-counterparty-match-bank.sql`；脚本为三张到账信息表新增可空 `bank_name`，不执行 `drizzle schema push`。
- 执行前必须检查三个字段是否存在：全部不存在时执行迁移；全部存在时说明迁移已完成，不得重复执行；只存在一个或两个时必须停止部署并排查部分迁移。
- 部署包必须包含本地验证通过的 `dist/boot.js`、`dist/public/index.html` 和前端资源；部署脚本不会在服务器执行 `npm run build`。
- 部署脚本先在独立暂存目录校验产物、依赖、数据库连接和 MySQL Event，再使用本轮固定备份原子切换 `dist`；异常中断或健康检查失败时恢复本轮部署前产物。
- 锁文件未变化时复用现有 `node_modules`；锁文件变化或依赖缺失时，在暂存目录执行 `npm ci --omit=dev`，校验后再切换运行依赖。
- v10.48 的月归档索引灰度和正式清理继续按 `docs/DEPLOY_v10.48-local.md` 独立判断和执行。

## 测试服务器1部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.51-local.tar.gz \
  migrate-v10.51-counterparty-match-bank.sql \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 登录服务器

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
```

### 3. 数据库迁移前检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('counterparty_records','counterparty_match_accounts','unrecorded_counterparties') ORDER BY TABLE_NAME; SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('counterparty_records','counterparty_match_accounts','unrecorded_counterparties') AND COLUMN_NAME = 'bank_name' ORDER BY TABLE_NAME;"
```

第一个查询必须返回三张表。第二个查询无返回时继续执行迁移；返回三行时确认字段均为 `varchar(50)`、`IS_NULLABLE=YES`、默认值为 `NULL`，并跳过第 5 步 SQL；只返回一行或两行时停止部署。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 数据库迁移

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.51-counterparty-match-bank.sql
```

### 6. 数据库迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM counterparty_records LIKE 'bank_name'; SHOW COLUMNS FROM counterparty_match_accounts LIKE 'bank_name'; SHOW COLUMNS FROM unrecorded_counterparties LIKE 'bank_name';"
```

必须返回三个 `bank_name`，类型均为 `varchar(50)`，允许 `NULL`，默认值为 `NULL`。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.51-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 curl 返回成功、页面右上角显示 `v10.51`，且部署后日志没有新增预构建产物缺失、`bank_name` 字段缺失或启动失败错误。

## 测试服务器2部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.51-local.tar.gz \
  migrate-v10.51-counterparty-match-bank.sql \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

### 2. 登录服务器

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
```

### 3. 数据库迁移前检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('counterparty_records','counterparty_match_accounts','unrecorded_counterparties') ORDER BY TABLE_NAME; SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('counterparty_records','counterparty_match_accounts','unrecorded_counterparties') AND COLUMN_NAME = 'bank_name' ORDER BY TABLE_NAME;"
```

第一个查询必须返回三张表。第二个查询无返回时继续执行迁移；返回三行时确认字段均为 `varchar(50)`、`IS_NULLABLE=YES`、默认值为 `NULL`，并跳过第 5 步 SQL；只返回一行或两行时停止部署。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 数据库迁移

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.51-counterparty-match-bank.sql
```

### 6. 数据库迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM counterparty_records LIKE 'bank_name'; SHOW COLUMNS FROM counterparty_match_accounts LIKE 'bank_name'; SHOW COLUMNS FROM unrecorded_counterparties LIKE 'bank_name';"
```

必须返回三个 `bank_name`，类型均为 `varchar(50)`，允许 `NULL`，默认值为 `NULL`。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.51-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 curl 返回成功、页面右上角显示 `v10.51`，且部署后日志没有新增预构建产物缺失、`bank_name` 字段缺失或启动失败错误。

## 功能验证

- 页面右上角显示 `v10.51`。
- 到账信息汇总页面的“新增到账信息”与已记录/未记录同行并右对齐，到账银行下拉框与其他输入框等宽。
- 新增或编辑到账信息时，到账银行可选广发银行、工商银行和中国银行；银行、账号、户名、摘要、用途和附言每组至少填写一项。
- 分别建立银行加摘要关键字的利息到账信息并关联到账认账规则后，无对方账号和户名的对应银行利息流水能按银行及摘要命中；不同银行不串规则。
- 历史到账信息的银行为空并继续不限制银行，原有账号、户名、摘要、用途和附言匹配行为不变。
- 到账认账规则已选支出资金来源后切换反馈类型，资金来源不被清空。
- iPhone/Safari 访问凭证详情页，点击“取消凭证”能显示平台确认框；返回不会取消凭证，确认后按原流程取消。
- 入账结果的入账明细收入类型筛选包含捐赠收入、会费收入、政府补助、个税返还、本金、投资收益、利息、其他收入、其他和订单退款，各选项能返回对应类型。

## 回退

- 代码可使用 `releases/finance-platform-v10.50-local.tar.gz` 回退；三个新增 `bank_name` 字段可以保留，v10.50 不会读取它们，不建议为了代码回退删列。
- 如 v10.51 已新建相同摘要、不同银行的到账信息和认账规则，回退到 v10.50 前必须先停用这些规则；v10.50 忽略银行条件，否则可能跨银行命中。
- 单次部署在切换前会把旧运行产物保留为 `backups/dist.rollback.<部署批次>`；启动或健康检查失败时脚本自动恢复该固定回滚点。
- 自动回滚失败时停止重复部署，保留 `dist.failed.<部署批次>` 并人工核查。
- v10.48 归档索引灰度或正式清理若已执行，不能通过代码回退撤销；仍按 `docs/DEPLOY_v10.48-local.md` 的数据库回退原则处理。
