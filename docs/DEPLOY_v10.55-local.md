# v10.55-local 部署说明

## 文件

- `releases/finance-platform-v10.55-local.tar.gz`：包含预构建 `dist/` 的 v10.55 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.55-local.md`：版本快照

## 重要说明

- 本说明仅适用于从 v10.54 升级到 v10.55；更早版本先按对应历史部署说明补齐到 v10.54。
- 本版本没有数据库结构迁移，不执行 SQL，也不执行 `drizzle schema push`。
- 部署前只读检查用于确认 v10.54 主表新去重唯一索引仍存在、旧索引已经清理，并确认取消认账依赖的业务表存在；检查不修改数据库。
- 部署包必须包含本地验证通过的 `dist/boot.js`、`dist/public/index.html` 和前端资源；部署脚本不会在服务器执行 `npm run build`。
- 部署脚本先在独立暂存目录校验产物、依赖、数据库连接和 MySQL Event，再使用本轮固定备份原子切换 `dist`；异常中断或健康检查失败时恢复本轮部署前产物。
- 锁文件未变化时复用现有 `node_modules`；锁文件变化或依赖缺失时，在暂存目录执行 `npm ci --omit=dev`，校验后再切换运行依赖。

## 测试服务器1部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.55-local.tar.gz \
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

try {
  const tableChecks = [
    ["match_results", "SHOW TABLES LIKE 'match_results'"],
    ["bank_flows", "SHOW TABLES LIKE 'bank_flows'"],
    ["voucher_result_lines", "SHOW TABLES LIKE 'voucher_result_lines'"],
  ];
  for (const [name, sql] of tableChecks) {
    const [rows] = await db.query(sql);
    console.log(`${name}: ${rows.length > 0 ? "OK" : "MISSING"}`);
  }

  const [indexes] = await db.query(`
    SELECT index_name, non_unique, seq_in_index, column_name, is_visible
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'bill_details'
      AND index_name IN (
        'bd_rule_partition_date_bill_no_uq',
        'bd_rule_bill_date_bill_no_partition_uq'
      )
    ORDER BY index_name, seq_in_index
  `);
  console.table(indexes);
} finally {
  await db.end();
}
NODE
```

必须确认三张业务表均显示 `OK`；索引结果只能包含 `bd_rule_bill_date_bill_no_partition_uq` 的 4 行，`non_unique=0`、`is_visible=YES`，列顺序依次为 `rule_id`、`bill_date`、`bill_no`、`partition_date`。出现连接错误、业务表缺失、新索引异常或旧索引仍存在时停止部署，先补齐 v10.54。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.55-local.tar.gz
```

### 6. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 curl 返回成功、页面右上角显示 `v10.55`，且部署后日志没有新增预构建产物缺失、数据库连接或启动失败错误。

## 测试服务器2部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.55-local.tar.gz \
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

try {
  const tableChecks = [
    ["match_results", "SHOW TABLES LIKE 'match_results'"],
    ["bank_flows", "SHOW TABLES LIKE 'bank_flows'"],
    ["voucher_result_lines", "SHOW TABLES LIKE 'voucher_result_lines'"],
  ];
  for (const [name, sql] of tableChecks) {
    const [rows] = await db.query(sql);
    console.log(`${name}: ${rows.length > 0 ? "OK" : "MISSING"}`);
  }

  const [indexes] = await db.query(`
    SELECT index_name, non_unique, seq_in_index, column_name, is_visible
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'bill_details'
      AND index_name IN (
        'bd_rule_partition_date_bill_no_uq',
        'bd_rule_bill_date_bill_no_partition_uq'
      )
    ORDER BY index_name, seq_in_index
  `);
  console.table(indexes);
} finally {
  await db.end();
}
NODE
```

必须确认三张业务表均显示 `OK`；索引结果只能包含 `bd_rule_bill_date_bill_no_partition_uq` 的 4 行，`non_unique=0`、`is_visible=YES`，列顺序依次为 `rule_id`、`bill_date`、`bill_no`、`partition_date`。出现连接错误、业务表缺失、新索引异常或旧索引仍存在时停止部署，先补齐 v10.54。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 部署代码

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.55-local.tar.gz
```

### 6. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 curl 返回成功、页面右上角显示 `v10.55`，且部署后日志没有新增预构建产物缺失、数据库连接或启动失败错误。

## 功能验证

- 页面右上角显示 `v10.55`。
- 进入 `认账及分账 / 日期汇总 / 银行流水`，已认账或部分认账流水应显示取消认账；存在锁定结果时确认查询和提交必须阻止取消。
- `已认账/已制单` 流水不应显示取消认账；状态菜单中的查看凭证和取消手工凭证继续按原权限显示。
- 进入 `入账结果 / 入账明细`，状态三点菜单只显示锁定或取消锁定，不再显示取消认账。
- 普通到账取消时回滚该到账全部认账结果；同日汇总取消整个任务；多日汇总取消当前确认组。
- 到账认账、自动明细认账、订单明细手动认账和银行流水手动认账均可从对应银行流水统一取消；已锁定或已生成凭证时必须阻止取消。
- 日期汇总订单明细中的单条手动认账仍可使用原有专用入口取消。

## 回退

- 代码可使用 `releases/finance-platform-v10.54-local.tar.gz` 回退；本版本无数据库结构变更，不执行数据库回滚。
- 回退后入账结果页会恢复精细取消入口，日期汇总 `已认账/已制单` 状态也会恢复旧版取消按钮；部署前应确认回退符合当前业务操作口径。
- 单次部署在切换前会把旧运行产物保留为 `backups/dist.rollback.<部署批次>`；启动或健康检查失败时脚本自动恢复该固定回滚点。
- 自动回滚失败时停止重复部署，保留 `dist.failed.<部署批次>` 并人工核查。
