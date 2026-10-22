# v10.39-local 部署说明

## 文件

- `releases/finance-platform-v10.39-local.tar.gz`：v10.39 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.39-local.md`：版本快照

## 重要说明

- 从 v10.38 升级到 v10.39 不需要执行 SQL 迁移，直接部署代码包。
- 从 v10.36 升级时，必须先按 `docs/DEPLOY_v10.38-local.md` 依次完成 v10.37、v10.38 迁移，再部署 v10.39。
- 更旧环境先按历史部署说明补齐至 v10.38。
- 本版不新增依赖，不执行 `drizzle schema push`。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.39-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
df -h / /var/lib/mysql
./deploy-update-optimized.sh finance-platform-v10.39-local.tar.gz
pm2 status
pm2 logs finance-platform --lines 120
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.39-local.tar.gz \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
df -h / /var/lib/mysql
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.39-local.tar.gz
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号显示 `v10.39`。
- 普通明细认账存在转移订单时，任务先处理当前订单包，再处理转移订单；两个阶段结束前持续显示“认账执行中”。
- 第二阶段不重新选择银行流水，同日汇总的流水状态按固定流水顺序统一计算。
- 到账 `10.00` 元、累计认账 `9.99` 元时显示部分认账；累计达到 `10.00` 元时显示已认账。
- 大订单明细认账期间观察 CPU；规则条件查询应分别命中当前订单包范围和转移订单范围，不再对两类明细做重复 `OR` 扫描。
- 明细分账包上传后的增量认账流程和两阶段进度显示保持 v10.38 行为。

## 回退

- v10.39 没有数据库迁移；代码可直接使用 v10.38 部署包回退。
- 回退后恢复为普通明细与转移订单合并执行及原一分钱容差状态口径。
- 回退不会自动撤销 v10.39 已生成的入账结果、订单转移或状态变化，需按业务流程单独核对。
