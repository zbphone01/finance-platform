# v10.48-local 部署说明

## 文件

- `releases/finance-platform-v10.48-local.tar.gz`：包含预构建 `dist/` 的 v10.48 部署包
- `migrate-v10.48-archive-index-canary.sql`：月归档索引灰度迁移，首发阶段执行
- `migrate-v10.48-archive-index-finalize.sql`：月归档索引正式清理，观察 3–7 个业务日后执行
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.48-local.md`：版本快照

## 重要说明

- 本说明仅适用于从 v10.47 升级到 v10.48；更早版本先按对应历史部署说明补齐到 v10.47。
- 首次部署 v10.48 只执行 `migrate-v10.48-archive-index-canary.sql`，禁止在同一部署窗口执行正式清理脚本。
- 灰度迁移只把既有月归档表的三个候选索引设为 `INVISIBLE`，不会释放索引空间；必须观察 3–7 个业务日并完成功能验证后，才能执行 `migrate-v10.48-archive-index-finalize.sql`。
- 正式清理脚本会删除不可见候选索引并释放空间；任何候选索引仍为 `VISIBLE` 时脚本会拒绝执行。
- 部署脚本不会自动执行 SQL，也不会执行 `drizzle schema push`。
- 部署包必须包含本地验证通过的 `dist/boot.js`、`dist/public/index.html` 和前端资源；部署脚本不会在服务器执行 `npm run build`。
- 部署脚本先在独立暂存目录校验产物、依赖、数据库连接和 MySQL Event，再使用本轮固定备份原子切换 `dist/`；异常中断或健康检查失败时恢复本轮部署前产物，不按目录时间猜测回滚版本。
- 锁文件未变化时复用现有 `node_modules`；锁文件变化或依赖缺失时，在暂存目录执行 `npm ci --omit=dev`，校验后再切换运行依赖。
- 已执行过的灰度或正式清理迁移不得重复执行；检查结果出现候选索引部分可见、部分不可见或替代索引缺失时，停止部署并核查。

## 测试服务器1首次部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.48-local.tar.gz \
  migrate-v10.48-archive-index-canary.sql \
  migrate-v10.48-archive-index-finalize.sql \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 登录服务器

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
```

### 3. 灰度迁移前检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT routine_name FROM information_schema.routines WHERE routine_schema = DATABASE() AND routine_name IN ('normalize_bill_details_archive_indexes_v1048','ensure_bill_details_archive_month_table') ORDER BY routine_name; SELECT table_name,index_name,MIN(is_visible) AS is_visible,GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ',') AS index_columns FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name REGEXP '^bill_details_archive_[0-9]{6}$' AND index_name IN ('bd_order_file_idx','bd_order_rec_item_idx','bd_task_idx','bd_task_status_idx','bd_detail_split_file_idx','bd_partition_status_idx','bd_rule_detail_split_status_idx') GROUP BY table_name,index_name ORDER BY table_name,index_name;"
```

- `normalize_bill_details_archive_indexes_v1048` 不存在，且每张月归档表的三个候选索引均为 `VISIBLE`：可以执行灰度迁移。
- 辅助过程已存在，且三个候选索引均为 `INVISIBLE`：灰度迁移已经执行，不要重复执行。
- 三个候选索引全部不存在：正式清理可能已经完成，不得执行灰度迁移。
- 结果混合或替代索引缺失：停止部署并核查数据库状态。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 执行灰度迁移

仅在迁移前检查确认尚未执行灰度时运行：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.48-archive-index-canary.sql
```

### 6. 灰度迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT routine_name FROM information_schema.routines WHERE routine_schema = DATABASE() AND routine_name IN ('normalize_bill_details_archive_indexes_v1048','ensure_bill_details_archive_month_table') ORDER BY routine_name; SELECT table_name,index_name,MIN(is_visible) AS is_visible,GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ',') AS index_columns FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name REGEXP '^bill_details_archive_[0-9]{6}$' AND index_name IN ('bd_order_file_idx','bd_order_rec_item_idx','bd_task_idx','bd_task_status_idx','bd_detail_split_file_idx','bd_partition_status_idx','bd_rule_detail_split_status_idx') GROUP BY table_name,index_name ORDER BY table_name,index_name;"
```

确认两个过程都存在；三个候选索引均为 `INVISIBLE`；`bd_order_rec_item_idx`、`bd_task_idx`、`bd_detail_split_file_idx` 和 `bd_partition_status_idx` 均存在且为 `VISIBLE`。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.48-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 curl 返回成功、页面右上角显示 `v10.48`，且部署后日志没有新增 `dist/public/index.html` 缺失或启动失败错误。

## 测试服务器2首次部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.48-local.tar.gz \
  migrate-v10.48-archive-index-canary.sql \
  migrate-v10.48-archive-index-finalize.sql \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

### 2. 登录服务器

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
```

### 3. 灰度迁移前检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT routine_name FROM information_schema.routines WHERE routine_schema = DATABASE() AND routine_name IN ('normalize_bill_details_archive_indexes_v1048','ensure_bill_details_archive_month_table') ORDER BY routine_name; SELECT table_name,index_name,MIN(is_visible) AS is_visible,GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ',') AS index_columns FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name REGEXP '^bill_details_archive_[0-9]{6}$' AND index_name IN ('bd_order_file_idx','bd_order_rec_item_idx','bd_task_idx','bd_task_status_idx','bd_detail_split_file_idx','bd_partition_status_idx','bd_rule_detail_split_status_idx') GROUP BY table_name,index_name ORDER BY table_name,index_name;"
```

- `normalize_bill_details_archive_indexes_v1048` 不存在，且每张月归档表的三个候选索引均为 `VISIBLE`：可以执行灰度迁移。
- 辅助过程已存在，且三个候选索引均为 `INVISIBLE`：灰度迁移已经执行，不要重复执行。
- 三个候选索引全部不存在：正式清理可能已经完成，不得执行灰度迁移。
- 结果混合或替代索引缺失：停止部署并核查数据库状态。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 执行灰度迁移

仅在迁移前检查确认尚未执行灰度时运行：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.48-archive-index-canary.sql
```

### 6. 灰度迁移后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT routine_name FROM information_schema.routines WHERE routine_schema = DATABASE() AND routine_name IN ('normalize_bill_details_archive_indexes_v1048','ensure_bill_details_archive_month_table') ORDER BY routine_name; SELECT table_name,index_name,MIN(is_visible) AS is_visible,GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ',') AS index_columns FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name REGEXP '^bill_details_archive_[0-9]{6}$' AND index_name IN ('bd_order_file_idx','bd_order_rec_item_idx','bd_task_idx','bd_task_status_idx','bd_detail_split_file_idx','bd_partition_status_idx','bd_rule_detail_split_status_idx') GROUP BY table_name,index_name ORDER BY table_name,index_name;"
```

确认两个过程都存在；三个候选索引均为 `INVISIBLE`；`bd_order_rec_item_idx`、`bd_task_idx`、`bd_detail_split_file_idx` 和 `bd_partition_status_idx` 均存在且为 `VISIBLE`。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.48-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 curl 返回成功、页面右上角显示 `v10.48`，且部署后日志没有新增 `dist/public/index.html` 缺失或启动失败错误。

## 灰度观察项目

灰度迁移后至少观察 3–7 个业务日，并逐项确认：

- 订单明细包详情可以正常读取已归档订单。
- 日期汇总详情可以正常读取月归档表。
- 已归档订单的手动认账、取消认账和恢复到热表流程正常。
- 订单明细包删除及归档锁流程正常。
- 每日自动归档事件正常完成，新月归档表可以正常创建。
- 慢查询、MySQL 错误日志和应用日志中没有因候选索引不可见导致的明显回退或超时。
- 凭证模板可以维护利息收入模板，利息逐笔制单会要求填写利息信息并正确生成凭证。
- 凭证汇总行银行账户读取流水关联账号别称，明细浮层字段、顺序和 NC 项目完整格式正确。

## 测试服务器1正式清理

仅在灰度观察完成并确认稳定后执行。

### 1. 登录服务器

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
```

### 2. 正式清理前检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT routine_name FROM information_schema.routines WHERE routine_schema = DATABASE() AND routine_name = 'normalize_bill_details_archive_indexes_v1048'; SELECT table_name,index_name,MIN(is_visible) AS is_visible FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name REGEXP '^bill_details_archive_[0-9]{6}$' AND index_name IN ('bd_order_file_idx','bd_task_status_idx','bd_rule_detail_split_status_idx') GROUP BY table_name,index_name ORDER BY table_name,index_name;"
```

确认辅助过程存在，且所有返回的候选索引均为 `INVISIBLE`。任一索引为 `VISIBLE` 或结果不完整时停止操作。

### 3. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 4. 执行正式清理

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.48-archive-index-finalize.sql
```

### 5. 正式清理后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT routine_name FROM information_schema.routines WHERE routine_schema = DATABASE() AND routine_name IN ('normalize_bill_details_archive_indexes_v1048','ensure_bill_details_archive_month_table') ORDER BY routine_name; SELECT table_name,index_name FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name REGEXP '^bill_details_archive_[0-9]{6}$' AND index_name IN ('bd_order_file_idx','bd_task_status_idx','bd_rule_detail_split_status_idx') ORDER BY table_name,index_name; SELECT table_name,table_rows,data_length,index_length,data_length + index_length AS total_length FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name REGEXP '^bill_details_archive_[0-9]{6}$' ORDER BY table_name;"
```

确认两个过程存在，三个候选索引查询无返回，并记录清理后的索引空间。

### 6. 启动并验证应用

```bash
pm2 start finance-platform
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
```

## 测试服务器2正式清理

仅在灰度观察完成并确认稳定后执行。

### 1. 登录服务器

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
```

### 2. 正式清理前检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT routine_name FROM information_schema.routines WHERE routine_schema = DATABASE() AND routine_name = 'normalize_bill_details_archive_indexes_v1048'; SELECT table_name,index_name,MIN(is_visible) AS is_visible FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name REGEXP '^bill_details_archive_[0-9]{6}$' AND index_name IN ('bd_order_file_idx','bd_task_status_idx','bd_rule_detail_split_status_idx') GROUP BY table_name,index_name ORDER BY table_name,index_name;"
```

确认辅助过程存在，且所有返回的候选索引均为 `INVISIBLE`。任一索引为 `VISIBLE` 或结果不完整时停止操作。

### 3. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 4. 执行正式清理

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.48-archive-index-finalize.sql
```

### 5. 正式清理后检查

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT routine_name FROM information_schema.routines WHERE routine_schema = DATABASE() AND routine_name IN ('normalize_bill_details_archive_indexes_v1048','ensure_bill_details_archive_month_table') ORDER BY routine_name; SELECT table_name,index_name FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name REGEXP '^bill_details_archive_[0-9]{6}$' AND index_name IN ('bd_order_file_idx','bd_task_status_idx','bd_rule_detail_split_status_idx') ORDER BY table_name,index_name; SELECT table_name,table_rows,data_length,index_length,data_length + index_length AS total_length FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name REGEXP '^bill_details_archive_[0-9]{6}$' ORDER BY table_name;"
```

确认两个过程存在，三个候选索引查询无返回，并记录清理后的索引空间。

### 6. 启动并验证应用

```bash
pm2 start finance-platform
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角显示 `v10.48`。
- 利息到账认账规则和手动认账不显示支出资金来源输入，入账结果固定保存 `非限定性-利息收入`。
- 凭证模板菜单显示 `利息收入`，模板变量说明包含 `【利息信息】`。
- 利息逐笔制单弹窗要求填写利息信息，摘要提示实时同步输入内容。
- 利息凭证明细浮层客户档案为 `北京市企业家环保基金会`，收款活动类型为 `801_其他收入`。
- 凭证汇总行银行账户显示所选银行流水关联账号的账号别称；未关联账号时显示 `-`。
- 凭证明细浮层按新版字段顺序展示，项目名称显示 `编号_NC项目名称`。
- 历史凭证继续读取原快照，历史利息手工凭证仍可取消。

## 回退

- 代码可以使用 `releases/finance-platform-v10.47-local.tar.gz` 回退。
- 单次部署在切换前会把旧运行产物保留为 `backups/dist.rollback.<部署批次>`；启动或健康检查失败时脚本自动恢复该固定回滚点。自动回滚失败时停止重复部署，保留 `dist.failed.<部署批次>` 并人工核查。
- 灰度迁移后若出现异常，不执行正式清理；在确认替代索引和业务查询前，不删除任何候选索引。
- 灰度阶段回退索引策略时，需要针对每张 `bill_details_archive_YYYYMM` 表将三个候选索引恢复为 `VISIBLE`，并恢复旧版月归档表创建过程；该操作必须使用单独审核过的回退 SQL，不在生产环境临时拼接执行。
- 正式清理后候选索引已经删除，无法通过 `ALTER INDEX ... VISIBLE` 恢复；需要根据原索引定义重新创建，必须另行制定恢复脚本和维护窗口。
- v10.48 写入的 `利息收入` 模板 JSON、凭证结果和说明快照不会因代码回退自动删除；回退前确认是否存在新版生成的利息凭证。
