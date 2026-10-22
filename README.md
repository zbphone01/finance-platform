# 财务对账及认账管理平台

本目录是财务对账及认账管理平台项目，当前版本为 `v10.85-local`。

## 关键文档

- [`docs/finance-recon-SKILL.md`](docs/finance-recon-SKILL.md)：跨版本稳定的业务规则、数据库连接、性能红线、部署原则和排错提示。
- [`docs/VERSION_SNAPSHOT_v10.85-local.md`](docs/VERSION_SNAPSHOT_v10.85-local.md)：当前版本的功能范围、数据库迁移、验证结果和风险回退说明。
- [`docs/DEPLOY_v10.85-local.md`](docs/DEPLOY_v10.85-local.md)：从上一实际部署包 v10.84 升级到 v10.85 的完整部署指令。
- `docs/VERSION_SNAPSHOT_vX-local.md`：每个版本对应的功能范围、数据库迁移、验证结果和风险回退说明；查看当前版本时选择版本号一致的文件。
- `docs/DEPLOY_vX-local.md`：每个版本从上一版本升级到本版本的完整部署指令；部署时选择目标版本对应的文件。
- [`docs/迭代备忘.md`](docs/迭代备忘.md)：尚未实施、需在后续版本重新评估的事项。

历史版本使用对应的 `docs/VERSION_SNAPSHOT_vX-local.md` 和 `docs/DEPLOY_vX-local.md` 查询，不把多版本升级路径累积到当前文档。

## 文档更新约定

- 日常迭代产生的稳定业务规则和性能约束更新到 skill。
- 每次发版新建或更新当前版本快照，记录功能变化、数据库结构、迁移检查、验证结果和回退风险。
- 部署说明只写从上一版本到当前版本的完整可执行步骤，并遵循 skill 中的部署文档约定。
- 发版时同步更新本 README 和 skill 顶部的当前版本、快照、部署说明及发布包入口。
- 历史版本快照和部署说明继续保留，避免在当前文档中复制历史迁移命令。

## 常用命令

```bash
npm install
npm run check
npm run build
npm run dev
```

## 目录说明

- `api/`：后端接口、认账执行逻辑、流式上传订单明细。
- `src/`：前端页面和通用组件。
- `db/`：数据库 schema。
- `docs/`：项目 skill、版本快照、部署说明和迭代备忘。
- `releases/`：当前整理时保留的最新部署包。
- `deploy-update-optimized.sh`：推荐的线上部署脚本。

## 环境变量

项目不包含真实 `.env` 文件。首次运行时需自行创建，数据库和服务器环境约定见 [`docs/finance-recon-SKILL.md`](docs/finance-recon-SKILL.md)。

本地沙盒数据库曾使用：

```text
DATABASE_URL=mysql://finance_sandbox:******@localhost:3306/finance_recon_sandbox
```

线上数据库曾使用：

```text
DATABASE_URL=mysql://finance_user:******@localhost:3306/finance_recon
```

请不要把真实密码提交到项目中。

## 当前重点

当前版本调整明细认账规则整体编辑页：已有条件按编号从大到小展示，仅保留上部“添加条件”入口，新增条件显示在已有条件最上方；底层条件编号、保存顺序和认账逻辑不变。

## GitHub 托管

公开仓库：https://github.com/zbphone01/finance-platform 。

首次公开提交以当前版本为起点，旧历史仅保存在本地私有备份中。环境文件、密钥、业务导出、数据库数据备份和本地部署包不纳入仓库；数据库结构及迁移脚本保留。文档中的服务器地址和个人路径为示例，实际连接信息由本机配置提供。

后续只有用户明确要求时才提交并推送，不配置自动推送。
