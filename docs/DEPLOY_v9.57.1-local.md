# v9.57.1-local 部署说明

## 文件

- `releases/finance-platform-v9.57.1-local.tar.gz`：v9.57.1 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `migrate-v9.57-detail-split-enabled.sql`：明细分账开关迁移，已执行过 v9.57 可跳过
- `docs/VERSION_SNAPSHOT_v9.57.1-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：项目技能文档，已更新到 v9.57.1

## 重要说明

- 本版替代 v9.57-local 部署包；线上部署时上传 v9.57.1 包即可。
- 本版不新增数据库字段；如果目标环境已经执行过 `migrate-v9.57-detail-split-enabled.sql`，不要重复执行。
- 如果目标环境尚未部署 v9.57 系列，需先执行 `migrate-v9.57-detail-split-enabled.sql`。

## 本地迁移检查

```bash
cd /home/deploy/Documents/资金池认账
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM recognition_rules LIKE 'detail_split_enabled';"
```

## 线上部署

上传部署包和部署脚本：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.57.1-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.57-detail-split-enabled.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

登录服务器：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
```

检查迁移状态：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_rules LIKE 'detail_split_enabled';"
```

如字段不存在，执行迁移：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.57-detail-split-enabled.sql
```

部署代码：

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.57.1-local.tar.gz
```

如果服务器依赖状态异常：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.57.1-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 直接打开打包明细单文件详情 URL，例如 `/order-files/300`，顶部订单总金额应显示整包汇总，而不是单文件金额。
- 从 `订单明细包` 列表进入 `订单明细内容`，整包视图顶部 `订单总金额` 应与整包所有文件合计一致。
- 上传金额为 `0.01` 的打包订单明细，应显示为 `已完成`，不应被标记为 `异常`。
