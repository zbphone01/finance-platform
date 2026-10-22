# v10.29-local 部署说明

## 文件

- `releases/finance-platform-v10.29-local.tar.gz`：v10.29 部署包
- `migrate-v10.29-drop-bd-desc-idx.sql`：订单明细描述字段索引删除迁移
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.29-local.md`：版本快照

## 重要说明

- 从 v10.28 升级到 v10.29，需要上传代码包和 v10.29 迁移脚本，先执行迁移，再部署代码包。
- 如果目标环境尚未部署 v10.28，需要先补齐 v10.26、v10.27、v10.28 历史迁移。
- 本迁移会处理 `bill_details` 和已有 `bill_details_archive_YYYYMM` 归档表。
- 迁移仅删除 `bd_desc_idx(description)`，不删除业务字段。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.29-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.29-drop-bd-desc-idx.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

迁移前检查、执行和复查：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT table_name, index_name FROM information_schema.statistics WHERE table_schema = DATABASE() AND (table_name = 'bill_details' OR table_name LIKE 'bill\\_details\\_archive\\_%') AND index_name = 'bd_desc_idx' ORDER BY table_name;"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.29-drop-bd-desc-idx.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT table_name, index_name FROM information_schema.statistics WHERE table_schema = DATABASE() AND (table_name = 'bill_details' OR table_name LIKE 'bill\\_details\\_archive\\_%') AND index_name = 'bd_desc_idx' ORDER BY table_name;"
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.29-local.tar.gz
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.29-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v10.29-drop-bd-desc-idx.sql \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

迁移前检查、执行和复查：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT table_name, index_name FROM information_schema.statistics WHERE table_schema = DATABASE() AND (table_name = 'bill_details' OR table_name LIKE 'bill\\_details\\_archive\\_%') AND index_name = 'bd_desc_idx' ORDER BY table_name;"
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v10.29-drop-bd-desc-idx.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SELECT table_name, index_name FROM information_schema.statistics WHERE table_schema = DATABASE() AND (table_name = 'bill_details' OR table_name LIKE 'bill\\_details\\_archive\\_%') AND index_name = 'bd_desc_idx' ORDER BY table_name;"
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.29-local.tar.gz
```

## 异常处理

如果服务器依赖状态异常，测试服务器1：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.29-local.tar.gz
```

如果服务器依赖状态异常，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v10.29-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器1：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.29-local.tar.gz
```

如需在线上强制执行类型检查，测试服务器2：

```bash
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v10.29-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号应显示 `v10.29`。
- 迁移后复查 `bd_desc_idx` 查询应返回空结果。
- 订单明细包列表、日期明细列表、已忽略明细列表和自动认账流程应正常。

## 回退

- 代码可通过上一版部署包 `finance-platform-v10.28-local.tar.gz` 回退。
- 数据库索引如需回退，对主表和归档月表重新执行：

```sql
ALTER TABLE bill_details ADD INDEX bd_desc_idx (description);
```
