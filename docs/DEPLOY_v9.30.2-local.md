# v9.30.2-local 部署说明

## 文件

- `releases/finance-platform-v9.30.2-local.tar.gz`：源码部署包
- `deploy-update-optimized.sh`：推荐服务器部署脚本
- `docs/VERSION_SNAPSHOT_v9.30.2-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：最新技能文档
- `migrate-v9.31-order-file-abnormal-status.sql`：订单明细异常状态迁移
- `migrate-v9.30-clean-invalid-date-packages.sql`：非日期脏数据清理脚本

## 重要说明

本版修复订单明细上传排查和异常包处理：

- 上传错误提示简化为错误行和错误原因。
- 微信支付尾部纯数字汇总行兼容 `0.0_1` 这类解析后缀。
- 订单总金额为 `0` 的明细数据包标记为“异常”，不参与自动或手动认账。

本版新增数据库枚举值，部署代码前必须执行：

- `migrate-v9.31-order-file-abnormal-status.sql`

如果线上尚未部署 v9.27/v9.28/v9.29/v9.30，还需要先执行前置迁移：

- `migrate-v9.27-bill-details-rule-dedupe.sql`
- `migrate-v9.28-bill-detail-operations.sql`
- `migrate-v9.29-match-result-voucher-status.sql`
- `migrate-v9.30-clean-invalid-date-packages.sql`（仅清理非日期脏数据时执行）

## 线上部署步骤

### 1. 上传部署包、迁移脚本和部署脚本

```bash
scp releases/finance-platform-v9.30.2-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.31-order-file-abnormal-status.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 线上备份数据库

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform

mysqldump \
  -u finance_user \
  -p \
  --no-tablespaces \
  --skip-lock-tables \
  --set-gtid-purged=OFF \
  finance_recon \
  > backup_before_v9.30.2.sql
```

### 3. 执行数据库迁移

```bash
mysql -u finance_user -p finance_recon < migrate-v9.31-order-file-abnormal-status.sql
```

执行后检查：

```bash
mysql -u finance_user -p finance_recon -e "SHOW COLUMNS FROM order_files LIKE 'upload_status';"
```

返回的 `Type` 应包含 `abnormal`。

### 4. 部署代码

```bash
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.30.2-local.tar.gz
```

如需强制重新安装依赖：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.30.2-local.tar.gz
```

### 5. 查看服务状态和日志

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 上传微信支付订单明细 CSV，尾部汇总标题行和纯数字汇总行不应进入订单明细。
- 上传失败时，弹窗只显示错误行和错误原因。
- 上传订单总金额为 `0` 的明细数据包后，订单明细列表应显示“异常”。
- 异常数据包不应触发自动明细认账。
- 点击“开始认账”时，异常数据包不应参与手动明细认账。

## 回退提醒

- 代码可通过上一版部署包回退。
- 若已写入 `abnormal` 状态，回退数据库枚举前需要先将异常状态数据处理为 `failed` 或 `completed`。
