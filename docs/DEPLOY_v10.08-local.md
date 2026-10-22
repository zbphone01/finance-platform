# v10.08-local 部署说明

## 文件

- `releases/finance-platform-v10.08-local.tar.gz`：v10.08 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.08-local.md`：版本快照

## 重要说明

- 本版无新增数据库迁移。
- 如目标环境尚未部署 v10.07，需要先按 v10.07 文档补齐 v10.00、v10.01、v10.02 迁移。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.08-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.08-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.08-local.tar.gz \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.08-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.08-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.08-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.08-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.08-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号应显示 `v10.08`。
- 打包明细上传弹窗不再要求选择到账日期。
- 上传有对应未完成认账银行流水的打包明细包，应自动匹配最早符合到账信息的流水并提交认账。
- 上传时暂无对应银行流水的打包明细包，应仅出现在 `订单明细包`，匹配日期显示 `-`，不应出现在 `认账及分账` 日期汇总。
- 后续银行流水可用后，在 `订单明细包` 点击“匹配流水认账”，应能绑定流水并提交认账队列。
- 对已部分认账且仍有余额的流水，例如 `801594869474`，应能继续匹配剩余订单明细包。

## 回退

- 代码可通过上一版部署包 `finance-platform-v10.07-local.tar.gz` 回退。
- 本版无数据库结构变更。
