# v9.65-local 部署说明

## 文件

- `releases/finance-platform-v9.65-local.tar.gz`：v9.65 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `migrate-v9.64-detail-split-entry-recognition.sql`：明细分账条目认账结构迁移
- `migrate-v9.65-detail-split-status-snapshot.sql`：明细分账状态快照迁移
- `docs/VERSION_SNAPSHOT_v9.65-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：项目技能文档，已更新到 v9.65

## 重要说明

- 本版替代 v9.63-local 部署包；线上部署时上传 v9.65 包即可。
- 本版新增数据库迁移，必须先执行 v9.64、再执行 v9.65。
- 字段或索引已存在时不要重复执行同一迁移脚本，先用 `SHOW COLUMNS` 或 `SHOW INDEX` 检查。
- 明细分账列表状态数使用快照字段；上传完成和开始拆分认账后会刷新快照。

## 迁移检查

登录服务器：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
```

检查 v9.64 / v9.65 迁移状态：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM detail_split_files LIKE 'recognition_keyword_field';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM detail_split_files LIKE 'pending_recognition_count';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM detail_split_files LIKE 'recognized_count';"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW INDEX FROM bill_details WHERE Key_name IN ('bd_rule_detail_split_status_idx', 'bd_order_pending_split_idx');"
```

如缺少 v9.64 字段或索引，执行：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.64-detail-split-entry-recognition.sql
```

如缺少 v9.65 快照字段，执行：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.65-detail-split-status-snapshot.sql
```

执行后复查：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM detail_split_files LIKE 'recognition_keyword_field'; SHOW COLUMNS FROM detail_split_files LIKE 'pending_recognition_count'; SHOW COLUMNS FROM detail_split_files LIKE 'recognized_count';"
```

## 线上部署

上传部署包、部署脚本和迁移脚本：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.65-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.64-detail-split-entry-recognition.sql \
  migrate-v9.65-detail-split-status-snapshot.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

部署代码：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.65-local.tar.gz
```

如果服务器依赖状态异常：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.65-local.tar.gz
```

如需在线上强制执行类型检查：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.65-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 明细分账菜单页可以上传分账明细；缺少必填表头时应弹窗提示并停止上传。
- 上传完成后，列表应展示未匹配、待认账、已认账三类快照数。
- 对已有部分认账的明细分账包，状态应显示“部分认账”。
- 点击单个明细分账包的“开始拆分认账”，应先重新匹配未匹配分账条目，再匹配待拆分订单明细。
- 订单明细键值 `T200P1234567890123456789` 应截取为 `1234567890123456789`，并与分账明细完整键值精确匹配。
- 分账明细键值相同且金额合计等于订单明细金额时，应生成入账结果并把分账条目标为已认账。

## 压测建议

- 先用线上真实明细分账文件测试上传和预匹配，确认入库条数、待认账数和未匹配数符合预期。
- 再选择含较多待拆分订单明细的日期或订单包，连续对多个明细分账包点击开始拆分认账。
- 压测期间观察列表响应、PM2 日志、服务器内存和数据库 CPU；如果出现卡顿，优先检查拆分认账 SQL 是否命中 `bd_rule_detail_split_status_idx` 和 `bd_order_pending_split_idx`。
- 不建议同一时间对同一个明细分账包重复点击开始拆分认账；如需并发压测，使用不同分账包更接近实际业务。

## 未来维护约束

- 明细分账包列表继续读取快照字段，不要恢复为打开页面实时聚合 `bill_details`。
- 拆分认账继续保持“单一订单明细对比多个明细分账条目”的方向，不要改成分账条目反向扫描所有订单明细。
- 订单明细侧的匹配键截取规则固定为英文数字组合第 6 位开始，明细分账侧使用完整键值。
