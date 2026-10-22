# v10.29-local 版本快照

## 发布范围

- 本版聚焦订单明细表索引瘦身，删除不再作为自动认账主路径使用的描述字段索引。
- 右上角系统版本号更新为 `v10.29`。
- 部署包：`releases/finance-platform-v10.29-local.tar.gz`。
- 推荐继续使用 `deploy-update-optimized.sh` 部署。

## 索引调整

- `bill_details` 和已有 `bill_details_archive_YYYYMM` 归档表删除 `bd_desc_idx(description)`。
- 条件认账规则的关键字字段和关键字均为必填，自动认账匹配主路径读取 `raw_data` 中的规则字段，不再依赖 `description` 单列索引。
- 已忽略明细搜索中的 `description LIKE '%关键词%'` 仍可用，但该查询本身无法通过 BTree 单列索引精准定位。

## 数据库迁移

- 本版新增迁移：`migrate-v10.29-drop-bd-desc-idx.sql`。
- 已部署 `v10.28` 的环境执行本迁移后再部署 v10.29 代码包。
- 如果目标环境尚未部署 v10.28，需要先补齐 v10.26、v10.27、v10.28 历史迁移。
- 本地 `finance_recon_sandbox` 已执行 v10.29 迁移，复查热表和归档表均无 `bd_desc_idx` 残留。

## 本地验证

- `npm run check` 通过。
- `npm run build` 通过。
- `git diff --check` 通过。
- `releases/finance-platform-v10.29-local.tar.gz` 已生成并通过内容检查。
