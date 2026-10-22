# v10.49-local 部署说明

## 文件

- `releases/finance-platform-v10.49-local.tar.gz`：包含预构建 `dist/` 的 v10.49 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.49-local.md`：版本快照

## 重要说明

- 本说明仅适用于从 v10.48 升级到 v10.49；更早版本先按对应历史部署说明补齐到 v10.48。
- 本版本没有新增数据库迁移脚本，不执行 SQL，也不执行 `drizzle schema push`。
- v10.48 的 `migrate-v10.48-archive-index-canary.sql` 和 `migrate-v10.48-archive-index-finalize.sql` 继续按 `docs/DEPLOY_v10.48-local.md` 独立判断和执行，不能因为部署 v10.49 跳过灰度观察或连续执行两个脚本。
- 部署包必须包含本地验证通过的 `dist/boot.js`、`dist/public/index.html` 和前端资源；部署脚本不会在服务器执行 `npm run build`。
- 部署脚本先在独立暂存目录校验产物、依赖、数据库连接和 MySQL Event，再使用本轮固定备份原子切换 `dist`；异常中断或健康检查失败时恢复本轮部署前产物。
- 锁文件未变化时复用现有 `node_modules`；锁文件变化或依赖缺失时，在暂存目录执行 `npm ci --omit=dev`，校验后再切换运行依赖。
- 历史利息模板中的 `【利息信息】` 会在页面读取和服务端渲染时清空；部署后需检查利息模板摘要，确认删除旧占位符后仍为完整文案。

## 测试服务器1部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.49-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 登录服务器

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
```

### 3. 数据库前置检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'bank_accounts'; SHOW COLUMNS FROM bank_flows LIKE 'bank_name'; SHOW COLUMNS FROM bank_flows LIKE 'bank_account_id'; SHOW TABLES LIKE 'voucher_template_settings';"
```

确认四项均有返回。缺少任一表或字段时停止部署，先按 v10.47、v10.48 对应部署说明补齐前置版本。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 数据库迁移

v10.49 无新增数据库迁移，本步骤不执行 SQL。

### 6. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.49-local.tar.gz
```

### 7. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 curl 返回成功、页面右上角显示 `v10.49`，且部署后日志没有新增 `dist/public/index.html` 缺失、数据库字段缺失或启动失败错误。

## 测试服务器2部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.49-local.tar.gz \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

### 2. 登录服务器

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
```

### 3. 数据库前置检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'bank_accounts'; SHOW COLUMNS FROM bank_flows LIKE 'bank_name'; SHOW COLUMNS FROM bank_flows LIKE 'bank_account_id'; SHOW TABLES LIKE 'voucher_template_settings';"
```

确认四项均有返回。缺少任一表或字段时停止部署，先按 v10.47、v10.48 对应部署说明补齐前置版本。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 数据库迁移

v10.49 无新增数据库迁移，本步骤不执行 SQL。

### 6. 部署代码

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.49-local.tar.gz
```

### 7. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 curl 返回成功、页面右上角显示 `v10.49`，且部署后日志没有新增 `dist/public/index.html` 缺失、数据库字段缺失或启动失败错误。

## 功能验证

- 页面右上角显示 `v10.49`。
- 上传广发银行、工商银行和中国银行文件时均按表头识别；中国银行只入库交易金额为正数的行。
- 中国银行账号可以在“财务凭证信息 / 银行/到账账号”中手工维护并设置默认账号。
- 删除未匹配银行到账的多日汇总订单明细包不再出现占位日期 SQL 错误；已匹配订单包删除仍正常回算相关任务。
- 凭证模板变量说明显示 `【银行】`、`【季度】`，不显示 `【利息信息】`。
- 利息逐笔制单不填写摘要内容时使用模板；填写后仅摘要变化，科目编码、科目名称和借贷金额仍按模板生成。
- 批量制单可以直接按模板生成利息凭证，不再提示填写利息信息。
- 操作指引显示五个最新章节及对应步骤。
- 历史凭证继续读取原快照，不因模板变量调整自动重算。

## 回退

- 代码可以使用 `releases/finance-platform-v10.48-local.tar.gz` 回退；本版没有数据库结构变化，无需数据库回滚。
- 单次部署在切换前会把旧运行产物保留为 `backups/dist.rollback.<部署批次>`；启动或健康检查失败时脚本自动恢复该固定回滚点。
- 自动回滚失败时停止重复部署，保留 `dist.failed.<部署批次>` 并人工核查。
- v10.49 保存的凭证模板 JSON 和生成的凭证快照不会因代码回退自动删除；回退前确认是否已使用 `【银行】`、`【季度】`或自定义利息摘要生成新凭证。
- v10.48 归档索引灰度或正式清理若已执行，不能通过代码回退撤销；仍按 `docs/DEPLOY_v10.48-local.md` 的数据库回退原则处理。
