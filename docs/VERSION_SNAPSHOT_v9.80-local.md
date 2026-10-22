# v9.80-local 版本快照

## 发布范围

- 本版用于替代 v9.79-local 包，加入入账结果按天取消批量制单能力。
- 部署包：`releases/finance-platform-v9.80-local.tar.gz`。
- 推荐继续使用 `deploy-update-optimized.sh` 部署。

## 入账结果制单

- 入账结果按日期汇总列表支持“取消批量制单”。
- 当某天没有待制单记录且存在已制单记录时，原“批量制单”按钮切换为“取消批量制单”。
- 取消批量制单会把当天所有 `已制单` 入账结果恢复为 `待制单`。
- 操作完成后刷新入账结果明细和日期汇总中的已制单/待制单数量。
- 操作权限沿用批量制单，操作员无权限执行。

## 部署脚本

- `deploy-update-optimized.sh` 支持通过 `APP_DIR`、`APP_PORT`、`PM2_NAME` 和 `ACCESS_HOST` 指定目标环境。
- 测试服务器1继续使用默认目录 `/home/ubuntu/finance-platform`。
- 测试服务器2部署时使用 `APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com`。
- PM2 启动不再依赖写死 `/home/ubuntu/finance-platform` 的 `ecosystem.config.cjs`，避免测试服务器2后续迭代部署目录错误。

## 数据库迁移

- 本版不新增数据库迁移。
- 已部署 v9.79 的环境可直接部署代码。
- 从 v9.78 或更旧版本升级时，仍需先按 `docs/finance-recon-SKILL.md` 的“数据迁移”段补齐 `migrate-v9.79-refund-order-file-income-summary.sql` 及更早缺失脚本。

## 验证

- `npm run check` 通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- 发布包完整性检查通过，沿用历史轻量发布方式，不包含本地 `dist`，由服务器部署脚本重新构建。
