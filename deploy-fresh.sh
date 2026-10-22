#!/bin/bash
# =============================================================================
# 财务对账及认账管理平台 - 全新服务器部署脚本
#
# 用法:
#   DB_PASSWORD='请改成强密码' MYSQL_ADMIN_USER=root MYSQL_ADMIN_PASSWORD='root密码' ./deploy-fresh.sh
#
# 可选环境变量:
#   DB_NAME              默认 finance_recon
#   DB_USER              默认 finance_user
#   DB_PASSWORD          数据库用户密码；未设置时自动生成
#   MYSQL_HOST           默认 localhost
#   MYSQL_ADMIN_USER     默认 root
#   MYSQL_ADMIN_PASSWORD MySQL 管理员密码；为空时不传 -p
#   APP_PORT             默认 3001
#   PM2_NAME             默认 finance-platform
#   ADMIN_USERNAME       默认 admin
#   ADMIN_PASSWORD       默认 admin
#   FORCE_RESET_DB       设为 1 时允许覆盖已有表结构
#   OVERWRITE_ENV        设为 1 时覆盖已有 .env
# =============================================================================

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
SCHEMA_FILE="$APP_DIR/database/init-fresh-schema-v9.78.sql"
DB_NAME="${DB_NAME:-finance_recon}"
DB_USER="${DB_USER:-finance_user}"
MYSQL_HOST="${MYSQL_HOST:-localhost}"
MYSQL_ADMIN_USER="${MYSQL_ADMIN_USER:-root}"
MYSQL_ADMIN_PASSWORD="${MYSQL_ADMIN_PASSWORD:-}"
APP_PORT="${APP_PORT:-3001}"
PM2_NAME="${PM2_NAME:-finance-platform}"
ADMIN_USERNAME="${ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin}"
FORCE_RESET_DB="${FORCE_RESET_DB:-0}"
OVERWRITE_ENV="${OVERWRITE_ENV:-0}"

if [ -z "${DB_PASSWORD:-}" ]; then
  if command -v openssl >/dev/null 2>&1; then
    DB_PASSWORD="$(openssl rand -hex 16)"
  else
    echo "请设置 DB_PASSWORD 后重试。"
    exit 1
  fi
fi

if ! [[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "DB_NAME 只能包含字母、数字和下划线。"
  exit 1
fi

if ! [[ "$DB_USER" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "DB_USER 只能包含字母、数字和下划线。"
  exit 1
fi

if [ ! -f "$SCHEMA_FILE" ]; then
  echo "未找到数据库结构文件：$SCHEMA_FILE"
  exit 1
fi

mysql_admin=(mysql --protocol=TCP -h "$MYSQL_HOST" -u "$MYSQL_ADMIN_USER")
if [ -n "$MYSQL_ADMIN_PASSWORD" ]; then
  mysql_admin+=("-p$MYSQL_ADMIN_PASSWORD")
fi

mysql_app=(mysql --protocol=TCP -h "$MYSQL_HOST" -u "$DB_USER" "-p$DB_PASSWORD" "$DB_NAME")

sql_quote() {
  printf "%s" "$1" | sed "s/'/''/g"
}

echo "==> 创建数据库和数据库用户"
db_name_sql="$(sql_quote "$DB_NAME")"
db_user_sql="$(sql_quote "$DB_USER")"
db_pass_sql="$(sql_quote "$DB_PASSWORD")"
"${mysql_admin[@]}" <<SQL
CREATE DATABASE IF NOT EXISTS \`$db_name_sql\`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$db_user_sql'@'localhost' IDENTIFIED BY '$db_pass_sql';
ALTER USER '$db_user_sql'@'localhost' IDENTIFIED BY '$db_pass_sql';
GRANT ALL PRIVILEGES ON \`$db_name_sql\`.* TO '$db_user_sql'@'localhost';
FLUSH PRIVILEGES;
SQL

table_count="$("${mysql_app[@]}" -N -B -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE();")"
if [ "$table_count" != "0" ] && [ "$FORCE_RESET_DB" != "1" ]; then
  echo "数据库 $DB_NAME 已存在 $table_count 张表。为避免误覆盖，已停止。"
  echo "确认要重建结构时再执行：FORCE_RESET_DB=1 ./deploy-fresh.sh"
  exit 1
fi

echo "==> 导入 v9.78 当前完整表结构"
"${mysql_app[@]}" < "$SCHEMA_FILE"

echo "==> 写入 .env"
app_secret="$(openssl rand -hex 24 2>/dev/null || date +%s%N)"
if [ ! -f "$APP_DIR/.env" ] || [ "$OVERWRITE_ENV" = "1" ]; then
  cat > "$APP_DIR/.env" <<EOF
DATABASE_URL=mysql://$DB_USER:$DB_PASSWORD@$MYSQL_HOST:3306/$DB_NAME
APP_ID=finance-platform
APP_SECRET=$app_secret
VITE_APP_ID=finance-platform
PORT=$APP_PORT
EOF
else
  echo ".env 已存在，保持不覆盖。如需覆盖请设置 OVERWRITE_ENV=1。"
fi

echo "==> 安装依赖"
cd "$APP_DIR"
npm install --no-audit --no-fund

echo "==> 构建应用"
npm run build

echo "==> 创建默认管理员（如不存在）"
DATABASE_URL="mysql://$DB_USER:$DB_PASSWORD@$MYSQL_HOST:3306/$DB_NAME" \
ADMIN_USERNAME="$ADMIN_USERNAME" \
ADMIN_PASSWORD="$ADMIN_PASSWORD" \
node --input-type=module <<'NODE'
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";

const databaseUrl = process.env.DATABASE_URL;
const username = process.env.ADMIN_USERNAME || "admin";
const password = process.env.ADMIN_PASSWORD || "admin";

const connection = await mysql.createConnection(databaseUrl);
try {
  const [rows] = await connection.execute("SELECT id FROM users WHERE username = ? LIMIT 1", [username]);
  if (rows.length === 0) {
    const hash = await bcrypt.hash(password, 10);
    await connection.execute(
      "INSERT INTO users (username, password_hash, name, role, is_active) VALUES (?, ?, ?, 'admin', 1)",
      [username, hash, "系统管理员"],
    );
    console.log(`默认管理员已创建：${username}`);
  } else {
    console.log(`默认管理员已存在：${username}`);
  }
} finally {
  await connection.end();
}
NODE

echo "==> 启动 PM2 服务"
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  NODE_ENV=production PORT="$APP_PORT" pm2 restart "$PM2_NAME" --update-env
else
  NODE_ENV=production PORT="$APP_PORT" pm2 start "$APP_DIR/dist/boot.js" --name "$PM2_NAME" --cwd "$APP_DIR" --update-env
fi
pm2 save || true

echo ""
echo "=========================================="
echo "全新部署完成"
echo "=========================================="
echo "应用目录：$APP_DIR"
echo "数据库：$DB_NAME"
echo "数据库用户：$DB_USER"
echo "数据库密码：$DB_PASSWORD"
echo "默认管理员：$ADMIN_USERNAME / $ADMIN_PASSWORD"
echo "访问地址：服务器IP:$APP_PORT"
echo ""
echo "请首次登录后立刻修改默认管理员密码。"
