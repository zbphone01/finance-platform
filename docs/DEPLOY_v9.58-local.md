# v9.58-local 部署说明

## 文件

- `releases/finance-platform-v9.58-local.tar.gz`：v9.58 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `migrate-v9.58-condition-recognition-enabled.sql`：条件认账开关迁移
- `migrate-v9.59-exclude-order-rule.sql`：排除订单配置迁移
- `docs/VERSION_SNAPSHOT_v9.58-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：项目技能文档，已更新到 v9.58

## 重要说明

- 本版替代 v9.57.1-local 部署包；线上部署时上传 v9.58 包即可。
- 部署顺序：先上传部署包、部署脚本和迁移脚本，再执行数据库迁移，最后运行部署脚本。
- 如果线上已经执行过某个迁移，先用 `SHOW COLUMNS` 检查，不要重复执行同一个 `ALTER TABLE ADD COLUMN` 脚本。
- 如果目标环境尚未部署 v9.57 及以前迁移，必须先按历史部署说明补齐到 v9.57。

## 本地迁移

```bash
cd /home/deploy/Documents/资金池认账
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM recognition_rules LIKE 'condition_recognition_enabled';"
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.58-condition-recognition-enabled.sql
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM recognition_rules LIKE 'exclude_order_enabled';"
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.59-exclude-order-rule.sql
```

本地检查：

```bash
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM recognition_rules LIKE 'condition_recognition_enabled'; SHOW COLUMNS FROM recognition_rules LIKE 'exclude_order_enabled'; SHOW COLUMNS FROM recognition_rules LIKE 'exclude_order_field'; SHOW COLUMNS FROM recognition_rules LIKE 'exclude_order_keyword';"
```

## 线上部署

上传部署包、部署脚本和迁移脚本：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.58-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.58-condition-recognition-enabled.sql \
  migrate-v9.59-exclude-order-rule.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

登录服务器：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
```

检查迁移状态：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_rules LIKE 'condition_recognition_enabled';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_rules LIKE 'exclude_order_enabled';"
```

如字段不存在，执行迁移：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.58-condition-recognition-enabled.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.59-exclude-order-rule.sql
```

再次检查：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_rules LIKE 'condition_recognition_enabled'; SHOW COLUMNS FROM recognition_rules LIKE 'exclude_order_enabled'; SHOW COLUMNS FROM recognition_rules LIKE 'exclude_order_field'; SHOW COLUMNS FROM recognition_rules LIKE 'exclude_order_keyword';"
```

部署代码：

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.58-local.tar.gz
```

如果服务器依赖状态异常：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.58-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 进入 `认账规则 -> 明细认账`，新建或编辑规则，应能看到 `条件认账` 和 `排除订单` 开关。
- 关闭 `条件认账` 后，应只填写整包分账设置，保存后规则列表显示 `整包入账`。
- 开启 `排除订单` 后，`识别字段` 和 `字段关键字` 必填；上传订单明细时精确命中的行不应入库。
- 查看规则详情时，开启的 `排除订单` 和 `明细分账` 应分别显示独立配置卡片。
- 普通条件认账规则仍应按 `等于 -> 待拆分 -> 包含` 的预匹配顺序执行。

## 未来维护约束

- 明细认账规则列表的普通 `编辑` 入口必须保持整体编辑，不得随意改成摘要卡片或单条件跳转。
- 单条件编辑只用于规则详情页中查看某条条件后的定向维护。
- `排除订单` 只处理上传阶段的新明细，不追溯处理历史已入库订单明细。
