# v9.39.0-local 部署说明

## 文件

- `releases/finance-platform-v9.39.0-local.tar.gz`：源码部署包
- `deploy-update-optimized.sh`：推荐服务器部署脚本
- `migrate-v9.39-recognition-list-performance.sql`：数据库索引迁移
- `docs/VERSION_SNAPSHOT_v9.39.0-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：最新技能文档

## 重要说明

v9.39.0 用于优化 `认账及分账` 日期汇总详情页和银行流水列表加载性能。

本版本包含数据库迁移，需在本地库和线上库执行：

```bash
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.39-recognition-list-performance.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.39-recognition-list-performance.sql
```

线上执行第二条命令时，请在服务器 `/home/ubuntu/finance-platform` 目录中运行。

## 线上部署步骤

### 1. 上传部署包和部署脚本

```bash
cd /home/deploy/Documents/资金池认账

scp releases/finance-platform-v9.39.0-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.39-recognition-list-performance.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 执行线上数据库迁移

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.39-recognition-list-performance.sql
```

### 3. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.39.0-local.tar.gz
```

如需强制重新安装依赖：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.39.0-local.tar.gz
```

### 4. 查看服务状态和日志

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 进入 `认账及分账` 后日期汇总列表正常展示。
- 点击任一日期汇总，银行流水列表应先展示，不应等待订单明细或入账结果列表加载。
- 不选择未认账流水时，不应提前加载手动认账所需的大字典数据。
- 点击未认账流水后，手动认账表单可正常加载部门、预算编码、项目、公益平台和捐赠活动选择项。
