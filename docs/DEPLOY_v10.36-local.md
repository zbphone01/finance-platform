# v10.36-local 部署说明

## 文件

- `releases/finance-platform-v10.36-local.tar.gz`：v10.36 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.36-local.md`：版本快照

## 重要说明

- 从 v10.35、v10.34、v10.33 或 v10.32 升级到 v10.36 不需要执行 SQL 迁移，直接部署代码包。
- 从 v10.31 升级时，必须先执行 `migrate-v10.32-manual-income-vouchers.sql` 补齐 v10.32 数据库结构，再部署 v10.36。
- 更旧环境先按历史部署说明逐版补齐至 v10.32。
- 本版不新增依赖，不执行 `drizzle schema push`。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.36-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
df -h / /var/lib/mysql
./deploy-update-optimized.sh finance-platform-v10.36-local.tar.gz
pm2 status
pm2 logs finance-platform --lines 120
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.36-local.tar.gz \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
df -h / /var/lib/mysql
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.36-local.tar.gz
pm2 status
pm2 logs finance-platform --lines 120
```

## 旧版本补迁移

- v10.35、v10.34、v10.33、v10.32 环境没有本版迁移脚本。
- v10.31 环境先按 `docs/DEPLOY_v10.34-local.md` 的“v10.31 环境补迁移”章节检查并执行 `migrate-v10.32-manual-income-vouchers.sql`。
- v10.30 或更旧环境先按对应历史部署说明补齐数据库迁移，再部署 v10.36。

## 功能验证

- 页面右上角版本号显示 `v10.36`。
- 部分认账任务没有待拆分订单时，推荐转移金额应等于待认账金额。
- 存在待拆分订单时，弹窗应显示待认账金额、待拆分订单金额及两者相减后的推荐转移金额，并按推荐金额匹配已忽略订单。
- 待认账金额与待拆分订单金额一致时，不显示候选，提示“无推荐转移订单，请进行明细分账完成认账”。
- 待拆分订单金额大于待认账金额时，不显示候选并提示先完成明细分账。
- 确认提交前若待拆分金额发生变化，服务端应按最新推荐金额拒绝过期选择。
- 本地实例 `2026-05-09 / 803312503175` 应按同日汇总匹配组任务 `20、21、36` 读取 44 条、合计 `281.00` 的待拆分订单，弹窗显示待拆分金额 `281.00` 并提示完成明细分账。

## 回退

- v10.36 没有数据库迁移；代码可直接使用 v10.35 部署包回退。
- 回退后恢复为按完整待认账金额匹配已忽略订单；v10.36 已完成的订单转移和认账属于业务数据，不会随代码回退自动撤销。
