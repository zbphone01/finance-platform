# v9.93-local 部署说明

## 文件

- `releases/finance-platform-v9.93-local.tar.gz`：v9.93 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v9.93-local.md`：版本快照

## 重要说明

- 本版替代 v9.92-local 部署包。
- 本版没有新增数据库迁移。
- 如果当前环境尚未部署 v9.89，需要先执行 `migrate-v9.89-alipay-t1-recognition-index.sql`，再部署 v9.93。
- 从 v9.88 或更旧版本升级时，需先补齐 v9.89 及历史缺失迁移，再部署 v9.93。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.93-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.93-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.93-local.tar.gz \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v9.93-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.93-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.93-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.93-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.93-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号应显示 `v9.93`。
- 明细分账执行时，明细分账菜单状态列应显示进度条，页面顶部不再出现文字状态提示。
- 删除明细分账包后，来源订单明细应恢复为待拆分，关联入账结果应完整删除，银行流水和任务状态应重新计算。
- T+1 订单明细认账应能正常生成入账结果，且订单明细状态批量回写为已认账。
- 同日汇总场景下，多笔同日银行流水仍应共同参与可认账金额判断，不应只认当前任务。

## 回退

- 代码可通过上一版部署包 `finance-platform-v9.92-local.tar.gz` 回退。
- 本版没有新增数据库迁移，回退代码不需要执行额外数据库回滚。
