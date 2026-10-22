# v9.50-local 部署说明

## 文件

- `releases/finance-platform-v9.50-local.tar.gz`：v9.50 部署包
- `docs/VERSION_SNAPSHOT_v9.50-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：项目技能文档，已更新到 v9.50

## 重要说明

- v9.50 无新增数据库迁移。
- 部署前确认 v9.45、v9.46、v9.47、v9.48 的迁移已经在线上执行。
- v9.50 主要优化明细认账规则编辑输入卡顿、到账认账规则列表首屏加载，以及公益平台新增平台项目名称的重复提醒和编号预填。

## 迁移确认

线上确认 v9.48 字段已存在：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM rule_items LIKE 'keyword_match_type';"
```

如果字段不存在，先按 v9.48 部署说明补执行迁移：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.48-detail-keyword-match-type.sql
```

## 上传部署包

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.50-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

## 部署

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.50-local.tar.gz
```

如果服务器依赖状态异常：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.50-local.tar.gz
```

如需在线上强制执行类型检查：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.50-local.tar.gz
```

## 部署后检查

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

浏览器访问：

```text
http://server1.example.com:3001/
```

## 功能验证

- 进入 `认账规则 -> 明细认账`，编辑一条条件较多的规则，在“认账关键字字段”连续输入，应不再出现明显卡顿。
- 进入 `认账规则 -> 到账认账`，规则列表应正常展示，分账数显示为摘要数量；点击编辑或复制时应能加载完整分账并正常保存或复制。
- 在到账认账列表直接切换启用状态，应只更新状态并保持列表正常刷新。
- 进入 `认账信息设置 -> 公益平台`，新增平台项目名称：
  - 同公益平台、同 NC 项目、同平台项目名称重复时，应弹出“本平台已建该平台项目”，且只有关闭按钮。
  - 仅 NC 项目相同但平台项目名称不同，应允许保存。
  - 连续新增平台项目名称时，编号应自动预填最新可用 `PPxxxxxxx`，不应复用刚创建成功的编号。
