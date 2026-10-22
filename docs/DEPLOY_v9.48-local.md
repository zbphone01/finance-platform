# v9.48-local 部署说明

## 文件

- `migrate-v9.48-detail-keyword-match-type.sql`：v9.48 明细认账关键字匹配方式迁移
- `docs/VERSION_SNAPSHOT_v9.48-local.md`：版本快照

## 重要说明

- v9.48 新增数据库字段，必须先执行迁移，再部署新版代码。
- v9.48 迁移为 `rule_items` 新增 `keyword_match_type`，历史规则默认 `等于`。
- 字段已存在时不要重复执行同一迁移脚本，先用检查命令确认。

## 本地迁移

```bash
cd /home/deploy/Documents/资金池认账
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.48-detail-keyword-match-type.sql
```

本地检查：

```bash
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM rule_items LIKE 'keyword_match_type';"
```

## 线上迁移

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.48-detail-keyword-match-type.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM rule_items LIKE 'keyword_match_type';"
```

## 功能验证

- 进入 `认账规则 / 明细认账` 新建或编辑规则，条件中应显示 `匹配方式`，可选 `等于`、`包含`。
- 选择 `等于` 时，明细关键字必须完全一致才匹配。
- 选择 `包含` 时，明细字段包含关键字即可匹配。
- 新增两个 `认账关键字字段 + 关键字` 相同的条件，应提示具体条件号并阻止保存。
- 导入条件 CSV 缺少 `匹配方式` 列时，应提示缺列并取消导入。
- 上传订单明细 CSV 缺少规则配置的 `日期字段`、`收入字段`、`订单号字段` 任一列时，应提示缺列并取消入库。
- 将规则的 `订单号字段` 改成非默认列名后，上传明细应只读取该列，不再用 `订单号` 等兼容列兜底。
