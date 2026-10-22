---
name: finance-recon
description: Financial reconciliation and recognition management platform. Use this skill when working on feature changes, schema migrations, UI updates, deployment packaging, MySQL operations, or local sandbox debugging for the finance reconciliation website.
---

# 财务对账及认账管理平台 v10.85-local

## 项目状态

- 本地项目：`/home/deploy/Documents/资金池认账`
- 当前版本：`v10.85-local`
- 技能文档：`docs/finance-recon-SKILL.md`
- 版本快照：`docs/VERSION_SNAPSHOT_v10.85-local.md`
- 部署说明：`docs/DEPLOY_v10.85-local.md`
- 部署包：`releases/finance-platform-v10.85-local.tar.gz`
- 推荐部署脚本：`deploy-update-optimized.sh`
- 本版从 `v10.84` 升级，无 SQL 迁移；明细认账规则整体编辑页的条件按编号倒序展示，只保留上部添加入口，新增条件显示在最上方，保存顺序和认账逻辑不变。

## 使用导航

按任务范围读取对应内容，不要把全部参考文档无条件载入上下文：

- 修改授权、Git 和发版流程：读取根目录 `AGENTS.md`。
- 数据库连接、迁移、部署文档、打包或部署脚本：读取本文件对应章节。
- 修改菜单、上传、匹配、认账、明细分账、制单、归档或基础资料：先完整读取 [业务规则参考](finance-recon-references/business-rules.md) 中对应章节；跨领域流程读取所有相关章节。
- 修改列表、汇总、缓存、批量写入、冷热数据或大文件处理：同时完整读取 [性能与存储红线](finance-recon-references/performance-redlines.md)。
- 排查已知环境问题：读取本文件“排错提示”；版本特定变化回到当前版本快照和部署说明。

## 协作规则

- 修改前确认、Git 操作、发版流程和完成汇报规则见仓库根目录 `AGENTS.md`。
- 本文件是项目 Skill 的入口，保留数据库、迁移、部署和排错等高频规则；详细业务规则与性能红线按“使用导航”读取参考文档。

## 数据库连接

- 本地数据库以 `.env` 的 `DATABASE_URL` 为准；当前本地默认：
  - 数据库：`finance_recon_sandbox`
  - 用户：`finance_sandbox`
  - 密码：`<从本机 .env 读取>`
- 本地 MySQL 迁移和检查统一使用 TCP 连接，避免 socket 口径不一致：

```bash
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox < database/migrations/migrate-xxx.sql
mysql --protocol=TCP -h localhost -u finance_sandbox -p finance_recon_sandbox -e "SHOW COLUMNS FROM 表名 LIKE '字段名';"
```

- 线上数据库：
  - 数据库：`finance_recon`
  - 用户：`finance_user`
  - 密码：`<从本机 .env 读取>`
- 服务器环境：
  - 测试服务器1：`ubuntu@server1.example.com`，登录密钥 `/home/deploy/Documents/测试服务器1密钥/codex.pem`，项目目录 `/home/ubuntu/finance-platform`，端口 `3001`，PM2 应用名 `finance-platform`
  - 测试服务器2：`administrator@server2.example.com`，项目目录 `/home/administrator/finance-platform`，端口 `3001`，PM2 应用名 `finance-platform`
  - 两台测试服务器数据库均为：数据库 `finance_recon`，用户 `finance_user`，密码 `<从本机 .env 读取>`
  - 两台测试服务器的 PM2 运行用户均已安装 `pm2-logrotate`：测试服务器1为 `ubuntu`，测试服务器2为 `administrator`；两边配置均为日志单文件上限 `50M`、轮转文件保留 `7` 份。轮转配置作用于对应用户管理的全部 PM2 应用，不只限于 `finance-platform`。登录对应用户后可使用 `pm2 describe pm2-logrotate` 和 `pm2 conf pm2-logrotate` 检查运行状态与配置。

- 数据盘快照由 `.env` 中的 `DATA_DISK_PATH` 指定，未配置时默认为 `/`。线上应先用 `df -P /var/lib/mysql` 确认 MySQL 数据所在挂载点，再把该挂载点写入 `DATA_DISK_PATH`；配置路径必须对 PM2 运行用户可访问。

- 线上迁移必须先登录目标服务器并进入项目目录，不能在本地直接用线上账号执行。用户索要部署或迁移指令时，要按目标环境分别给出测试服务器1、测试服务器2的命令。

```bash
TEST_SERVER1_KEY="/home/deploy/Documents/测试服务器1密钥/codex.pem"
chmod 600 "$TEST_SERVER1_KEY"
ssh -i "$TEST_SERVER1_KEY" ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-xxx.sql
```

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-xxx.sql
```

## 数据库迁移与文档分工

- 本 skill 只保留跨版本稳定的迁移原则，不保存具体版本的迁移命令、历史升级路径或迁移脚本清单。
- 当前版本的数据库结构变化、迁移脚本、执行条件、迁移前后检查和回退注意事项记录在 `docs/VERSION_SNAPSHOT_v10.85-local.md`。
- 从上一实际部署包 `v10.84-local` 升级到当前版本的完整可执行命令记录在 `docs/DEPLOY_v10.85-local.md`。
- 历史版本迁移回到对应的 `docs/VERSION_SNAPSHOT_vX-local.md` 和 `docs/DEPLOY_vX-local.md` 查询，不复制到当前版本文档。

### 迁移原则

- 迁移只在目标服务器项目目录内执行，不从本地直连线上数据库。
- 执行前先检查字段、表、索引或事件是否已存在，避免重复执行迁移脚本。
- 历史和新增迁移脚本统一保存在本地 `database/migrations/migrate-vX-*.sql`，该目录由 Git 忽略。升级包仍将脚本放在根目录，服务器命令和发布清单继续使用原文件名；不要执行 `drizzle schema push`。
- GitHub 源码仅用于全新部署，入口见 [全新部署说明](FRESH_DEPLOY_v10.85-local.md)。使用 `database/init-fresh-schema-v10.85.sql` 与 `database/fresh-schema-v10.85.json`，不依赖历史迁移；数据库结构变更时必须同步完整初始化结构、校验清单和全新部署入口。完整结构不导出业务数据、备份表、其他应用表、固定 DEFINER 或历史分区日期。
- 迁移专用测试在本地目录存在时运行；GitHub 检出缺少私有迁移目录时明确跳过这些测试，完整初始化结构及打包测试仍独立运行。
- `deploy-update-optimized.sh --check-database` 是当前发布版本迁移的只读检查入口，必须明确输出“需要迁移”并给出 `--check-and-migrate-database` 命令，或输出“无需迁移，可以部署”；字段混合、必需表缺失时必须失败退出。`--check-and-migrate-database` 是唯一允许执行当前版本 SQL 的入口，普通部署模式不得自动执行 SQL。
- 构建成功后普通部署模式只复核当前发布版本的数据库完成态，并运行 `npm run db:events:ensure`；只补建缺失且依赖完整的 MySQL Event。当前版本迁移未完成、定义不一致或 `event_scheduler` 未开启时停止部署，不得串行检查更早版本迁移。
- 用户索要迁移指令时，按目标环境提供完整命令，至少包含登录服务器、进入项目目录和“检查并迁移”入口；脚本负责迁移前检查、执行和迁移后回读，不使用账号、数据库名或脚本名占位符。

### 部署文档固定格式（未经用户明确同意不得修改）

- 数据库迁移只写从上一版本升级到当前版本所需的迁移，不加入更早版本的补迁路径。
- 不写发布包 SHA-256、`ls -lh` 等文件检查步骤。
- 不写数据库备份和备份检查步骤。
- 两台测试服务器分别写出完整、可直接执行的命令和判断规则，不使用“与测试服务器1相同”“参考上一步”等交叉引用。
- 测试服务器1固定使用 `/home/deploy/Documents/测试服务器1密钥/codex.pem`。生成部署或迁移文档时，“上传”步骤必须定义 `TEST_SERVER1_KEY`、执行 `chmod 600 "$TEST_SERVER1_KEY"` 并使用 `scp -i "$TEST_SERVER1_KEY"`；“登录”步骤必须再次完整定义和检查该密钥，并使用 `ssh -i "$TEST_SERVER1_KEY"`。不得改回不带 `-i` 的 `scp` 或 `ssh` 命令，也不得使用旧密钥路径或密钥路径占位符。
- 每个部署环境固定且只能使用以下四个编号步骤，名称和顺序不得改变：`1. 上传`、`2. 登录`、`3. 检查并迁移`、`4. 部署代码`。
- 上传前的本地检查不得另设步骤；确需保留时并入“上传”。环境检查不得另设步骤；确需保留时并入“登录”。为执行数据库迁移而停止联动应用属于“检查并迁移”；普通代码部署的应用停止、代码切换、启动、状态检查、日志检查和健康检查全部并入“部署代码”。
- 第三步只处理“紧邻上一版本 -> 当前版本”的单一迁移。部署脚本必须用当前发布清单明确声明当前版本、上一版本、唯一迁移文件和唯一完成态检查器；`--check-database` 与普通部署只调用该检查器，`--check-and-migrate-database` 先探测该迁移、仅在需要迁移时确认两个联动应用已停止，再自动执行并回读。不得串行检查、补执行或要求传入更早版本迁移；本版没有 SQL 时清单必须明确为“无迁移”。
- 第三步统一调用 `deploy-update-optimized.sh --check-and-migrate-database`；该入口内部必须使用服务器项目现有 Node.js、`dotenv` 和 `mysql2/promise` 读取 `.env` 中的 `DATABASE_URL`，并校验数据库名、当前版本必要表/字段/索引等预期结果。部署文档不得使用 `mysql ... -p` 要求人工输入数据库密码，也不得把密码明文写入命令、文档或输出。迁移 SQL 文件名不得作为命令参数传入；脚本只执行当前发布清单声明的文件，复用 `.env` 连接信息并保留迁移前后只读校验和明确结果。
- 不得增加第五步、回退步骤或其他编号部署阶段；回退风险统一写入版本快照。不得使用 `&&` 串联不同阶段。
- 后续即使认为其他格式更完整或更优，也必须先取得用户明确同意，才能增删步骤、改名、调整顺序或改变上述内容归属。

### 部署脚本精简与安全边界（未经用户明确同意不得修改）

- 条件分支结束后执行内容完全相同的校验或清理时，统一移到分支外执行一次；不得在每个分支复制同一命令。当前运行依赖校验固定在安装/复用判断结束后统一执行。
- 临时部署目录固定由 `EXIT trap` 统一清理；错误处理函数只负责记录错误、按需回滚并退出，不再在退出前重复调用同一临时目录清理。
- PM2 启动或重启成功时不重复输出完整状态表，操作命令保留错误输出，脚本结束前统一执行一次 `pm2 status` 作为最终状态确认。
- 生产依赖是否需要重装固定使用 `scripts/runtime-lock-fingerprint.mjs` 计算 `package-lock.json` 的生产依赖指纹；项目版本号、根开发依赖和仅开发使用的锁文件条目变化不得触发 `npm ci`。生产依赖变化、服务器缺少 `node_modules` 或显式设置 `FORCE_NPM_INSTALL=1` 时才安装，并记录触发原因。
- 真正安装生产依赖前必须检查可用内存、Swap、应用盘空间和 inode；资源状态未知或低于阈值时在停止应用和切换产物前终止。安装固定使用单任务、低 CPU/磁盘优先级、Node 堆上限、npm 下载超时与重试及总时长保护；不得自动创建 Swap、结束其他进程或修改系统配置。阈值允许通过 `NPM_INSTALL_*` 和 `NPM_FETCH_*` 环境变量临时覆盖。
- 指纹工具、对应自动测试、发布包必需项检查、安装原因日志、资源预检和受保护安装属于同一部署安全边界；后续不得恢复为比较整个锁文件哈希，也不得在没有回归测试的情况下改变生产依赖判定规则。
- 以下流程属于部署安全边界，不按重复代码删除：发布包先完整解压到独立暂存目录做验证和依赖准备，再从原发布包按排除规则更新正式目录；构建产物分别执行包内存在性、暂存非空/语法/版本和切换后非空检查；`.env` 沙盒拦截与真实数据库/Event 检查分别保留；服务启动健康检查保留有限次数重试，并继续验证 HTML、入口资源和版本号。
- `--check-database` 必须保持只读；`--check-and-migrate-database` 不接受 SQL 路径，只读取当前发布清单。它先执行只读探测，已完成时不触碰 PM2 或数据库结构；仅在需要迁移时确认 `finance-platform` 和 `ticket-platform` 均已停止，再自动执行唯一当前迁移并回读当前版本要求的字段、表、索引和其他完成态。普通部署模式只再次校验当前版本完成态，不能仅依赖运维人员此前运行过检查，也不得检查更早迁移。
- 部署脚本只保留通用部署函数和当前发布版本的唯一数据库检查器；升级版本时必须替换发布清单与检查器，不得把更早版本检查函数继续累积在当前脚本中。历史检查逻辑回到对应版本文档或 Git 历史查询，自动测试必须断言旧版本检查器未残留、当前数据库入口只调用发布清单声明的检查器。
- 后续生成新版部署脚本必须以当前 `deploy-update-optimized.sh` 为固定基线做最小版本替换，只允许同步更新 `CURRENT_RELEASE_VERSION`、`CURRENT_RELEASE_BASELINE_VERSION`、`CURRENT_RELEASE_MIGRATION_FILE`、`CURRENT_RELEASE_DATABASE_CHECKER` 和当前版本检查器主体；不得重新生成或改写通用部署骨架。主流程固定保持 8 个阶段及顺序：前置检查、线上 `.env` 检查、暂存解压与产物校验、运行依赖检查、数据库与 Event 检查、源码更新与原子切换、启动与健康检查、备份清理与唯一一次 `pm2 status`。
- PM2 应用“已登记”和“部署开始时正在运行”必须分别记录；只有原本正在运行的应用才在切换前执行 `pm2 stop`，失败回滚只恢复脚本亲自停止的应用，不得启动部署前已经停止的应用。部署成功后，已登记应用使用 `pm2 restart` 启动新产物，不存在的应用才使用 `pm2 start`。
- 部署文档调用脚本成功后，不再重复执行脚本内部已经完成的 `db:events:ensure --check-only`、`pm2 status` 或本机 `127.0.0.1` HTML 健康检查；保留日志检查，以及脚本无法覆盖的目标服务器外部访问地址检查。登录和迁移阶段用于确认联动应用状态的 `pm2 status` 不属于该重复范围。
- 后续如需合并双重解压、减少分阶段产物校验、取消数据库检查或降低健康检查范围，必须先说明安全和回滚影响并取得用户明确同意，不得以“去重”名义直接修改。

## 开发、发版与部署

### 常用命令

```bash
cd /home/deploy/Documents/资金池认账
npm run check
npm run lint
npm run build
npm run dev
```

每轮代码完成后至少执行：

```bash
npm run check
npm run build
```

发版前建议再执行：

```bash
node --test scripts/runtime-lock-fingerprint.test.mjs
git diff --check
```

### 打包命令

发布前先运行 `npm run build`，再执行项目发布打包入口，生成包含预构建 `dist/` 的当前版本部署包：

```bash
cd /home/deploy/Documents/资金池认账
npm run release:package
```

打包统一使用上述入口。`scripts/release-package.mjs` 从本地 `database/migrations/` 读取所有非空 `migrate-*.sql`，在部署包根目录写入同名文件，并检查必需迁移是否存在。根目录遗留迁移脚本会被拒绝，避免同名新旧文件混入包内。新增迁移必须直接保存到本地专用目录。

主项目归档仍排除 `.env`、`node_modules`、`.git`、`releases`、`outputs`、`database/`、上传缓存和本地备份；迁移目录仅通过单独的白名单映射进入包根目录，完整初始化文件和其他数据库文件不进入升级包。不要直接对项目目录执行 tar，否则会遗漏已移动的迁移脚本。

仅验证打包而不覆盖已有发布包时，可以设置 `RELEASE_PACKAGE_OUTPUT=releases/finance-platform-v10.85-layout-check.tar.gz` 后运行 `npm run release:package`。这不是新版本发布，不修改版本号或现有正式部署包。

打包后必须确认 `dist/boot.js`、`dist/public/index.html`、`dist/public/assets/` 和 `scripts/runtime-lock-fingerprint.mjs` 已进入发布包且文件非空。服务器部署脚本只校验和切换预构建产物，不再执行 `npm run build`。

macOS 打包时必须同时设置 `COPYFILE_DISABLE=1` 并使用 `--no-xattrs --no-mac-metadata`，否则本地 BSD tar 可能隐藏 AppleDouble 条目，但 Ubuntu GNU tar 会把它们显示为 `._*`，从而触发部署包安全校验。发布前应使用能够读取真实 tar 成员的方式复核 `._*` 数量为 0；部署脚本会拒绝包含这些文件的包。

### 线上部署原则

- 当前版本的完整部署步骤统一维护在 `docs/DEPLOY_v10.85-local.md`，本 skill 不重复保存具体版本命令。
- 推荐使用 `deploy-update-optimized.sh`；本地生成发布包前必须完成 `npm run check`、`npm run build` 和 `git diff --check`，并把本次生成的 `dist/` 纳入发布包。
- 部署脚本不在服务器执行 TypeScript 类型检查或应用构建；普通部署模式不自动执行 SQL，也不执行 `drizzle schema push`。只有显式 `--check-and-migrate-database` 模式自动处理当前版本迁移；普通部署会在暂存目录校验预构建产物、当前源码要求的数据库完成态、数据库 Event 和运行依赖，再通过本轮固定备份原子切换 `dist/`。
- 测试服务器1使用默认项目目录 `/home/ubuntu/finance-platform`；测试服务器2部署时必须显式传入 `APP_DIR=/home/administrator/finance-platform` 和 `ACCESS_HOST=server2.example.com`。
- 生产依赖指纹未变化时复用服务器现有运行依赖；生产依赖变化、缺少 `node_modules` 或显式使用 `FORCE_NPM_INSTALL=1` 时，部署脚本先做资源预检，再在暂存目录受保护地执行 `npm ci --omit=dev`，校验后切换依赖。默认要求至少 512 MB 可用内存、1024 MB 应用盘空间和 10000 个可用 inode，Node 堆上限为 384 MB，安装总超时为 1200 秒；低资源服务器可以临时调高超时，但降低资源阈值前必须确认不会影响 MySQL 和 PM2 运行进程。
- 发版后更新 README 中的当前版本文档入口，历史版本快照和部署说明继续保留。

## 业务规则与性能参考

- [业务规则参考](finance-recon-references/business-rules.md)：功能结构、测试数据清理、页面体验、订单上传、明细分账、制单、认账状态、核心认账、基础资料与归档规则。
- [性能与存储红线](finance-recon-references/performance-redlines.md)：缓存汇总、读写路径、分区裁剪、批量处理和大文件性能边界。
- 业务改动先读取业务规则对应章节；触及大表、列表汇总、批处理、冷热数据或性能优化时，两份参考文档都要读取。

## 排错提示

- 本地或 Codex 沙盒连接 MySQL 可能需要本机网络权限；没有权限时由 Codex 写 SQL，用户手动执行。
- 线上 `.env` 必须指向 `finance_user / finance_recon`，部署脚本会阻止沙盒库配置上线。
- 低配服务器执行 `npm run check` 可能长时间无输出；类型检查放在本地完成。
- Rollup 的 Linux 原生包是 optional dependency，部署时不要使用 `npm install --omit=optional` 或 `npm ci --omit=optional`。
- 如果构建报 `Cannot find module @rollup/rollup-linux-x64-gnu`：

```bash
cd /home/ubuntu/finance-platform
rm -rf node_modules
npm install --no-audit --no-fund
npm run build
```

- `mysqldump` 遇到 PROCESS 权限问题加 `--no-tablespaces`。
- 导出单表遇到 FLUSH 权限问题，用 `--skip-lock-tables`。
- GTID 导入权限问题，导出时加 `--set-gtid-purged=OFF`。
