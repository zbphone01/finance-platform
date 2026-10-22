# v9.51-local 部署说明

## 文件

- `releases/finance-platform-v9.51-local.tar.gz`：v9.51 部署包
- `migrate-v9.51-counterparty-match-accounts.sql`：v9.51 数据库迁移
- `docs/VERSION_SNAPSHOT_v9.51-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：项目技能文档，已更新到 v9.51

## 重要说明

- v9.51 新增到账信息多组匹配条件表，部署代码前必须先执行迁移。
- 迁移会把历史 `counterparty_records` 中的账号、户名、用途、附言初始化为每条到账信息的第一组匹配条件。
- 如果已在本地或线上执行过迁移，重复执行不会重复插入同一到账信息的初始化记录。
- v9.51 修复同日汇总明细认账多条银行流水只绑定首条任务规则的问题，并调整汇总认账金额分配逻辑。

## 上传部署包

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.51-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.51-counterparty-match-accounts.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

## 执行迁移

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.51-counterparty-match-accounts.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW TABLES LIKE 'counterparty_match_accounts';"
```

## 部署

```bash
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.51-local.tar.gz
```

如果服务器依赖状态异常：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.51-local.tar.gz
```

如需在线上强制执行类型检查：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.51-local.tar.gz
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

- 进入 `到账信息汇总`，编辑一条到账信息，应能看到并维护多组匹配条件。
- 新建或编辑支付宝到账信息，增加多个对方账号匹配条件后，上传对应订单明细包，应能命中同日多条支付宝到账流水。
- 进入 `认账及分账`，对同日汇总匹配的明细认账重新执行：
  - 前序小额银行流水应按流水金额认满并显示已认账。
  - 最后一条大额银行流水如果到账金额大于剩余订单明细金额，应显示部分认账。
  - 已匹配的订单明细应全部关联认账结果。
- 认账任务执行过程中，银行流水列表应能显示“认账执行中”。
- 如果后台认账失败，任务应显示失败，不应一直停留在认账执行中。
