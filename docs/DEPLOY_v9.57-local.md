# v9.57-local 部署说明

## 文件

- `releases/finance-platform-v9.57-local.tar.gz`：v9.57 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `migrate-v9.57-detail-split-enabled.sql`：明细分账开关迁移
- `docs/VERSION_SNAPSHOT_v9.57-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：项目技能文档，已更新到 v9.57

## 重要说明

- 本版替代 v9.56-local 部署包；线上部署时上传 v9.57 包即可。
- 部署顺序：先上传部署包、部署脚本和迁移脚本，再执行数据库迁移，最后运行部署脚本。
- 如果线上已经执行过某个迁移，先用 `SHOW COLUMNS` 检查，不要重复执行同一个 `ALTER TABLE ADD COLUMN` 脚本。
- 如果目标环境尚未部署 v9.55 系列迁移，必须先执行 `migrate-v9.55-multi-split-order-details.sql` 和 `migrate-v9.55-summary-cache-fields.sql`。

## 本地迁移

```bash
cd /home/deploy/Documents/资金池认账
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.57-detail-split-enabled.sql
```

本地检查：

```bash
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM recognition_rules LIKE 'detail_split_enabled';"
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SELECT COUNT(*) AS enabled_rules FROM recognition_rules WHERE detail_split_enabled = 1;"
```

## 线上部署

上传部署包、部署脚本和迁移脚本：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.57-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.57-detail-split-enabled.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

登录服务器：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
```

检查迁移状态：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_rules LIKE 'detail_split_enabled';"
```

如字段不存在，执行迁移：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.57-detail-split-enabled.sql
```

再次检查：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_rules LIKE 'detail_split_enabled'; SELECT COUNT(*) AS enabled_rules FROM recognition_rules WHERE detail_split_enabled = 1;"
```

部署代码：

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.57-local.tar.gz
```

如果服务器依赖状态异常：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.57-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 进入 `认账规则 -> 明细认账`，新建或编辑规则，应能看到 `明细分账` 开关。
- 关闭 `明细分账` 时，`明细分账判断字段`、`判断关键字`、`明细匹配字段` 不可填写，上传订单明细时不应执行待拆分预匹配。
- 开启 `明细分账` 时，三项字段均为必填，上传订单明细时符合尾部关键字的明细应标记为 `待拆分`。
- 进入 `订单明细包 -> 订单明细内容`，整包视图顶部 `订单总金额` 应与整包所有文件合计一致。
- 上传金额为 `0.01` 的打包订单明细，应显示为 `已完成`，不应被标记为 `异常`。

## 未来维护约束

- 明细认账规则列表的普通 `编辑` 入口必须保持整体编辑，不得随意改成摘要卡片或单条件跳转。
- 单条件编辑只用于规则详情页中查看某条条件后的定向维护。
- 订单明细包和认账及分账列表首屏必须继续读取缓存字段，不得改回实时扫描大明细表。
