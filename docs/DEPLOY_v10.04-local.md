# v10.04-local 部署说明

## 文件

- `releases/finance-platform-v10.04-local.tar.gz`：v10.04 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.04-local.md`：版本快照

## 重要说明

- 本版无新增数据库迁移。
- 如目标环境尚未部署 v10.03，需要先按 v10.03 文档补齐 v10.00、v10.01、v10.02 迁移。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.04-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.04-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.04-local.tar.gz \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.04-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.04-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.04-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.04-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.04-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号应显示 `v10.04`。
- 日期汇总详情的入账结果列表应为小号字体，并隐藏入账时间、流水号、项目资金、管理费和状态列。
- 银行流水列表的异常差额金额数字应可点击打开候选弹窗。
- 候选弹窗应限制在视口内，不再横向溢出，并仅展示订单号、认账关键字和订单金额。
- 选择候选订单明细并确认后，应能批量忽略对应明细并刷新汇总。
- 取消凭证后，退订/订单退款入账结果应恢复未锁定状态。
- 上传订单明细弹窗应显示服务端每 `10000` 行分批入库。

## 回退

- 代码可通过上一版部署包 `finance-platform-v10.03-local.tar.gz` 回退。
- 本版无数据库结构变更。
