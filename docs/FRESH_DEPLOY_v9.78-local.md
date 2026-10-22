# v9.78-local 全新服务器部署说明

## 文件

- `releases/finance-platform-v9.78-fresh.tar.gz`：全新部署包
- `deploy-fresh.sh`：全新服务器部署脚本
- `database/init-fresh-schema-v9.78.sql`：当前版本完整数据库结构

## 适用场景

- 新服务器第一次部署财务对账平台。
- 新建一个空数据库并按当前 v9.78 结构直接初始化。
- 不需要从 v9.45、v9.64、v9.70 等历史版本逐个执行迁移。

不适用于已有生产库升级。已有环境升级仍使用 `releases/finance-platform-v9.78-local.tar.gz` 和 `migrate-v9.78-refund-amount-snapshot.sql`。

## 服务器准备

新服务器需要先具备：

- Node.js 和 npm
- MySQL
- 可用的 MySQL 管理员账号，例如 `root`

脚本会自动安装依赖、构建应用，并在缺少 PM2 时尝试安装 PM2。

## 部署步骤

上传并解压：

```bash
scp releases/finance-platform-v9.78-fresh.tar.gz ubuntu@服务器IP:/home/ubuntu/

ssh ubuntu@服务器IP
mkdir -p /home/ubuntu/finance-platform
tar -xzf /home/ubuntu/finance-platform-v9.78-fresh.tar.gz -C /home/ubuntu/finance-platform
cd /home/ubuntu/finance-platform
chmod +x deploy-fresh.sh
```

执行全新部署：

```bash
DB_NAME=finance_recon \
DB_USER=finance_user \
DB_PASSWORD='请改成强数据库密码' \
MYSQL_ADMIN_USER=root \
MYSQL_ADMIN_PASSWORD='MySQL-root密码' \
APP_PORT=3001 \
ADMIN_USERNAME=admin \
ADMIN_PASSWORD='请改成强管理员密码' \
./deploy-fresh.sh
```

如果 MySQL root 本机免密登录，可省略 `MYSQL_ADMIN_PASSWORD`。

## 脚本会做什么

1. 创建数据库 `DB_NAME`。
2. 创建数据库用户 `DB_USER` 并授权。
3. 导入 `database/init-fresh-schema-v9.78.sql` 当前完整表结构。
4. 写入 `.env`。
5. 执行 `npm install`。
6. 执行 `npm run build`。
7. 创建默认管理员。
8. 使用 PM2 启动应用。

## 安全提醒

- 不要使用示例密码上线。
- 首次登录后立刻修改管理员密码。
- 如果目标数据库已经有表，脚本默认会停止，避免误覆盖。
- 只有确认要重建空库时，才使用：

```bash
FORCE_RESET_DB=1 ./deploy-fresh.sh
```

## 默认值

- `DB_NAME`：`finance_recon`
- `DB_USER`：`finance_user`
- `APP_PORT`：`3001`
- `PM2_NAME`：`finance-platform`
- `ADMIN_USERNAME`：`admin`
- `ADMIN_PASSWORD`：`admin`

未设置 `DB_PASSWORD` 时，脚本会自动生成一个随机数据库密码并在完成时显示。
