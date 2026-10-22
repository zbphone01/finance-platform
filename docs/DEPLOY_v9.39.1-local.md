# v9.39.1-local 部署说明

## 文件

- `releases/finance-platform-v9.39.1-local.tar.gz`：源码部署包
- `deploy-update-optimized.sh`：推荐服务器部署脚本
- `docs/VERSION_SNAPSHOT_v9.39.1-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：最新技能文档

## 重要说明

v9.39.1 无数据库迁移。

本版本用于修复到账信息汇总、入账结果列表的横向滚动显示问题，并为公益平台新增平台项目名称增加 NC项目重复提醒。

## 线上部署步骤

### 1. 上传部署包和部署脚本

```bash
cd /home/deploy/Documents/资金池认账

scp releases/finance-platform-v9.39.1-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 部署代码

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.39.1-local.tar.gz
```

如需强制重新安装依赖：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.39.1-local.tar.gz
```

### 3. 查看服务状态和日志

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- `到账信息汇总` 已记录列表中，长到账别称应完整展示，操作列应固定在右侧。
- `入账结果` 入账明细列表横向滚动时，右侧 `入账金额 / 状态 / 操作` 三列应盖住滚动内容并保持可见。
- `公益平台` 新增平台项目名称时，选择已有平台项目的 NC项目名称，应先弹出确认提示。
