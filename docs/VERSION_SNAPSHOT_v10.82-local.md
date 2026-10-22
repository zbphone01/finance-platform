# v10.82-local 版本快照

## 发布范围

- 本版本从上一实际部署包 `v10.81-local` 升级，包含当前工作区全部业务、测试、文档和部署守卫改动。
- 认账日期详情的银行流水在主列表页签下增加“广发银行 / 工商银行 / 中国银行”切换，收入/支出切换与银行切换同一行居右。
- 服务端在日期任务范围内按 `bank_flows.bank_name` 和金额方向先过滤，再分别分页和计数；切换银行不会改写或重新计算顶部整日日期汇总缓存。
- 广发银行、工商银行和中国银行分别使用对应业务表头，同时把各银行原始字段统一展示为 `bank_flows` 的流水号、交易时间、收入、对方账号、对方户名、摘要、用途/备注和附言字段。
- 广发银行上传优先把“备注”写入 `bank_flows.purpose`；到账信息规则设置文案同步覆盖“付款人账号、对方单位、付款人名称、备注、交易附言”等银行原始名称。
- 保留 v10.81 已有的到账信息持久匹配、取消匹配、重新匹配和待认账候选边界。

## 数据库、依赖与配置

- `v10.81-local -> v10.82-local` 无 SQL 迁移，不新增或修改数据库表、字段、索引、事件和历史数据。
- 三家银行的识别和认账信息继续统一保存到 `bank_flows.bank_name`、`reference_no`、`transaction_time`、`income`、`counterparty_account`、`counterparty_name`、`summary`、`purpose`、`post_script`。
- 发布清单显式声明无迁移；`deploy-update-optimized.sh --check-and-migrate-database` 只读验证日期汇总缓存、v10.80 明细分账前置结构、v10.81 到账匹配字段、统一流水字段和三项到账引用一致性，不停止应用、不执行 SQL。
- 不新增 npm 依赖、环境变量、端口、PM2 配置或数据库索引；不执行 `drizzle schema push`。

## 验证结果

- `npm run check` 通过。
- `npm test` 通过（50 个测试文件、257 项测试）；`src/lib/bankFlowDisplay.test.ts` 验证三家银行列名、顺序和统一字段映射。
- `npm test -- api/lib/orderUploadStream.test.ts` 通过（24 项上传解析测试）。
- `npm run build` 通过；Vite 浏览器数据过期和大资源体积提示为非阻断警告。
- `node --test scripts/runtime-lock-fingerprint.test.mjs scripts/deploy-database-control.test.mjs` 通过（13 项），`bash -n deploy-update-optimized.sh` 和 `git diff --check` 通过。
- 发布包必须包含非空的 `dist/boot.js`、`dist/public/index.html`、`dist/public/assets/`、运行依赖指纹脚本、v10.82 数据库检查器和历史迁移文件；环境文件、依赖目录、Git、发布目录、缓存、本地备份和 AppleDouble 文件不得进入发布包。

## 性能、回退与运行注意

- 银行和收支方向必须在服务端查询中先过滤再分页与计数，前端不得下载整日流水后切片；切换条件时通过列表组件重新初始化页码，避免旧页码落到空页。
- `getFlows` 继续保持只读，不在日期详情查询中重新匹配到账信息或写回状态；三家银行只改变字段标题和排列，不复制存储银行专用字段。
- 若需回退应用，可重新部署 `finance-platform-v10.81-local.tar.gz`；本版无数据库变更，无需反向迁移。回退后 v10.82 的银行切换和专用表头不可用，但既有流水、认账结果和到账匹配状态不受影响。
