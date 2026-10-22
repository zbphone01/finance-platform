# v10.52-local 部署说明

## 文件

- `releases/finance-platform-v10.52-local.tar.gz`：包含预构建 `dist/` 的 v10.52 部署包
- `migrate-v10.52-income-rule-split-form.sql`：到账认账规则分账形式迁移
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.52-local.md`：版本快照

## 重要说明

- 本说明仅适用于从 v10.51 升级到 v10.52；更早版本先按对应历史部署说明补齐到 v10.51。
- 本版必须检查并按需执行 `migrate-v10.52-income-rule-split-form.sql`；脚本为 `income_rule_splits` 新增 `split_form`，不执行 `drizzle schema push`。
- 迁移脚本不是可重复执行脚本：字段不存在时执行；字段已存在且结构正确时跳过；字段存在但类型、非空约束或默认值不一致时停止部署并排查。
- 部署包必须包含本地验证通过的 `dist/boot.js`、`dist/public/index.html` 和前端资源；部署脚本不会在服务器执行 `npm run build`。
- 部署脚本先在独立暂存目录校验产物、依赖、数据库连接和 MySQL Event，再使用本轮固定备份原子切换 `dist`；异常中断或健康检查失败时恢复本轮部署前产物。
- 锁文件未变化时复用现有 `node_modules`；锁文件变化或依赖缺失时，在暂存目录执行 `npm ci --omit=dev`，校验后再切换运行依赖。
- v10.48 的月归档索引灰度和正式清理继续按 `docs/DEPLOY_v10.48-local.md` 独立判断和执行。

## 测试服务器1部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.52-local.tar.gz \
  migrate-v10.52-income-rule-split-form.sql \
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
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'income_rule_splits'; SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'income_rule_splits' AND COLUMN_NAME = 'split_form';"
```

第一个查询必须返回 `income_rule_splits`。第二个查询无返回时继续执行迁移；返回一行时确认类型为 `enum('百分比','认账时填写')`、`IS_NULLABLE=NO`、默认值为 `百分比`，并跳过第 5 步 SQL；字段存在但结构不一致时停止部署。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 数据库迁移

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.52-income-rule-split-form.sql
```

### 6. 数据库迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM income_rule_splits LIKE 'split_form'; SELECT split_form,COUNT(*) AS row_count FROM income_rule_splits GROUP BY split_form ORDER BY split_form;"
```

必须确认 `split_form` 类型为 `enum('百分比','认账时填写')`、不允许 `NULL`、默认值为 `百分比`。首次迁移后历史记录应全部统计为百分比。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.52-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 curl 返回成功、页面右上角显示 `v10.52`，且部署后日志没有新增预构建产物缺失、`split_form` 字段缺失或启动失败错误。

## 测试服务器2部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.52-local.tar.gz \
  migrate-v10.52-income-rule-split-form.sql \
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
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'income_rule_splits'; SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'income_rule_splits' AND COLUMN_NAME = 'split_form';"
```

第一个查询必须返回 `income_rule_splits`。第二个查询无返回时继续执行迁移；返回一行时确认类型为 `enum('百分比','认账时填写')`、`IS_NULLABLE=NO`、默认值为 `百分比`，并跳过第 5 步 SQL；字段存在但结构不一致时停止部署。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 数据库迁移

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.52-income-rule-split-form.sql
```

### 6. 数据库迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM income_rule_splits LIKE 'split_form'; SELECT split_form,COUNT(*) AS row_count FROM income_rule_splits GROUP BY split_form ORDER BY split_form;"
```

必须确认 `split_form` 类型为 `enum('百分比','认账时填写')`、不允许 `NULL`、默认值为 `百分比`。首次迁移后历史记录应全部统计为百分比。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.52-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 curl 返回成功、页面右上角显示 `v10.52`，且部署后日志没有新增预构建产物缺失、`split_form` 字段缺失或启动失败错误。

## 功能验证

- 页面右上角显示 `v10.52`。
- 新建或编辑到账认账规则时，“分账形式”可选择百分比或认账时填写；新增分账自动沿用第一条分账的形式且不能混用。
- 百分比规则仍要求比例合计为 100%，保存并命中流水后自动认账。
- 认账时填写规则命中流水后，银行流水保持待认账；点击后显示金额区、收款渠道和分账金额列表，不显示顶部认账金额输入框。
- 分账列表按部门、NC 项目名称、预算编码、认账金额展示；金额允许留空，并自动汇总到金额区。
- 认账金额合计等于可认账金额时可以确认；不相等时明确提示且不生成入账结果。
- 到账认账规则选择 `捐赠收入-银行直捐` 时不显示地区选择；认账结果地区取匹配到账信息的渠道认账地区。
- 会费收入和拍卖等其他需要地区的规则仍显示并校验地区。
- 凭证详情页点击“取消凭证”时，确认框只显示确认标题、返回和确认按钮。

## 回退

- 代码可使用 `releases/finance-platform-v10.51-local.tar.gz` 回退；新增 `split_form` 字段可以保留，v10.51 不会读取它，不建议删列。
- 回退前先查询认账时填写规则：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT DISTINCT r.id,r.rule_name,r.is_active FROM income_recognition_rules r JOIN income_rule_splits s ON s.income_rule_id=r.id WHERE s.split_form='认账时填写' ORDER BY r.id;"
```

- 如有返回，必须先停用这些规则并完成人工核对，避免 v10.51 按 `split_ratio=0` 处理：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "UPDATE income_recognition_rules r JOIN income_rule_splits s ON s.income_rule_id=r.id SET r.is_active=0 WHERE s.split_form='认账时填写';"
```

- 回退前按到账信息地区回填银行直捐分账地区：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "UPDATE income_rule_splits s JOIN income_recognition_rules r ON r.id=s.income_rule_id JOIN counterparty_records c ON c.alias=r.matched_counterparty_alias SET s.region=c.arrival_region WHERE s.income_type='捐赠收入' AND s.donation_source='银行直捐' AND s.region IS NULL AND c.arrival_region IS NOT NULL;"
```

- 单次部署在切换前会把旧运行产物保留为 `backups/dist.rollback.<部署批次>`；启动或健康检查失败时脚本自动恢复该固定回滚点。
- 自动回滚失败时停止重复部署，保留 `dist.failed.<部署批次>` 并人工核查。
- v10.48 归档索引灰度或正式清理若已执行，不能通过代码回退撤销；仍按 `docs/DEPLOY_v10.48-local.md` 的数据库回退原则处理。
