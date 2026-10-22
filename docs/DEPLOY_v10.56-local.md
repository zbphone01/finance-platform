# v10.56-local 部署说明

## 文件

- `releases/finance-platform-v10.56-local.tar.gz`：包含预构建 `dist/` 的 v10.56 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.56-local.md`：版本快照

## 重要说明

- 本说明仅适用于从 v10.55 升级到 v10.56；更早版本先按对应历史部署说明补齐到 v10.55。
- 本版本没有数据库结构迁移，不执行 SQL，也不执行 `drizzle schema push`。
- 部署前后只读检查用于确认人工处理订单依赖的表、字段和 v10.54 已完成的新去重唯一索引存在；检查不修改数据库。
- 取消忽略或取消转移时如原日期汇总已有认账结果，会按普通流水、同日汇总或多日汇总的统一范围提示并联动取消认账；没有取消认账权限、结果已锁定或已生成凭证时禁止继续。
- 部署包必须包含本地验证通过的 `dist/boot.js`、`dist/public/index.html` 和前端资源；部署脚本不会在服务器执行 `npm run build`。
- 部署脚本先在独立暂存目录校验产物、依赖、数据库连接和 MySQL Event，再使用本轮固定备份原子切换 `dist`；异常中断或健康检查失败时恢复本轮部署前产物。
- 锁文件未变化时复用现有 `node_modules`；锁文件变化或依赖缺失时，在暂存目录执行 `npm ci --omit=dev`，校验后再切换运行依赖。

## 测试服务器1部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.56-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 登录服务器

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
```

### 3. 迁移前检查

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
    ["bill_details", "SHOW TABLES LIKE 'bill_details'"],
    ["match_results", "SHOW TABLES LIKE 'match_results'"],
    ["order_files", "SHOW TABLES LIKE 'order_files'"],
    ["recognition_tasks", "SHOW TABLES LIKE 'recognition_tasks'"],
  ];
  for (const [name, sql] of tableChecks) {
    const [rows] = await db.query(sql);
    console.log(`${name}: ${rows.length > 0 ? "OK" : "MISSING"}`);
  }

  const [columns] = await db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'bill_details'
      AND column_name IN (
        'operation_status',
        'match_result_id',
        'ignore_reason',
        'detail_split_file_id',
        'partition_date'
      )
    ORDER BY column_name
  `);
  console.table(columns);

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

必须确认四张业务表均显示 `OK`；字段结果必须包含 `detail_split_file_id`、`ignore_reason`、`match_result_id`、`operation_status`、`partition_date` 共 5 行。索引结果只能包含 `bd_rule_bill_date_bill_no_partition_uq` 的 4 行，`non_unique=0`、`is_visible=YES`，列顺序依次为 `rule_id`、`bill_date`、`bill_no`、`partition_date`。出现连接错误、表或字段缺失、新索引异常或旧索引仍存在时停止部署，先补齐历史版本。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 迁移

本版本没有数据库迁移脚本，不执行 SQL，不执行 `drizzle schema push`。

### 6. 迁移后检查

```bash
node --input-type=module <<'NODE'
import "dotenv/config";
import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) {
  throw new Error("未在项目 .env 中读取到 DATABASE_URL");
}

const db = await mysql.createConnection(process.env.DATABASE_URL);

try {
  const [columns] = await db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'bill_details'
      AND column_name IN (
        'operation_status',
        'match_result_id',
        'ignore_reason',
        'detail_split_file_id',
        'partition_date'
      )
    ORDER BY column_name
  `);
  console.table(columns);

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

字段结果仍须为 5 行，索引结果仍须只包含 `bd_rule_bill_date_bill_no_partition_uq` 的 4 行；本步骤只读，不应产生结构变化。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v10.56-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 curl 返回成功、页面右上角显示 `v10.56`，且部署后日志没有新增预构建产物缺失、数据库连接或启动失败错误。

## 测试服务器2部署

### 1. 上传文件

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.56-local.tar.gz \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

### 2. 登录服务器

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
```

### 3. 迁移前检查

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
    ["bill_details", "SHOW TABLES LIKE 'bill_details'"],
    ["match_results", "SHOW TABLES LIKE 'match_results'"],
    ["order_files", "SHOW TABLES LIKE 'order_files'"],
    ["recognition_tasks", "SHOW TABLES LIKE 'recognition_tasks'"],
  ];
  for (const [name, sql] of tableChecks) {
    const [rows] = await db.query(sql);
    console.log(`${name}: ${rows.length > 0 ? "OK" : "MISSING"}`);
  }

  const [columns] = await db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'bill_details'
      AND column_name IN (
        'operation_status',
        'match_result_id',
        'ignore_reason',
        'detail_split_file_id',
        'partition_date'
      )
    ORDER BY column_name
  `);
  console.table(columns);

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

必须确认四张业务表均显示 `OK`；字段结果必须包含 `detail_split_file_id`、`ignore_reason`、`match_result_id`、`operation_status`、`partition_date` 共 5 行。索引结果只能包含 `bd_rule_bill_date_bill_no_partition_uq` 的 4 行，`non_unique=0`、`is_visible=YES`，列顺序依次为 `rule_id`、`bill_date`、`bill_no`、`partition_date`。出现连接错误、表或字段缺失、新索引异常或旧索引仍存在时停止部署，先补齐历史版本。

### 4. 停止应用

```bash
pm2 stop finance-platform
pm2 status
```

### 5. 迁移

本版本没有数据库迁移脚本，不执行 SQL，不执行 `drizzle schema push`。

### 6. 迁移后检查

```bash
node --input-type=module <<'NODE'
import "dotenv/config";
import mysql from "mysql2/promise";

if (!process.env.DATABASE_URL) {
  throw new Error("未在项目 .env 中读取到 DATABASE_URL");
}

const db = await mysql.createConnection(process.env.DATABASE_URL);

try {
  const [columns] = await db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'bill_details'
      AND column_name IN (
        'operation_status',
        'match_result_id',
        'ignore_reason',
        'detail_split_file_id',
        'partition_date'
      )
    ORDER BY column_name
  `);
  console.table(columns);

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

字段结果仍须为 5 行，索引结果仍须只包含 `bd_rule_bill_date_bill_no_partition_uq` 的 4 行；本步骤只读，不应产生结构变化。

### 7. 部署代码

```bash
chmod +x deploy-update-optimized.sh
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.56-local.tar.gz
```

### 8. 最终验证

```bash
npm run --silent db:events:ensure -- --check-only
pm2 status
pm2 logs finance-platform --lines 120
curl -fsS -H 'Accept: text/html' http://127.0.0.1:3001/ > /dev/null
```

确认 curl 返回成功、页面右上角显示 `v10.56`，且部署后日志没有新增预构建产物缺失、数据库连接或启动失败错误。

## 功能验证

- 页面右上角显示 `v10.56`。
- 进入 `认账及分账`，顶部入口显示“人工处理订单”，不再显示“已忽略订单”。
- 人工处理订单顶部依次显示已忽略、已转移、已转移/已认账条数；关键字和金额搜索正常。
- 状态筛选位于列表卡片右上方，可筛选全部状态、已忽略、已转移、已转移/已认账；表格下方左侧显示“转移日期”按钮。
- 已忽略订单继续支持取消忽略和批量转移；未认账的已转移订单支持取消转移；归档订单和已转移/已认账订单保持只读。
- 已转移且存在认账结果的订单显示“已转移/已认账”，操作原因列显示对应转移原因。
- 选择原日期汇总没有认账结果的已忽略或已转移订单，取消操作应直接完成。
- 选择原日期汇总已有认账结果的已忽略或已转移订单，取消操作应先弹窗展示原日期、取消范围、银行到账数、结果数和金额；取消弹窗不改变数据，确认后先取消认账再恢复订单。
- 使用没有取消认账权限的账号验证继续按钮不可用；认账结果已锁定或已生成凭证时同样应阻止继续。普通流水、同日汇总和多日汇总分别核对为单笔到账、整个同日汇总任务和已确认多日匹配组。
- 打开需要人工选择多套模板的制单弹窗，标题显示“请选择凭证模版”，显示银行流水号和模板下拉；不需要选择模板时标题仍为“填写制单信息”。
- 回归验证日期汇总银行流水取消认账、入账结果锁定、订单明细上传和明细分账流程正常。

## 回退

- 代码可使用 `releases/finance-platform-v10.55-local.tar.gz` 回退；本版本无数据库结构变更，不执行数据库回滚。
- 回退后人工处理订单入口、已转移订单展示、三项状态汇总、取消操作的认账联动提示和新版凭证模板选择弹窗恢复为 v10.55 行为。
- 单次部署在切换前会把旧运行产物保留为 `backups/dist.rollback.<部署批次>`；启动或健康检查失败时脚本自动恢复该固定回滚点。
- 自动回滚失败时停止重复部署，保留 `dist.failed.<部署批次>` 并人工核查。
