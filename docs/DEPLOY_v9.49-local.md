# v9.49-local 部署说明

## 文件

- `releases/finance-platform-v9.49-local.tar.gz`：v9.49 部署包
- `docs/VERSION_SNAPSHOT_v9.49-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：项目技能文档，已更新到 v9.49

## 重要说明

- v9.49 无新增数据库迁移。
- 部署前确认 v9.45、v9.46、v9.47、v9.48 的迁移已经在线上执行。
- v9.49 主要增强订单明细上传解析：兼容支付宝账务明细 CSV 的 GB18030 编码和前置说明行。

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
scp releases/finance-platform-v9.49-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

## 部署

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.49-local.tar.gz
```

如果服务器依赖状态异常：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.49-local.tar.gz
```

如需在线上强制执行类型检查：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.49-local.tar.gz
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

- 使用支付宝账务明细 CSV 上传订单明细，文件前几行可以是 `#支付宝账务明细查询`、账号、起止日期和分隔线。
- 规则基础字段可配置为：
  - 日期字段：`发生时间` 或 `时间`
  - 收入字段：`收入金额` 或 `收入金额（+元）`
  - 订单号字段：`商户订单号` 或 `订单号`
- 上传后进入 `订单明细包`，确认条目数、已匹配数、未匹配数正常。
- 若规则条件为 `备注 等于 donation_10705`，而文件备注中没有该值，应看到明细正常入库但条件不匹配；这是规则关键字与文件内容不一致，不是文件格式解析失败。
