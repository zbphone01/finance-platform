# v10.85-local 全新部署

GitHub 仓库用于全新部署。现有服务器升级请继续使用本地发布包和对应的升级部署说明，不要对已有业务库执行初始化 SQL。

## 初始化文件

- `database/init-fresh-schema-v10.85.sql`：47 张业务及归档辅助表、索引、外键、10 个存储过程和按安装日期生成的 60 天热分区。没有业务数据、账号数据、固定服务器身份或历史月归档表。
- `database/fresh-schema-v10.85.json`：当前版本字段、索引及外键校验清单。
- `scripts/ensure-mysql-events.mjs`：在当前数据库创建并校验 2 个定时事件。
- `scripts/check-fresh-database.mjs`：核对完整结构、存储过程、当日分区和定时事件。
- `deploy-fresh.sh`：导入完整结构、配置应用、构建、创建管理员并启动服务。

这些文件均由 Git 跟踪。历史迁移文件保存在本机 `database/migrations/`，全新部署不需要该目录，也不需要逐版本执行迁移。

## 环境准备

服务器需具备 Node.js 22、npm、Git、MySQL 客户端、OpenSSL，以及可用的 MySQL 管理员账号。本次空库验证环境为 MySQL 9.6；其他 MySQL 版本尚未实测。MySQL 管理员需先确认 `event_scheduler=ON`；脚本不会修改全局数据库设置。

使用独立的应用目录和空数据库。脚本拒绝已有表、存储过程或事件的目标库，不提供强制清库选项。使用专用数据库用户，避免与其他应用共享账号。部署会在服务器安装依赖、构建应用；缺少 PM2 时安装 PM2。

## 获取源码并部署

```bash
git clone https://github.com/zbphone01/finance-platform.git
cd finance-platform
chmod +x deploy-fresh.sh
read -r -s -p 'MySQL 管理员密码：' MYSQL_ADMIN_PASSWORD
echo
read -r -s -p '应用数据库密码：' DB_PASSWORD
echo
read -r -s -p '应用管理员密码：' ADMIN_PASSWORD
echo
export MYSQL_ADMIN_PASSWORD DB_PASSWORD ADMIN_PASSWORD
DB_NAME=finance_recon DB_USER=finance_user MYSQL_ADMIN_USER=root \
  ADMIN_USERNAME=admin APP_PORT=3001 ./deploy-fresh.sh
unset MYSQL_ADMIN_PASSWORD DB_PASSWORD ADMIN_PASSWORD
```

请在服务器 Bash 中执行。不要将真实密码写进文档、提交或部署日志。数据库密码留空时脚本自动生成；管理员密码应填写强密码。已有 `.env` 时脚本在数据库操作前停止；只有确认是在独立部署目录中替换配置时，才设置 `OVERWRITE_ENV=1`。

脚本导入初始化结构后写入权限为 `600` 的 `.env`，安装依赖并构建，再创建 Event、核对结构，最后创建管理员和启动 PM2。结构或事件检查失败时不会进入服务启动阶段。失败后保留现场供检查；该入口不用于恢复或重建已有库。

## 完成检查

```bash
node scripts/check-fresh-database.mjs
pm2 status
pm2 logs finance-platform --lines 100 --nostream
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

随后访问服务器地址，确认页面版本、管理员登录和基础资料菜单可用。新库没有导入本地规则、银行账号或业务数据，需要按业务需求配置。

## 本地升级打包

本地迁移目录不随 GitHub 源码分发。发版时由 `scripts/release-package.mjs` 读取其中的 `migrate-*.sql`，在包根目录保留同名文件；`database/` 目录整体不进入升级包，包结构和升级部署脚本路径保持兼容。缺少必要迁移脚本时打包会报错，不会生成一个可供升级的缺件包。
