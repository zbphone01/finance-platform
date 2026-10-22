# v9.74-local 部署说明

## 文件

- `releases/finance-platform-v9.74-local.tar.gz`：v9.74 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `migrate-v9.74-finance-role.sql`：v9.74 财务人员角色迁移，必须执行
- `migrate-v9.70-detail-split-rule-upload-fields.sql`：v9.70 明细认账规则分账包设置字段迁移，未执行过 v9.70 时才需要
- `docs/VERSION_SNAPSHOT_v9.74-local.md`：版本快照

## 重要说明

- 本版替代 v9.73-local 部署包；线上部署时上传 v9.74 包即可。
- 本版新增 `users.role` 枚举值 `finance`，部署前必须执行 `migrate-v9.74-finance-role.sql`。
- 本版重点调整账号角色和菜单/操作权限入口：新增财务人员，运营和财务隐藏账号管理，运营和财务隐藏认账及分账相关删除入口，运营隐藏入账结果制单入口。

## 本地迁移检查

执行 v9.74 迁移后，可用下面命令确认角色枚举包含 `finance`：

```bash
cd /home/deploy/Documents/资金池认账

mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM users LIKE 'role';"
```

如果字段枚举中没有 `finance`，先执行：

```bash
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.74-finance-role.sql
```

## 线上部署

上传部署包、部署脚本和迁移脚本：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.74-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.74-finance-role.sql \
  migrate-v9.70-detail-split-rule-upload-fields.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

登录服务器：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
```

先执行 v9.74 迁移并复查：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.74-finance-role.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM users LIKE 'role';"
```

如未执行过 v9.70 迁移，先补执行并复查：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.70-detail-split-rule-upload-fields.sql
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon -e "SHOW COLUMNS FROM recognition_rules LIKE 'detail_split_recognition_keyword_field'; SHOW COLUMNS FROM recognition_rules LIKE 'detail_split_income_field'; SHOW COLUMNS FROM recognition_rules LIKE 'detail_split_match_field';"
```

部署代码：

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.74-local.tar.gz
```

如果服务器依赖状态异常：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.74-local.tar.gz
```

如需在线上强制执行类型检查：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.74-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 管理员进入账号管理，新建账号角色下拉应包含“财务人员”。
- 运营人员和财务人员登录后，左侧不显示“账号管理”菜单。
- 运营人员和财务人员在“认账及分账”和“明细分账”列表不显示删除按钮。
- 日期汇总详情的银行流水列表不显示“取消认账”入口。
- 运营人员进入“入账结果”后，不显示“批量制单”和单条“制单 / 取消制单”按钮。
- 财务人员和管理员进入“入账结果”后，仍可看到制单相关按钮。

## 回退

- 代码可通过上一版部署包 `finance-platform-v9.73-local.tar.gz` 回退。
- 数据库如需回退角色枚举，需先确认不存在 `role = 'finance'` 的用户，再执行：

```sql
UPDATE users SET role = 'operator' WHERE role = 'finance';
ALTER TABLE users MODIFY role ENUM('admin', 'operator') NOT NULL DEFAULT 'operator';
```
