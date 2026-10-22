# v10.81-local 版本快照

## 发布范围

- 本版本从上一实际部署包 `v10.80-local` 升级，包含当前工作区全部业务、测试、文档和部署守卫改动。
- 银行到账上传统一读取全部到账信息和启用的多组匹配条件；同组已填写字段全部匹配、任一组命中即可，唯一最高精度匹配才自动固化，同精度并列保持未认账并在上传结果中提示。
- 银行流水只新增并持久维护 `matched_counterparty_id` 与 `arrival_match_status`；不增加到账别称、认账类型、匹配时间快照，也不增加银行流水组合索引。
- 匹配为到账认账时只执行固化到账信息关联的启用规则；匹配为明细认账时保持待认账。T+1、打包明细、同日汇总和多日汇总只读取固化的待认账流水，不再按流水原始字段重复匹配。
- 日期汇总收入流水列表不增加到账信息列；列表只读固化状态，将已匹配且尚未认账的流水显示为“待认账”，其他未认账流水显示为“未认账”。
- 待认账流水增加取消匹配，未认账流水增加重新匹配；两项操作共用独立的“管理银行到账匹配”权限，管理员始终允许，运营和财务默认关闭。取消自动到账认账结果后同步标记为已取消匹配，避免再次自动命中。
- 保留 v10.80 已有的明细分账子订单号持久滤重、分值金额校验、来源日期修复和部署安全边界。

## 数据库、依赖与配置

- 从 `v10.80-local` 升级只执行 `migrate-v10.81-bank-flow-arrival-match.sql`。
- 迁移向 `bank_flows` 新增：
  - `matched_counterparty_id BIGINT UNSIGNED NULL`；
  - `arrival_match_status ENUM('unmatched','matched','cancelled') NOT NULL DEFAULT 'unmatched'`。
- 历史数据只按可靠关系回填：到账认账使用 `income_rule_id` 关联规则到账别称；同日汇总使用任务 `same_day_counterparty_id`；其他已绑定明细规则任务使用规则到账别称。无法可靠确定的历史流水保持 `unmatched`，后续由人工重新匹配。
- 不新增 npm 依赖、环境变量、端口、PM2 配置或 `bank_flows` 索引；不执行 `drizzle schema push`。
- `deploy-update-optimized.sh --check-and-migrate-database` 只处理本版 `v10.80-local -> v10.81-local`：先确认 v10.80 前置结构完整，再检查两个新字段定义和匹配状态一致性；仅在两个字段均缺失时允许执行迁移，部分迁移或数据不一致时拒绝部署。

## 验证结果

- `npm run check` 通过。
- `npm test` 通过（49 个测试文件、253 项测试）。
- `npm run build` 通过；Vite 浏览器数据过期和大资源体积提示为非阻断警告。
- `node --test scripts/runtime-lock-fingerprint.test.mjs scripts/deploy-database-control.test.mjs`、`bash -n deploy-update-optimized.sh` 和 `git diff --check` 通过。
- 发布包内容检查必须确认包含非空 `dist/boot.js`、`dist/public/index.html`、`dist/public/assets/`、运行依赖指纹脚本以及 v10.80、v10.81 迁移；环境文件、依赖目录、Git、发布目录、缓存和本地备份不得进入发布包。

## 性能、回退与运行注意

- 单次银行到账上传只批量读取一次 `counterparty_records` 和一次启用的 `counterparty_match_accounts`，逐流水在内存匹配；原逐流水查询到账信息配置的路径已删除，正常情况下不会增加上传时长。
- 打包明细最早到账继续使用最多 50 页、每页 1000 条的有界扫描；T+1、同日和操作入口继续利用日期、任务或流水主键边界。首版不增加索引，只有真实执行计划或慢查询证明不足时再评估。
- 迁移包含 DDL 和历史回填，执行前必须停止 `finance-platform` 与 `ticket-platform`；迁移后独立回读字段定义、状态一致性及孤立到账信息引用。
- 若需回退应用，可重新部署 `finance-platform-v10.80-local.tar.gz`；迁移新增字段应保留，避免丢失已经固化的人工取消或重新匹配状态。若必须回退数据库，先停止两个联动应用并备份 `bank_flows` 新字段数据，再由人工制定反向迁移。
