# v10.35-local 部署说明

## 文件

- `releases/finance-platform-v10.35-local.tar.gz`：v10.35 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.35-local.md`：版本快照

## 重要说明

- 从 v10.34、v10.33 或 v10.32 升级到 v10.35 不需要执行 SQL 迁移，直接部署代码包。
- 从 v10.31 升级时，必须先执行 `migrate-v10.32-manual-income-vouchers.sql` 补齐 v10.32 数据库结构，再部署 v10.35。
- 更旧环境先按历史部署说明逐版补齐至 v10.32。
- 本版不新增依赖，不执行 `drizzle schema push`。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.35-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
df -h / /var/lib/mysql
./deploy-update-optimized.sh finance-platform-v10.35-local.tar.gz
pm2 status
pm2 logs finance-platform --lines 120
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.35-local.tar.gz \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
df -h / /var/lib/mysql
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.35-local.tar.gz
pm2 status
pm2 logs finance-platform --lines 120
```

## 旧版本补迁移

- v10.34、v10.33、v10.32 环境没有本版迁移脚本。
- v10.31 环境先按 `docs/DEPLOY_v10.34-local.md` 的“v10.31 环境补迁移”章节检查并执行 `migrate-v10.32-manual-income-vouchers.sql`。
- v10.30 或更旧环境先按对应历史部署说明补齐数据库迁移，再部署 v10.35。

## 功能验证

- 页面右上角版本号显示 `v10.35`。
- 点击日期汇总银行流水的异常差额，系统先尝试单条等额忽略和纯忽略组合。
- 当前明细无法直接抹平时，弹窗显示“建议忽略的订单”和“建议转移的订单”两个区域。
- 差额 `0.41` 且存在当前订单 `2.00`、同规则 T+1 已忽略订单 `1.59` 时，应自动选中两条并显示净调整金额 `0.41`。
- 取消任一建议后净调整金额不等于差额，确认按钮应禁用；恢复勾选后可提交。
- 确认后当前订单变为已忽略，原已忽略订单转入目标任务并自动重新认账。
- 打包明细、其他规则、已认账、异常包或拆分明细不得进入转移建议，服务端也应拒绝非法提交。

## 回退

- v10.35 没有数据库迁移；代码可直接使用 v10.34 部署包回退。
- 回退后 v10.35 已完成的订单忽略、转移和认账属于业务数据，不会随代码回退自动撤销；如需恢复，必须先核对相关流水、订单明细和入账结果，再按业务流程处理。
