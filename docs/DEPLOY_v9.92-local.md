# v9.92-local 部署说明

## 文件

- `releases/finance-platform-v9.92-local.tar.gz`：v9.92 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v9.92-local.md`：版本快照

## 重要说明

- 本版替代 v9.91-local 部署包。
- 本版没有新增数据库迁移。
- 如果当前环境尚未部署 v9.89，需要先执行 `migrate-v9.89-alipay-t1-recognition-index.sql`，再部署 v9.92。
- 从 v9.88 或更旧版本升级时，需先补齐 v9.89 及历史缺失迁移，再部署 v9.92。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.92-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.92-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.92-local.tar.gz \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v9.92-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.92-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.92-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.92-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.92-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号应显示 `v9.92`。
- 在日期汇总详情订单明细中点击“暂时忽略”，应立即弹出“忽略处理中，请稍后”，处理完成后自动关闭。
- 在认账及分账列表点击“开始认账”并确认后，当前行应立即临时显示“认账执行中”，后台返回后刷新为真实状态。
- 删除账单日期任务时，应显示 1/5 到 5/5 的步骤式删除弹窗，删除期间不能关闭弹窗，也不能继续上传、开始认账或删除其它日期。
- 删除完成后，日期汇总列表中对应条目应消失，然后才显示删除成功提示。
- 若存在已制单锁定入账结果，删除应失败并展示错误提示。

## 回退

- 代码可通过上一版部署包 `finance-platform-v9.91-local.tar.gz` 回退。
- 本版没有新增数据库迁移，回退代码不需要执行额外数据库回滚。
