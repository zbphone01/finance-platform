#!/bin/bash
# =============================================================================
# 财务对账及认账管理平台 - 预构建产物部署脚本
# 用法:
#   ./deploy-update-optimized.sh finance-platform-v10.85-local.tar.gz
#   ./deploy-update-optimized.sh --check-database
#   ./deploy-update-optimized.sh --check-and-migrate-database
#
# 可选环境变量:
#   APP_DIR             应用目录，默认 /home/ubuntu/finance-platform
#   APP_PORT            应用端口，默认 3001
#   PM2_NAME            PM2 应用名，默认 finance-platform
#   ACCESS_HOST         部署完成后提示的访问主机，默认 server1.example.com
#   FORCE_NPM_INSTALL=1 即使生产依赖未变化，也在暂存目录重装生产依赖
#   NPM_INSTALL_*       覆盖依赖安装的资源阈值、内存上限和超时参数
#   NPM_FETCH_*         覆盖 npm 下载超时和重试次数
# =============================================================================

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/home/ubuntu/finance-platform}"
PM2_NAME="${PM2_NAME:-finance-platform}"
APP_PORT="${APP_PORT:-3001}"
ACCESS_HOST="${ACCESS_HOST:-server1.example.com}"
CURRENT_RELEASE_VERSION="v10.85"
CURRENT_RELEASE_BASELINE_VERSION="v10.84"
CURRENT_RELEASE_MIGRATION_FILE=""
CURRENT_RELEASE_DATABASE_CHECKER="check_v1085_rule_condition_editor_database"
DATABASE_ACTION=""
case "${1:-}" in
  --check-database)
    [ "$#" -eq 1 ] || { echo "--check-database 不接受其他参数" >&2; exit 2; }
    DATABASE_ACTION="check"
    TAR_INPUT=""
    ;;
  --check-and-migrate-database)
    [ "$#" -eq 1 ] || { echo "--check-and-migrate-database 不接受其他参数" >&2; exit 2; }
    DATABASE_ACTION="check-and-migrate"
    TAR_INPUT=""
    ;;
  --*)
    echo "未知参数：$1" >&2
    exit 2
    ;;
  *)
    [ "$#" -le 1 ] || { echo "部署模式只接受一个发布包路径" >&2; exit 2; }
    TAR_INPUT="${1:-finance-platform-v10.85-local.tar.gz}"
    ;;
esac
NPM_INSTALL_MIN_MEMORY_MB="${NPM_INSTALL_MIN_MEMORY_MB:-512}"
NPM_INSTALL_MIN_DISK_MB="${NPM_INSTALL_MIN_DISK_MB:-1024}"
NPM_INSTALL_MIN_INODES="${NPM_INSTALL_MIN_INODES:-10000}"
NPM_INSTALL_TIMEOUT_SECONDS="${NPM_INSTALL_TIMEOUT_SECONDS:-1200}"
NPM_INSTALL_MAX_OLD_SPACE_MB="${NPM_INSTALL_MAX_OLD_SPACE_MB:-384}"
NPM_FETCH_TIMEOUT_MS="${NPM_FETCH_TIMEOUT_MS:-60000}"
NPM_FETCH_RETRIES="${NPM_FETCH_RETRIES:-2}"

if [ -n "$DATABASE_ACTION" ]; then
  TAR_FILE=""
elif [[ "$TAR_INPUT" = /* ]]; then
  TAR_FILE="$TAR_INPUT"
else
  TAR_FILE="$APP_DIR/$TAR_INPUT"
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()   { echo -e "${GREEN}[OK]${NC}   $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()  { echo -e "${RED}[ERR]${NC}  $1"; }

DEPLOY_ID="$(date +%Y%m%d_%H%M%S)_$$"
BACKUP_DIR="$APP_DIR/backups"
STAGE_DIR="$APP_DIR/.deploy-stage.$DEPLOY_ID"
ROLLBACK_DIST="$BACKUP_DIR/dist.rollback.$DEPLOY_ID"
FAILED_DIST="$BACKUP_DIR/dist.failed.$DEPLOY_ID"
ROLLBACK_NODE_MODULES="$BACKUP_DIR/node_modules.rollback.$DEPLOY_ID"
FAILED_NODE_MODULES="$BACKUP_DIR/node_modules.failed.$DEPLOY_ID"

APP_EXISTS=0
APP_WAS_RUNNING=0
APP_STOPPED_BY_SCRIPT=0
RUNTIME_SWITCH_STARTED=0
NODE_MODULES_SWITCH_STARTED=0
DEPLOY_SUCCEEDED=0

safe_remove_tree() {
  local target="$1"
  case "$target" in
    "$APP_DIR"/.deploy-stage.*|\
    "$BACKUP_DIR"/dist.rollback.*|\
    "$BACKUP_DIR"/dist.failed.*|\
    "$BACKUP_DIR"/node_modules.rollback.*|\
    "$BACKUP_DIR"/node_modules.failed.*)
      rm -rf -- "$target"
      ;;
    *)
      err "拒绝清理非部署临时目录：$target"
      return 1
      ;;
  esac
}

cleanup_stage() {
  if [ -d "$STAGE_DIR" ]; then
    safe_remove_tree "$STAGE_DIR" || true
  fi
}

restart_existing_app() {
  if [ "$APP_EXISTS" -eq 1 ] && [ "$APP_WAS_RUNNING" -eq 1 ]; then
    NODE_ENV=production PORT="$APP_PORT" pm2 restart "$PM2_NAME" --update-env >/dev/null 2>&1 || true
  fi
}

rollback_runtime() {
  warn "执行本轮固定备份回滚..."

  if [ "$NODE_MODULES_SWITCH_STARTED" -eq 1 ] || [ -e "$ROLLBACK_NODE_MODULES" ]; then
    if [ -e "$ROLLBACK_NODE_MODULES" ]; then
      if [ -e "$APP_DIR/node_modules" ]; then
        [ -e "$FAILED_NODE_MODULES" ] && safe_remove_tree "$FAILED_NODE_MODULES"
        mv "$APP_DIR/node_modules" "$FAILED_NODE_MODULES"
      fi
      mv "$ROLLBACK_NODE_MODULES" "$APP_DIR/node_modules"
    else
      warn "部署前没有 node_modules 备份，保留新安装依赖供旧产物恢复使用"
    fi
  fi

  if [ "$RUNTIME_SWITCH_STARTED" -eq 1 ] || [ -e "$ROLLBACK_DIST" ]; then
    if [ -e "$APP_DIR/dist" ]; then
      [ -e "$FAILED_DIST" ] && safe_remove_tree "$FAILED_DIST"
      mv "$APP_DIR/dist" "$FAILED_DIST"
    fi
    if [ -e "$ROLLBACK_DIST" ]; then
      mv "$ROLLBACK_DIST" "$APP_DIR/dist"
    fi
  fi

  restart_existing_app
  warn "已恢复部署前运行产物；失败产物保留在 backups/ 供排查"
}

handle_failure() {
  local exit_code="$1"
  local line_no="${2:-unknown}"
  trap - ERR INT TERM HUP
  set +e
  err "部署在第 $line_no 行失败，退出码 $exit_code"
  if [ "$DEPLOY_SUCCEEDED" -eq 0 ] && {
    [ "$RUNTIME_SWITCH_STARTED" -eq 1 ] ||
    [ "$APP_STOPPED_BY_SCRIPT" -eq 1 ] ||
    [ -e "$ROLLBACK_DIST" ] ||
    [ -e "$ROLLBACK_NODE_MODULES" ]
  }; then
    rollback_runtime
  fi
  exit "$exit_code"
}

require_positive_integer() {
  local name="$1"
  local value="$2"
  if [[ ! "$value" =~ ^[1-9][0-9]*$ ]]; then
    err "$name 必须是正整数，当前值：$value"
    return 1
  fi
}

check_runtime_dependencies() {
  local work_dir="$1"
  (
    cd "$work_dir"
    node --input-type=module -e "await Promise.all([import('@hono/node-server'), import('@trpc/server'), import('mysql2'), import('drizzle-orm'), import('dotenv')])"
  )
}

ensure_migration_processes_stopped() {
  local process_name=""
  local process_pids=""

  command -v pm2 >/dev/null 2>&1 || {
    err "服务器缺少 pm2，无法确认联动应用已经停止"
    return 1
  }

  for process_name in finance-platform ticket-platform; do
    process_pids="$(pm2 pid "$process_name" 2>/dev/null || true)"
    if grep -Eq '^[1-9][0-9]*$' <<<"$process_pids"; then
      err "$process_name 仍在运行，拒绝执行数据库迁移"
      return 1
    fi
  done
}

check_v1085_rule_condition_editor_database() {
  local work_dir="$1"
  local action="$2"
  local migration_file="$3"

  (
    cd "$work_dir"
    [ -s "scripts/check-v10.85-rule-condition-editor-database.mjs" ] || {
      err "缺少 v10.85 数据库检查脚本"
      return 1
    }
    DATABASE_CONTROL_ACTION="$action" \
    DATABASE_APP_DIR="$APP_DIR" \
      node scripts/check-v10.85-rule-condition-editor-database.mjs
  )
}

run_current_release_database_check() {
  local work_dir="$1"
  local action="$2"
  local migration_file="$3"

  declare -F "$CURRENT_RELEASE_DATABASE_CHECKER" >/dev/null 2>&1 || {
    err "当前版本 $CURRENT_RELEASE_VERSION 未配置数据库检查器：$CURRENT_RELEASE_DATABASE_CHECKER"
    return 1
  }
  "$CURRENT_RELEASE_DATABASE_CHECKER" "$work_dir" "$action" "$migration_file"
}

check_install_resources() {
  local available_memory_kb=""
  local swap_free_kb=""
  local free_disk_kb=""
  local free_inodes=""

  if [ ! -r /proc/meminfo ]; then
    err "无法读取 /proc/meminfo，拒绝在资源状态未知时执行 npm ci"
    return 1
  fi

  available_memory_kb="$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)"
  swap_free_kb="$(awk '/^SwapFree:/ {print $2}' /proc/meminfo)"
  if [[ ! "$available_memory_kb" =~ ^[0-9]+$ ]] || [[ ! "$swap_free_kb" =~ ^[0-9]+$ ]]; then
    err "无法解析 /proc/meminfo，拒绝在资源状态未知时执行 npm ci"
    return 1
  fi

  info "依赖安装资源：可用内存 $((available_memory_kb / 1024)) MB，空闲 Swap $((swap_free_kb / 1024)) MB"
  if [ "$available_memory_kb" -lt "$((NPM_INSTALL_MIN_MEMORY_MB * 1024))" ]; then
    err "可用内存不足 ${NPM_INSTALL_MIN_MEMORY_MB} MB，拒绝执行 npm ci；请先释放内存，或审慎调整 NPM_INSTALL_MIN_MEMORY_MB"
    return 1
  fi

  free_disk_kb="$(df -Pk "$APP_DIR" | awk 'END {print $4}')"
  free_inodes="$(df -Pi "$APP_DIR" | awk 'END {print $4}')"
  if [[ ! "$free_disk_kb" =~ ^[0-9]+$ ]] || [[ ! "$free_inodes" =~ ^[0-9]+$ ]]; then
    err "无法解析应用盘空间或 inode，拒绝在资源状态未知时执行 npm ci"
    return 1
  fi

  info "依赖安装资源：应用盘可用 $((free_disk_kb / 1024)) MB、inode $free_inodes"
  if [ "$free_disk_kb" -lt "$((NPM_INSTALL_MIN_DISK_MB * 1024))" ]; then
    err "应用盘空间不足 ${NPM_INSTALL_MIN_DISK_MB} MB，拒绝执行 npm ci"
    return 1
  fi
  if [ "$free_inodes" -lt "$NPM_INSTALL_MIN_INODES" ]; then
    err "应用盘可用 inode 少于 $NPM_INSTALL_MIN_INODES，拒绝执行 npm ci"
    return 1
  fi
}

run_npm_install() {
  local -a install_command=(
    npm ci
    --omit=dev
    --no-audit
    --no-fund
    --prefer-offline
    "--fetch-timeout=$NPM_FETCH_TIMEOUT_MS"
    "--fetch-retries=$NPM_FETCH_RETRIES"
  )
  local required_command=""

  for required_command in npm ionice nice timeout; do
    command -v "$required_command" >/dev/null 2>&1 || {
      err "服务器缺少 $required_command，拒绝无资源保护地执行 npm ci"
      return 1
    }
  done

  install_command=(ionice -c2 -n7 "${install_command[@]}")
  install_command=(nice -n 10 "${install_command[@]}")
  install_command=(timeout --signal=TERM --kill-after=30s "${NPM_INSTALL_TIMEOUT_SECONDS}s" "${install_command[@]}")

  (
    cd "$STAGE_DIR"
    NODE_OPTIONS="--max-old-space-size=$NPM_INSTALL_MAX_OLD_SPACE_MB" \
      npm_config_jobs=1 \
      "${install_command[@]}"
  )
}

prune_successful_backups() {
  local -a dist_backups=()
  local -a node_backups=()
  local i

  mapfile -t dist_backups < <(ls -td "$BACKUP_DIR"/dist.rollback.* 2>/dev/null || true)
  for ((i = 3; i < ${#dist_backups[@]}; i++)); do
    safe_remove_tree "${dist_backups[$i]}" || warn "旧 dist 备份清理失败：${dist_backups[$i]}"
  done

  mapfile -t node_backups < <(ls -td "$BACKUP_DIR"/node_modules.rollback.* 2>/dev/null || true)
  for ((i = 1; i < ${#node_backups[@]}; i++)); do
    safe_remove_tree "${node_backups[$i]}" || warn "旧 node_modules 备份清理失败：${node_backups[$i]}"
  done
}

if [ -n "$DATABASE_ACTION" ]; then
  cd "$APP_DIR"
  [ -f ".env" ] || { err ".env 不存在"; exit 1; }
  CURRENT_RELEASE_MIGRATION_PATH="$APP_DIR/$CURRENT_RELEASE_MIGRATION_FILE"
  info "当前发布迁移：$CURRENT_RELEASE_BASELINE_VERSION -> $CURRENT_RELEASE_VERSION（$CURRENT_RELEASE_MIGRATION_FILE）"
  if [ "$DATABASE_ACTION" = "check" ]; then
    run_current_release_database_check "$APP_DIR" "check" "$CURRENT_RELEASE_MIGRATION_PATH"
    exit 0
  fi
  probe_status=0
  if run_current_release_database_check "$APP_DIR" "probe" "$CURRENT_RELEASE_MIGRATION_PATH"; then
    exit 0
  else
    probe_status="$?"
  fi
  if [ "$probe_status" -ne 10 ]; then
    exit "$probe_status"
  fi
  ensure_migration_processes_stopped
  run_current_release_database_check "$APP_DIR" "migrate" "$CURRENT_RELEASE_MIGRATION_PATH"
  exit 0
fi

trap 'handle_failure $? $LINENO' ERR
trap 'handle_failure 130 $LINENO' INT TERM HUP
trap cleanup_stage EXIT

echo ""
echo "=========================================="
echo "  财务对账平台 - 预构建产物部署"
echo "=========================================="
echo ""

info "Step 1/8: 前置检查..."
cd "$APP_DIR"
if pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  APP_EXISTS=1
  APP_PIDS="$(pm2 pid "$PM2_NAME" 2>/dev/null || true)"
  if grep -Eq '^[1-9][0-9]*$' <<<"$APP_PIDS"; then
    APP_WAS_RUNNING=1
  fi
fi
[ -f "$TAR_FILE" ] || { err "未找到 $TAR_FILE"; false; }
[ -f ".env" ] || { err ".env 不存在"; false; }
ARCHIVE_CONTENTS="$(tar --warning=no-unknown-keyword -tzf "$TAR_FILE")"

if grep -Eq '(^/|(^|/)\.\.(/|$))' <<<"$ARCHIVE_CONTENTS"; then
  err "部署包包含不安全路径"
  false
fi

if grep -Eq '(^|/)(\.env([^/]+)?|node_modules|\.git|releases|\.upload-cache)(/|$)|(^|/)\._[^/]*$' <<<"$ARCHIVE_CONTENTS"; then
  err "部署包包含禁止文件或目录"
  false
fi

grep -Eq '(^|/)dist/boot\.js$' <<<"$ARCHIVE_CONTENTS" || { err "部署包缺少 dist/boot.js"; false; }
grep -Eq '(^|/)dist/public/index\.html$' <<<"$ARCHIVE_CONTENTS" || { err "部署包缺少 dist/public/index.html"; false; }
ok "部署包与环境前置检查通过"

info "Step 2/8: 检查线上 .env..."
if grep -q "finance_sandbox\|finance_recon_sandbox" ".env"; then
  err "线上 .env 仍指向沙盒数据库，请先修正 DATABASE_URL"
  grep "DATABASE_URL" ".env" | sed -E 's#//([^:]+):[^@]+@#//\1:******@#'
  false
fi
if ! grep -q "finance_recon" ".env" || ! grep -q "finance_user" ".env"; then
  warn ".env 未明显包含 finance_user / finance_recon，请确认 DATABASE_URL 是否为线上库"
  grep "DATABASE_URL" ".env" | sed -E 's#//([^:]+):[^@]+@#//\1:******@#'
fi
ok ".env 检查完成"

info "Step 3/8: 解压并校验暂存产物..."
mkdir -p "$BACKUP_DIR" "$STAGE_DIR"
tar --warning=no-unknown-keyword -xzf "$TAR_FILE" -C "$STAGE_DIR"
find "$STAGE_DIR" -name '._*' -type f -delete 2>/dev/null || true

[ -s "$STAGE_DIR/dist/boot.js" ] || { err "暂存的 dist/boot.js 为空或不存在"; false; }
[ -s "$STAGE_DIR/dist/public/index.html" ] || { err "暂存的 dist/public/index.html 为空或不存在"; false; }
[ -s "$STAGE_DIR/package.json" ] || { err "暂存的 package.json 为空或不存在"; false; }
[ -s "$STAGE_DIR/package-lock.json" ] || { err "暂存的 package-lock.json 为空或不存在"; false; }
if [ -s "$STAGE_DIR/scripts/runtime-lock-fingerprint.mjs" ]; then
  FINGERPRINT_SCRIPT="$STAGE_DIR/scripts/runtime-lock-fingerprint.mjs"
elif [ -s "$APP_DIR/scripts/runtime-lock-fingerprint.mjs" ]; then
  FINGERPRINT_SCRIPT="$APP_DIR/scripts/runtime-lock-fingerprint.mjs"
  warn "目标发布包未包含生产依赖指纹脚本，使用当前应用中的脚本兼容旧版本回退"
else
  err "生产依赖指纹脚本不存在"
  false
fi
node --check "$STAGE_DIR/dist/boot.js"

EXPECTED_VERSION=""
if [[ "$(basename "$TAR_FILE")" =~ finance-platform-(v[0-9]+(\.[0-9]+)+)-local\.tar\.gz$ ]]; then
  EXPECTED_VERSION="${BASH_REMATCH[1]}"
fi
if [ -n "$EXPECTED_VERSION" ] && ! grep -Rqs -- "$EXPECTED_VERSION" "$STAGE_DIR/dist/public/assets"; then
  err "暂存前端未找到版本标识 $EXPECTED_VERSION"
  false
fi
ok "预构建产物完整${EXPECTED_VERSION:+，版本 $EXPECTED_VERSION}"

info "Step 4/8: 检查运行依赖..."
for config_pair in \
  "NPM_INSTALL_MIN_MEMORY_MB:$NPM_INSTALL_MIN_MEMORY_MB" \
  "NPM_INSTALL_MIN_DISK_MB:$NPM_INSTALL_MIN_DISK_MB" \
  "NPM_INSTALL_MIN_INODES:$NPM_INSTALL_MIN_INODES" \
  "NPM_INSTALL_TIMEOUT_SECONDS:$NPM_INSTALL_TIMEOUT_SECONDS" \
  "NPM_INSTALL_MAX_OLD_SPACE_MB:$NPM_INSTALL_MAX_OLD_SPACE_MB" \
  "NPM_FETCH_TIMEOUT_MS:$NPM_FETCH_TIMEOUT_MS" \
  "NPM_FETCH_RETRIES:$NPM_FETCH_RETRIES"; do
  require_positive_integer "${config_pair%%:*}" "${config_pair#*:}"
done

OLD_RUNTIME_FINGERPRINT=""
if [ -f "$APP_DIR/package-lock.json" ]; then
  OLD_RUNTIME_FINGERPRINT="$(node "$FINGERPRINT_SCRIPT" "$APP_DIR/package-lock.json")"
fi
NEW_RUNTIME_FINGERPRINT="$(node "$FINGERPRINT_SCRIPT" "$STAGE_DIR/package-lock.json")"
NEED_INSTALL=0
INSTALL_REASON=""
if [ "${FORCE_NPM_INSTALL:-0}" = "1" ]; then
  NEED_INSTALL=1
  INSTALL_REASON="FORCE_NPM_INSTALL=1"
elif [ ! -d "$APP_DIR/node_modules" ]; then
  NEED_INSTALL=1
  INSTALL_REASON="服务器缺少 node_modules"
elif [ "$OLD_RUNTIME_FINGERPRINT" != "$NEW_RUNTIME_FINGERPRINT" ]; then
  NEED_INSTALL=1
  INSTALL_REASON="生产依赖指纹发生变化"
fi

if [ "$NEED_INSTALL" -eq 1 ]; then
  info "需要安装生产依赖：$INSTALL_REASON"
  check_install_resources
  run_npm_install
else
  info "生产依赖未变化，复用现有 node_modules"
fi
check_runtime_dependencies "$STAGE_DIR"
if [ "$NEED_INSTALL" -eq 1 ]; then
  ok "暂存依赖安装并校验完成"
else
  ok "现有运行依赖校验完成"
fi

info "Step 5/8: 检查数据库与 MySQL Event..."
ln -s "$APP_DIR/.env" "$STAGE_DIR/.env"
run_current_release_database_check \
  "$STAGE_DIR" \
  "verify" \
  "$APP_DIR/$CURRENT_RELEASE_MIGRATION_FILE"
(
  cd "$STAGE_DIR"
  npm run --silent db:events:ensure
)
ok "数据库连接与 MySQL Event 检查完成"

info "Step 6/8: 更新源码并准备切换..."
tar --warning=no-unknown-keyword \
  --exclude='./dist' \
  --exclude='./.env' \
  --exclude='./.env.*' \
  --exclude='./node_modules' \
  --exclude='./backups' \
  --exclude='./logs' \
  --exclude='./releases' \
  --exclude='./.upload-cache' \
  --exclude='./outputs' \
  --exclude='./database' \
  -xzf "$TAR_FILE" -C "$APP_DIR" --overwrite
ok "源码已更新，线上 .env、缓存、日志和数据目录保持不变"

if [ "$APP_WAS_RUNNING" -eq 1 ]; then
  pm2 stop "$PM2_NAME"
  APP_STOPPED_BY_SCRIPT=1
fi

if [ -e "$APP_DIR/dist" ]; then
  mv "$APP_DIR/dist" "$ROLLBACK_DIST"
fi
RUNTIME_SWITCH_STARTED=1

if [ "$NEED_INSTALL" -eq 1 ]; then
  if [ -e "$APP_DIR/node_modules" ]; then
    mv "$APP_DIR/node_modules" "$ROLLBACK_NODE_MODULES"
  fi
  NODE_MODULES_SWITCH_STARTED=1
  mv "$STAGE_DIR/node_modules" "$APP_DIR/node_modules"
fi

mv "$STAGE_DIR/dist" "$APP_DIR/dist"
[ -s "$APP_DIR/dist/public/index.html" ] || { err "切换后的 index.html 不完整"; false; }
[ -s "$APP_DIR/dist/boot.js" ] || { err "切换后的 boot.js 不完整"; false; }
ok "运行产物已原子切换，本轮回滚点：$ROLLBACK_DIST"

info "Step 7/8: 启动服务并执行健康检查..."
if [ "$APP_EXISTS" -eq 1 ]; then
  NODE_ENV=production PORT="$APP_PORT" pm2 restart "$PM2_NAME" --update-env >/dev/null
else
  NODE_ENV=production PORT="$APP_PORT" pm2 start "$APP_DIR/dist/boot.js" --name "$PM2_NAME" --cwd "$APP_DIR" --update-env >/dev/null
  pm2 save >/dev/null
  APP_EXISTS=1
fi

HTTP_OK=0
HEALTH_HTML="$STAGE_DIR/.health-index.html"
for _ in 1 2 3 4 5 6 7 8; do
  if curl -fsS -H 'Accept: text/html' --max-time 5 \
    "http://127.0.0.1:$APP_PORT/" -o "$HEALTH_HTML"; then
    if grep -qi '<!doctype\|<html' "$HEALTH_HTML"; then
      HTTP_OK=1
      break
    fi
  fi
  sleep 1
done
[ "$HTTP_OK" -eq 1 ] || { err "HTML 健康检查失败"; false; }

ENTRY_ASSET="$(sed -nE 's#.*src="([^"]+\.js)".*#\1#p' "$APP_DIR/dist/public/index.html" | head -1)"
[ -n "$ENTRY_ASSET" ] || { err "无法从 index.html 识别入口脚本"; false; }
curl -fsS --max-time 5 "http://127.0.0.1:$APP_PORT$ENTRY_ASSET" -o "$STAGE_DIR/.health-entry.js"

if [ -n "$EXPECTED_VERSION" ]; then
  grep -q -- "$EXPECTED_VERSION" "$STAGE_DIR/.health-entry.js" || {
    err "线上入口脚本未找到版本标识 $EXPECTED_VERSION"
    false
  }
fi
ok "HTML、入口资源与版本健康检查通过"

info "Step 8/8: 完成部署并清理旧备份..."
DEPLOY_SUCCEEDED=1
prune_successful_backups
pm2 status

echo ""
echo "=========================================="
echo -e "${GREEN}部署完成！${NC}"
echo "=========================================="
echo ""
echo "  访问: http://$ACCESS_HOST:$APP_PORT/"
echo "  日志: pm2 logs $PM2_NAME"
echo "  回滚: $ROLLBACK_DIST"
echo ""
