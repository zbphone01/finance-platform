# v9.26.0-local 部署说明

## 文件

- `finance-platform-v9.26.0-local.tar.gz`：源码部署包
- `deploy-update.sh`：服务器部署脚本
- `VERSION_SNAPSHOT_v9.26.0-local.md`：版本快照
- `finance-recon-SKILL.v9.26.0-local.md`：精简后的技能文档

## 重要说明

本版无新增数据库迁移。只要线上已经完成 v9.25 所需迁移，本次部署只需要更新代码。

如果线上还没有部署 v9.25，需要先按 `DEPLOY_v9.25.0-local.md` 完成 v9.24/v9.25 的数据库迁移。

## 线上部署步骤

### 1. 上传部署包和部署脚本

```bash
scp finance-platform-v9.26.0-local.tar.gz deploy-update.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

如果当前目录没有 `deploy-update.sh`，使用本地绝对路径：

```bash
scp finance-platform-v9.26.0-local.tar.gz \
  /home/deploy/Documents/Codex/2026-05-09/new-chat-2/deploy-update.sh \
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
  > backup_before_v9.26.sql
```

### 3. 检查 v9.25 前置迁移

```bash
mysql -u finance_user -p finance_recon -e "
SHOW TABLES LIKE 'project_details';
SHOW COLUMNS FROM rule_item_splits LIKE 'platform_project_detail';
SHOW COLUMNS FROM income_rule_splits LIKE 'platform_project_detail';
SHOW COLUMNS FROM match_results LIKE 'platform_project_detail';
SHOW COLUMNS FROM order_files LIKE 'upload_status';
SHOW COLUMNS FROM income_recognition_rules LIKE 'recognition_type';
"
```

预期：

- 能看到 `project_details` 表。
- 三个 `platform_project_detail` 字段均存在。
- `order_files.upload_status` 存在。
- `income_recognition_rules.recognition_type` 存在。

### 4. 部署代码

```bash
cd /home/ubuntu/finance-platform
chmod +x deploy-update.sh
./deploy-update.sh finance-platform-v9.26.0-local.tar.gz
```

### 5. 重启并查看日志

```bash
pm2 restart finance-platform
pm2 logs finance-platform --lines 80
```

## 功能验证

- 在认账及分账菜单上传订单明细。
- 上传成功后，订单明细菜单中能看到按订单日期和明细认账规则拆分的数据包。
- 如果订单日期和规则的匹配到账信息能唯一定位到未认账银行流水，系统应自动把任务加入后台明细认账队列。
- 如果无法唯一定位，上传仍成功，任务保持待认账，可在日期列表点击“执行明细认账”手动触发。

## 回退提醒

- 本版没有数据库结构变更，代码回退不需要回退数据库。
- 如果回退到 v9.25，订单明细上传后自动触发明细认账的行为会恢复为 v9.25 的旧逻辑。
