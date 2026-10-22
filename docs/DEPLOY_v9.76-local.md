# v9.76-local 部署说明

## 文件

- `releases/finance-platform-v9.76-local.tar.gz`：v9.76 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `migrate-v9.74-finance-role.sql`：v9.74 财务人员角色迁移，已部署 v9.74+ 的环境无需重复执行
- `migrate-v9.70-detail-split-rule-upload-fields.sql`：v9.70 明细认账规则分账包设置字段迁移，未执行过 v9.70 时才需要
- `docs/VERSION_SNAPSHOT_v9.76-local.md`：版本快照

## 重要说明

- 本版替代 v9.75-local 部署包；线上部署时上传 v9.76 包即可。
- 本版不新增数据库迁移。
- 已部署并迁移过 v9.75 的环境，直接部署 v9.76 代码。
- 尚未部署 v9.74 的环境，需要先执行 `migrate-v9.74-finance-role.sql`；尚未部署 v9.70 的环境，还需要补执行 `migrate-v9.70-detail-split-rule-upload-fields.sql`。
- 本版重点优化手动开始认账入队范围、登录页提示、已忽略订单取消忽略入口和状态列三点操作交互。

## 本地迁移检查

已执行过 v9.74 迁移时无需重复执行。可用下面命令确认角色枚举包含 `finance`：

```bash
cd /home/deploy/Documents/资金池认账

mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM users LIKE 'role';"
```

如果字段枚举中没有 `finance`，先执行：

```bash
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < migrate-v9.74-finance-role.sql
```

## 线上部署

上传部署包和部署脚本；未执行过 v9.74 / v9.70 迁移时同时上传迁移脚本：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v9.76-local.tar.gz \
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

如未执行过 v9.74 迁移，先执行并复查：

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
./deploy-update-optimized.sh finance-platform-v9.76-local.tar.gz
```

如果服务器依赖状态异常：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.76-local.tar.gz
```

如需在线上强制执行类型检查：

```bash
RUN_CHECK=1 ./deploy-update-optimized.sh finance-platform-v9.76-local.tar.gz
```

部署后查看：

```bash
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 登录页用户名、密码输入框不再显示 `admin` 提示，登录按钮下方不再显示测试账号说明。
- 对已完成认账的日期点击“开始认账”时，已全部认账的银行流水任务不会重新加入明细认账队列。
- 部分认账流水仍可通过“开始认账”继续补认剩余订单明细。
- 进入“认账及分账 -> 已忽略订单”，状态列显示“已忽略 + 三个点”，点击三个点可执行“取消忽略”。
- 日期汇总详情的订单明细列表中，点击状态徽标不会打开菜单，只有三个点按钮可打开操作菜单。

## 回退

- 代码可通过上一版部署包 `finance-platform-v9.75-local.tar.gz` 回退。
- 本版不新增数据库迁移，通常无需数据库回退。
