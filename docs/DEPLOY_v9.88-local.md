# v9.88-local 部署说明

## 文件

- `releases/finance-platform-v9.88-local.tar.gz`：v9.88 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v9.88-local.md`：版本快照

## 重要说明

- 本版替代 v9.87-local 部署包。
- 本版无新增数据库迁移；已部署 v9.87 的环境可直接部署代码包。
- 从 v9.86 或更旧版本升级时，需先补齐 v9.87 及历史缺失迁移，再部署 v9.88。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.88-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.88-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.88-local.tar.gz \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v9.88-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.88-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.88-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.88-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.88-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 上传银行到账文件后，弹窗只提示上传了多少条有效流水。
- 查看入账结果，管理费应按新版规则计算，入账金额右侧应显示项目资金。
- 进入入账结果菜单的日期入账明细列表，可按全部、捐赠收入、订单退款筛选。
- 上传大订单明细后，后端不再生成合并后的大文件。

## 回退

- 代码可通过上一版部署包 `finance-platform-v9.87-local.tar.gz` 回退。
- 本版无新增数据库迁移，正常回退代码即可。
