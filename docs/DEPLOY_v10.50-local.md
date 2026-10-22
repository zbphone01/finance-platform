# v10.50-local 部署说明

## 文件

- `releases/finance-platform-v10.50-local.tar.gz`：包含预构建 `dist/` 的 v10.50 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.50-local.md`：版本快照

## 重要说明

- 本说明仅适用于从 v10.49 升级到 v10.50；更早版本先按对应历史部署说明补齐到 v10.49。
- 本版本没有新增数据库迁移脚本，不执行 SQL，也不执行 `drizzle schema push`。
- v10.48 的月归档索引灰度和正式清理继续按 `docs/DEPLOY_v10.48-local.md` 独立判断和执行。
- 部署包必须包含本地验证通过的 `dist/boot.js`、`dist/public/index.html` 和前端资源；部署脚本不会在服务器执行 `npm run build`。
- 部署脚本先在独立暂存目录校验产物、依赖、数据库连接和 MySQL Event，再使用本轮固定备份原子切换 `dist`；异常中断或健康检查失败时恢复本轮部署前产物。
- 锁文件未变化时复用现有 `node_modules`；锁文件变化或依赖缺失时，在暂存目录执行 `npm ci --omit=dev`，校验后再切换运行依赖。

## 测试服务器1部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.50-local.tar.gz \
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
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'bank_accounts'; SHOW COLUMNS FROM bank_accounts LIKE 'account_alias'; SHOW TABLES LIKE 'voucher_template_settings';"
```

确认三项均有返回。缺少任一表或字段时停止部署，先按 v10.47 至 v10.49 对应部署说明补齐前置版本。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 数据库迁移

v10.50 无新增数据库迁移，本步骤不执行 SQL。

### 6. 数据库迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'bank_accounts'; SHOW COLUMNS FROM bank_accounts LIKE 'account_alias'; SHOW TABLES LIKE 'voucher_template_settings';"
```

确认结果与迁移前一致；本版不会新增或修改数据库结构。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.50-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 curl 返回成功、页面右上角显示 `v10.50`，且部署后日志没有新增预构建产物缺失、数据库字段缺失或启动失败错误。

## 测试服务器2部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.50-local.tar.gz \
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
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'bank_accounts'; SHOW COLUMNS FROM bank_accounts LIKE 'account_alias'; SHOW TABLES LIKE 'voucher_template_settings';"
```

确认三项均有返回。缺少任一表或字段时停止部署，先按 v10.47 至 v10.49 对应部署说明补齐前置版本。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 数据库迁移

v10.50 无新增数据库迁移，本步骤不执行 SQL。

### 6. 数据库迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'bank_accounts'; SHOW COLUMNS FROM bank_accounts LIKE 'account_alias'; SHOW TABLES LIKE 'voucher_template_settings';"
```

确认结果与迁移前一致；本版不会新增或修改数据库结构。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.50-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 curl 返回成功、页面右上角显示 `v10.50`，且部署后日志没有新增预构建产物缺失、数据库字段缺失或启动失败错误。

## 功能验证

- 页面右上角显示 `v10.50`。
- 中国银行流水备注非空时摘要取备注；备注为空或只有空格时摘要取业务类型。
- 在低高度窗口展开全部一级菜单，菜单列表可滚动且滚动条隐藏，顶部标题和底部用户区保持固定。
- 利息逐笔制单不填写摘要内容时，弹窗显示按当前模板和流水信息生成的摘要；填写后显示输入内容，正式凭证摘要与弹窗一致。
- 凭证模板变量说明按银行流水口径展示到账户名、银行、到账月份和季度。
- “银行/到账账号”列表及编辑弹窗显示“凭证名称”，原有名称数据和凭证银行账户取值不变。
- 入账明细中，会费收入、政府补助、个税返还、本金、投资收益、利息、其他收入和其他的项目资金、管理费显示 `-`；捐赠收入和订单退款仍显示金额。
- 历史凭证继续读取原快照，不因模板或文案调整自动重算。

## 回退

- 代码可以使用 `releases/finance-platform-v10.49-local.tar.gz` 回退；本版没有数据库结构变化，无需数据库回滚。
- 单次部署在切换前会把旧运行产物保留为 `backups/dist.rollback.<部署批次>`；启动或健康检查失败时脚本自动恢复该固定回滚点。
- 自动回滚失败时停止重复部署，保留 `dist.failed.<部署批次>` 并人工核查。
- 回退后，中国银行摘要兜底、利息摘要预览、菜单滚动和新版展示文案会恢复为 v10.49 行为；数据库数据不会变化。
- v10.48 归档索引灰度或正式清理若已执行，不能通过代码回退撤销；仍按 `docs/DEPLOY_v10.48-local.md` 的数据库回退原则处理。
