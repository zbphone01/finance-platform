#!/bin/bash
# =============================================================================
# 财务对账及认账管理平台 - 一键部署脚本 v7
# 用法: ./deploy-update.sh [包文件名]
# 示例: ./deploy-update.sh finance-platform-v9.10.4.tar.gz
# 默认: 不带参数时使用 finance-platform-v9.10.4.tar.gz
# =============================================================================

APP_DIR="/home/ubuntu/finance-platform"
PM2_NAME="finance-platform"
APP_PORT="3001"
TAR_FILE="${1:-finance-platform-v9.11.8.tar.gz}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()   { echo -e "${GREEN}[OK]${NC}   $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC}  $1"; }

# 记录失败步骤但不退出
FAILED_STEPS=""
fail_step() {
    FAILED_STEPS="$FAILED_STEPS $1"
    err "$2"
}

# 回滚函数
rollback() {
    warn "执行回滚..."
    LATEST_DIST=$(ls -td "$APP_DIR/backups"/dist.* 2>/dev/null | head -1)
    if [ -n "$LATEST_DIST" ]; then
        rm -rf "$APP_DIR/dist"
        cp -r "$LATEST_DIST" "$APP_DIR/dist"
        ok "dist 已从 backups 回滚"
    fi
    pm2 restart "$PM2_NAME" 2>/dev/null || true
}

echo ""
echo "=========================================="
echo "  财务对账平台 - 一键部署 v7"
echo "=========================================="
echo ""

# ---------------- Step 1: 前置检查 ----------------
info "Step 1/6: 前置检查..."
cd "$APP_DIR" || { err "无法进入 $APP_DIR"; exit 1; }

[ ! -f "$TAR_FILE" ] && { err "未找到 $TAR_FILE"; exit 1; }
tar tzf "$TAR_FILE" >/dev/null 2>&1 || { err "tar 包损坏"; exit 1; }
[ ! -f ".env" ] && { err ".env 不存在"; exit 1; }
ok "前置检查通过"

# ---------------- Step 2: 备份当前构建 ----------------
info "Step 2/6: 备份当前构建..."
mkdir -p "$APP_DIR/backups"
if [ -d "dist" ]; then
    cp -r "dist" "$APP_DIR/backups/dist.$(date +%Y%m%d_%H%M%S)"
    ok "dist 已备份至 backups/"
fi

# ---------------- Step 3: 更新源码 ----------------
info "Step 3/6: 解压新代码..."
ENV_BACKUP="$APP_DIR/.env.deploy_backup.$(date +%Y%m%d_%H%M%S)"
cp ".env" "$ENV_BACKUP"
tar xzf "$TAR_FILE" --overwrite 2>/dev/null || true
cp "$ENV_BACKUP" ".env"
rm -f "$ENV_BACKUP"
if grep -q "finance_sandbox" ".env"; then
    err "线上 .env 仍指向 finance_sandbox，请先修正 DATABASE_URL 后再部署"
    exit 1
fi
ok "源码已更新"

# ---------------- Step 4: 安装依赖 ----------------
info "Step 4/6: 安装依赖..."
npm install 2>&1 | tail -3
ok "依赖安装完成"

# ---------------- Step 5: 推送数据库 Schema ----------------
info "Step 5/6: 检查数据库连接..."

# 使用项目 node_modules 中的 mysql2，脚本放在项目目录下
cat > "$APP_DIR/.check-db.mjs" << 'EOF'
import mysql from 'mysql2/promise';
import fs from 'fs';
const env = fs.readFileSync('.env', 'utf8');
const line = env.split('\n').find(l => l.trim().startsWith('DATABASE_URL='));
if (!line) {
  console.error('DATABASE_URL is missing');
  process.exit(1);
}
const url = line
  .replace(/^DATABASE_URL=/, '')
  .trim()
  .replace(/^['"]|['"]$/g, '')
  .replace('mysql2:', 'mysql:');
try {
  const c = await mysql.createConnection(url);
  await c.execute('SELECT 1');
  await c.end();
  console.log('OK');
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
EOF

DB_OK=$(node "$APP_DIR/.check-db.mjs" 2>&1)
rm -f "$APP_DIR/.check-db.mjs"

if echo "$DB_OK" | grep -q "OK"; then
    ok "数据库连接正常"
else
    err "数据库连接检查失败，请先修正线上 .env 的 DATABASE_URL"
    echo "$DB_OK"
    exit 1
fi

if [ "${RUN_SCHEMA_PUSH:-0}" = "1" ]; then
    info "执行数据库 schema 推送..."
    PUSH_OUTPUT=$(script -q -c "npx drizzle-kit push --force" /dev/null 2>&1)
    echo "$PUSH_OUTPUT" | tail -5
    if echo "$PUSH_OUTPUT" | grep -qE "Changes applied|No changes detected"; then
        ok "数据库 schema 推送完成"
    else
        err "schema 推送失败"
        exit 1
    fi
else
    ok "跳过 schema 推送，本项目使用明确 SQL 迁移脚本管理数据库变更"
fi

# ---------------- Step 6: 构建 + 重启 ----------------
info "Step 6/6: 构建并重启..."

# 类型检查
if ! npm run check 2>&1; then
    err "TypeScript 类型检查失败"
    rollback
    exit 1
fi
ok "类型检查通过"

# 构建
if ! npm run build 2>&1 | tail -5; then
    err "构建失败"
    rollback
    exit 1
fi

# 验证构建产物
if [ ! -f "$APP_DIR/dist/public/index.html" ]; then
    err "构建产物不完整"
    rollback
    exit 1
fi
ok "构建完成"

# 重启 PM2
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
    pm2 restart "$PM2_NAME"
else
    [ -f "ecosystem.config.cjs" ] && pm2 start ecosystem.config.cjs || pm2 start dist/boot.js --name "$PM2_NAME"
    pm2 save
fi

sleep 2

# 健康检查
HTTP_OK=0
for i in 1 2 3; do
    curl -s http://127.0.0.1:$APP_PORT | grep -qi "html\|doctype" 2>/dev/null && { HTTP_OK=1; break; }
    sleep 1
done

# 清理旧备份：backups/ 目录下保留最近 3 个 dist.*
ls -td "$APP_DIR/backups"/dist.* 2>/dev/null | tail -n +4 | xargs -r rm -rf 2>/dev/null || true

# 清理旧部署包：只保留当前使用的 tar.gz
for f in "$APP_DIR"/finance-platform-*.tar.gz; do
    [ -f "$f" ] || continue
    [ "$(basename "$f")" = "$TAR_FILE" ] && continue
    rm -f "$f"
done

echo ""
echo "=========================================="
if [ "$HTTP_OK" -eq 1 ]; then
    echo -e "${GREEN}部署完成！${NC}"
else
    echo -e "${YELLOW}部署完成，服务响应待确认${NC}"
fi
echo "=========================================="
echo ""
echo "  访问: http://server1.example.com:$APP_PORT/"
echo "  日志: pm2 logs $PM2_NAME"
echo ""
