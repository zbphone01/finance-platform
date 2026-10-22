# v10.53-local 部署说明

## 文件

- `releases/finance-platform-v10.53-local.tar.gz`：包含预构建 `dist/` 的 v10.53 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.53-local.md`：版本快照

## 重要说明

- 本说明仅适用于从 v10.52 升级到 v10.53；更早版本先按对应历史部署说明补齐到 v10.52。
- 本版本没有数据库结构迁移，不执行 SQL，也不执行 `drizzle schema push`。
- 多套凭证模板使用现有配置表的新配置键保存；跨应用重任务锁复用现有数据库连接配置，不需要增加环境变量或安装依赖。
- 部署包必须包含本地验证通过的 `dist/boot.js`、`dist/public/index.html` 和前端资源；部署脚本不会在服务器执行 `npm run build`。
- 部署脚本先在独立暂存目录校验产物、依赖、数据库连接和 MySQL Event，再使用本轮固定备份原子切换 `dist`；异常中断或健康检查失败时恢复本轮部署前产物。
- 锁文件未变化时复用现有 `node_modules`；锁文件变化或依赖缺失时，在暂存目录执行 `npm ci --omit=dev`，校验后再切换运行依赖。
- v10.48 的月归档索引灰度和正式清理继续按 `docs/DEPLOY_v10.48-local.md` 独立判断和执行。

## 测试服务器1部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.53-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 登录服务器

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
```

### 3. 部署前数据库检查

```bash
node --input-type=module <<'NODE'
import "dotenv/config";
import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) {
  throw new Error("未在项目 .env 中读取到 DATABASE_URL");
}

const db = await mysql.createConnection(process.env.DATABASE_URL);
const checks = [
  ["voucher_template_settings", "SHOW TABLES LIKE 'voucher_template_settings'"],
  ["detail_split_files", "SHOW TABLES LIKE 'detail_split_files'"],
  ["detail_split_files.failed_reason", "SHOW COLUMNS FROM detail_split_files LIKE 'failed_reason'"],
  ["match_results", "SHOW TABLES LIKE 'match_results'"],
];

try {
  for (const [name, sql] of checks) {
    const [rows] = await db.query(sql);
    console.log(`${name}: ${rows.length > 0 ? "OK" : "MISSING"}`);
  }
} finally {
  await db.end();
}
NODE
```

命令直接使用当前项目 `.env` 中应用实际使用的数据库账号，不需要再次输入密码。必须确认四项都显示 `OK`；出现连接错误或 `MISSING` 时停止部署并先核对 `.env` 与历史版本迁移。本步骤只执行只读检查，不执行任何迁移。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.53-local.tar.gz
```

### 6. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 curl 返回成功、页面右上角显示 `v10.53`，且部署后日志没有新增预构建产物缺失、数据库命名锁连接失败或启动失败错误。

## 测试服务器2部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.53-local.tar.gz \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

### 2. 登录服务器

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
```

### 3. 部署前数据库检查

```bash
node --input-type=module <<'NODE'
import "dotenv/config";
import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) {
  throw new Error("未在项目 .env 中读取到 DATABASE_URL");
}

const db = await mysql.createConnection(process.env.DATABASE_URL);
const checks = [
  ["voucher_template_settings", "SHOW TABLES LIKE 'voucher_template_settings'"],
  ["detail_split_files", "SHOW TABLES LIKE 'detail_split_files'"],
  ["detail_split_files.failed_reason", "SHOW COLUMNS FROM detail_split_files LIKE 'failed_reason'"],
  ["match_results", "SHOW TABLES LIKE 'match_results'"],
];

try {
  for (const [name, sql] of checks) {
    const [rows] = await db.query(sql);
    console.log(`${name}: ${rows.length > 0 ? "OK" : "MISSING"}`);
  }
} finally {
  await db.end();
}
NODE
```

命令直接使用当前项目 `.env` 中应用实际使用的数据库账号，不需要再次输入密码。必须确认四项都显示 `OK`；出现连接错误或 `MISSING` 时停止部署并先核对 `.env` 与历史版本迁移。本步骤只执行只读检查，不执行任何迁移。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 部署代码

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.53-local.tar.gz
```

### 6. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 curl 返回成功、页面右上角显示 `v10.53`，且部署后日志没有新增预构建产物缺失、数据库命名锁连接失败或启动失败错误。

## 功能验证

- 页面右上角显示 `v10.53`。
- 上传超过 10000 行的明细分账文件，确认分批入库成功；构造失败数据时文件状态变为失败并展示失败原因，不长期停留在处理中。
- 编辑预算编码部门时，关联部门支持树形搜索和多选，且不能选择当前部门自身。
- 普通已认账到账从状态栏取消后，该到账的全部认账结果一起取消；同日汇总任一到账取消整个任务；多日汇总任一到账取消当前确认组。
- 存在锁定或已生成凭证的认账结果时，取消认账被拒绝且不产生部分回滚。
- 四类凭证模板均可新增多套模板，并可改名、复制和删除；刷新页面后名称和三行模板内容保持不变。
- 单笔制单遇到多套模板时弹出模板选择，选择后按对应模板生成；只有一套模板时直接生成。
- 批量制单只处理无需选模板的到账，需人工选择的普通到账或汇总范围整组跳过，完成提示同时显示已制单数和需人工处理数。
- 到账认账“认账时填写”表格的部门、NC 项目名称和预算编码列按内容自适应，预算编码使用正常字号。
- 操作指引中的明细分账步骤顺序和“认账时填写”说明正确。

## 回退

- 代码可使用 `releases/finance-platform-v10.52-local.tar.gz` 回退；本版本无数据库结构变更，不执行数据库回滚。
- `template_sets_v2` 配置可保留，v10.52 会忽略它并继续读取保留的旧版默认模板；回退期间 v10.53 新增的额外模板不可选，但不会丢失。
- 单次部署在切换前会把旧运行产物保留为 `backups/dist.rollback.<部署批次>`；启动或健康检查失败时脚本自动恢复该固定回滚点。
- 自动回滚失败时停止重复部署，保留 `dist.failed.<部署批次>` 并人工核查。
- v10.48 归档索引灰度或正式清理若已执行，不能通过代码回退撤销；仍按 `docs/DEPLOY_v10.48-local.md` 的数据库回退原则处理。
