# v9.91-local 部署说明

## 文件

- `releases/finance-platform-v9.91-local.tar.gz`：v9.91 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v9.91-local.md`：版本快照

## 重要说明

- 本版替代 v9.90-local 部署包。
- 本版没有新增数据库迁移。
- 如果当前环境尚未部署 v9.89，需要先执行 `migrate-v9.89-alipay-t1-recognition-index.sql`，再部署 v9.91。
- 从 v9.88 或更旧版本升级时，需先补齐 v9.89 及历史缺失迁移，再部署 v9.91。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.91-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.91-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.91-local.tar.gz \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v9.91-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.91-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.91-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.91-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.91-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号应显示 `v9.91`。
- 删除只有一个来源文件的订单明细包时，应打开删除弹窗，且仅显示“删除整个数据包”。
- 删除订单明细包时，弹窗应保持展示并显示 1/4 到 4/4 的步骤；删除完成后自动关闭，对应列表条目消失。
- 删除已拆分订单明细包后，重新上传同类待拆分订单明细包，应能复用原明细分账包重新执行拆分认账。
- 删除明细分账包后，来源订单明细应恢复待拆分；再次上传或执行拆分认账不应被旧绑定阻塞。
- 上传订单明细时，不应再出现 `Unexpected end of JSON input`。
- 打开任务详情，顶部应展示银行流水到账总额、订单明细认账金额和已认账银行流水数 / 流水条数。
- 差异大的任务进入银行流水列表时，认账差异列应继续显示。

## 回退

- 代码可通过上一版部署包 `finance-platform-v9.90-local.tar.gz` 回退。
- 本版没有新增数据库迁移，回退代码不需要执行额外数据库回滚。
