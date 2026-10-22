# v9.52-local 部署说明

## 文件

- `releases/finance-platform-v9.52-local.tar.gz`：v9.52 部署包
- `docs/VERSION_SNAPSHOT_v9.52-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：项目技能文档，已更新到 v9.52

## 重要说明

- 本版无新增数据库迁移。
- 如果线上还没有执行 v9.51 迁移，需要先执行 `migrate-v9.51-counterparty-match-accounts.sql`。
- v9.52 主要优化明细认账性能：
  - 上传预匹配固定 `等于` 优先、`包含` 兜底。
  - 手动开始认账补匹配同样固定 `等于` 优先。
  - 认账队列按任务去重。
  - 同日汇总明细认账改为按条件、按批次读取明细。
  - 单笔匹配达到阈值后才走按条件批量回写。

## 上传部署包

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.52-local.tar.gz \
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
./deploy-update-optimized.sh finance-platform-v9.52-local.tar.gz
```

如果服务器依赖状态异常：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.52-local.tar.gz
```

如需在线上强制执行类型检查：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.52-local.tar.gz
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

- 明细认账规则中同时存在 `等于` 和 `包含` 条件时，即使 `包含` 条件录入在前，上传订单明细也应优先命中 `等于` 条件。
- 对历史未匹配明细点击“开始认账”，补匹配应同样优先命中 `等于` 条件。
- 连续上传同一日期、同一到账信息的明细包或重复点击“开始认账”时，后台不应重复执行同一个等待中的认账任务。
- 同日汇总匹配的大明细包应能进入认账队列并完成，过程中不应因一次性加载全部明细导致服务内存明显升高。
- 单笔匹配小数据量仍应正常生成入账结果；大数据量条件应能批量生成入账结果并回写明细。
