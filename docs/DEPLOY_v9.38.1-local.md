# v9.38.1-local 部署说明

## 文件

- `releases/finance-platform-v9.38.1-local.tar.gz`：源码部署包
- `deploy-update-optimized.sh`：推荐服务器部署脚本
- `docs/VERSION_SNAPSHOT_v9.38.1-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：最新技能文档

## 重要说明

v9.38.1 无数据库迁移。

本版本用于修复 `订单明细包` 菜单显示问题，并将菜单名称从 `订单明细` 调整为 `订单明细包`。

## 线上部署步骤

### 1. 上传部署包和部署脚本

```bash
cd /home/deploy/Documents/资金池认账

scp releases/finance-platform-v9.38.1-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 部署代码

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.38.1-local.tar.gz
```

如需强制重新安装依赖：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.38.1-local.tar.gz
```

### 3. 查看服务状态和日志

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 左侧菜单应显示 `订单明细包`。
- 点击 `订单明细包` 后，页面标题应为 `订单明细包`。
- 订单明细包列表应正常展示历史数据包。
- 如浏览器仍显示旧菜单名，强制刷新页面或清理浏览器缓存。

