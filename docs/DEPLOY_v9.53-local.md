# v9.53-local 部署说明

## 文件

- `releases/finance-platform-v9.53-local.tar.gz`：v9.53 部署包
- `docs/VERSION_SNAPSHOT_v9.53-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：项目技能文档，已更新到 v9.53

## 重要说明

- 本版无新增数据库迁移。
- 如果线上还没有执行 v9.51 迁移，需要先执行 `migrate-v9.51-counterparty-match-accounts.sql`。
- v9.53 主要包含：
  - 明细认账规则详情页增加条件搜索。
  - 单个明细认账条件改为整页编辑，只保存当前条件。
  - 入账结果宽表字号微调，日期汇总流水用途/附言支持换行。
  - 删除整日日期汇总任务时增加进度提示，并阻止重复删除。
  - 构建包优化：前端路由懒加载，后端外置常用服务端依赖。
- 推荐继续使用 `deploy-update-optimized.sh`，部署脚本不需要修改。
- 优化后的服务端构建运行时依赖服务器 `node_modules`，不要使用“只上传 dist 目录”的部署方式。

## 上传部署包

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.53-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

如果线上尚未执行 v9.51 迁移，一并上传：

```bash
scp migrate-v9.51-counterparty-match-accounts.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

## 可选迁移检查

仅当线上尚未升级 v9.51 时执行：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'counterparty_match_accounts';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.51-counterparty-match-accounts.sql
```

如果 `counterparty_match_accounts` 已存在，不要重复执行迁移。

## 部署

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.53-local.tar.gz
```

如果服务器依赖状态异常：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.53-local.tar.gz
```

如需在线上强制执行类型检查：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.53-local.tar.gz
```

## 部署后检查

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

浏览器访问：

```text
http://server1.example.com:3001/
```

## 功能验证

- 进入明细认账规则详情页，按关键字搜索后应只显示命中的条件。
- 点击某个条件的“编辑条件”，应进入整页编辑；保存后只更新当前条件。
- 进入入账结果的入账明细，宽表字段字号应更紧凑，预算编码应为正常字号。
- 进入日期汇总任务详情，银行流水用途或附言较长时应能换行看全。
- 删除某个日期汇总任务时，应显示删除进度；删除完成前不能再次删除当前或其他日期。
- 部署后首屏正常打开，明细认账规则、入账结果、认账及分账页面均可正常进入。
