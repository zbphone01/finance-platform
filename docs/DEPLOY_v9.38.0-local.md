# v9.38.0-local 部署说明

## 文件

- `releases/finance-platform-v9.38.0-local.tar.gz`：源码部署包
- `deploy-update-optimized.sh`：推荐服务器部署脚本
- `docs/VERSION_SNAPSHOT_v9.38.0-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：最新技能文档

## 重要说明

v9.38 无数据库迁移。

部署前仍需确认线上已具备 v9.33 至 v9.37 的表结构：

1. `migrate-v9.33-match-result-display-snapshot.sql`
2. `migrate-v9.34-recognition-date-summaries.sql`
3. `migrate-v9.35-budget-code-associated-nc-projects.sql`
4. `migrate-v9.36-order-file-list-indexes.sql`
5. `migrate-v9.37-detail-package-type.sql`

本版本新增本地分片缓存目录 `.upload-cache/order-files`。部署用户需要对 `/home/ubuntu/finance-platform` 有写权限，并建议至少预留 2GB 可用磁盘空间用于大文件上传、合并和临时缓存。

## 线上部署步骤

### 1. 上传部署包和部署脚本

```bash
cd /home/deploy/Documents/资金池认账

scp releases/finance-platform-v9.38.0-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 线上备份数据库

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform

mysqldump \
  -u finance_user \
  -p \
  --no-tablespaces \
  --skip-lock-tables \
  --set-gtid-purged=OFF \
  finance_recon \
  > backup_before_v9.38.0.sql
```

### 3. 检查磁盘空间和目录权限

```bash
df -h /home/ubuntu/finance-platform
mkdir -p /home/ubuntu/finance-platform/.upload-cache/order-files
test -w /home/ubuntu/finance-platform/.upload-cache/order-files && echo OK
```

### 4. 部署代码

```bash
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.38.0-local.tar.gz
```

如需强制重新安装依赖：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.38.0-local.tar.gz
```

如需在线上额外执行类型检查：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.38.0-local.tar.gz
```

### 5. 查看服务状态和日志

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 进入 `认账及分账` 上传订单明细，上传弹窗应出现分片上传进度。
- 上传 350M 左右 CSV 时，前端应显示分片进度和 `服务器处理中`。
- 上传完成后应提示入库条数、已匹配条数。
- 进入 `订单明细` 菜单，应看到对应数据包及已匹配/未匹配数量。
- 自动明细认账应直接消费上传阶段预匹配结果。
- 手动点击日期列表 `开始认账`，应先补匹配未匹配明细，再执行认账。

## 回退提醒

- 代码可通过上一版部署包回退。
- `.upload-cache/order-files` 只是临时上传缓存，确认没有正在上传的大文件后可以清理。

