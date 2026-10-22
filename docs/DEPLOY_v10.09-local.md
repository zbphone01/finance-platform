# v10.09-local 部署说明

## 文件

- `releases/finance-platform-v10.09-local.tar.gz`：v10.09 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.09-local.md`：版本快照

## 重要说明

- 本版无新增数据库迁移。
- 如目标环境尚未部署 v10.08，需要先按 v10.08 文档补齐 v10.00、v10.01、v10.02 迁移。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.09-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.09-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.09-local.tar.gz \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.09-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.09-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.09-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.09-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.09-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号应显示 `v10.09`。
- `凭证汇总` 流水状态筛选应只展示 `全部状态`、`未认账`、`已认账`、`已认账/已制单`。
- `凭证汇总` 第一列表头应显示 `流水日期`。
- 收入凭证详情中，凭证总览行不应打开说明浮层。
- 收入凭证详情中，项目资金行和管理费行点击后应打开说明浮层。
- 说明浮层中的 `项目名称` 应显示为 `编号_名称`。
- 说明浮层中暂无取值规则的 `结算方式`、`客户`、`渠道账户` 应显示 `-`。

## 回退

- 代码可通过上一版部署包 `finance-platform-v10.08-local.tar.gz` 回退。
- 本版无数据库结构变更。
