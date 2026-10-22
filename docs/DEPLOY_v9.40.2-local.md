# v9.40.2-local 部署说明

## 文件

- `releases/finance-platform-v9.40.2-local.tar.gz`：源码部署包
- `deploy-update-optimized.sh`：推荐服务器部署脚本
- `migrate-v9.40-recognition-summary-variance-diff.sql`：v9.40 日期汇总差异金额修正脚本
- `docs/VERSION_SNAPSHOT_v9.40.2-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：最新技能文档

## 重要说明

v9.40.2 主要修订：

- 明细认账入队前先显示“认账执行中”，日期汇总列表在处理中按 15 秒自动刷新。
- 订单明细包支持查看未匹配明细、多来源文件按范围删除、删除中反馈和删除后自动刷新。
- 分账联动中的预算编码、NC项目、公益平台项目筛选更收敛，规则编辑可实时读取新增关联 NC项目。
- 公益平台页面优化项目搜索、固定搜索框和底部新增平台项目入口。
- 修复订单明细 CSV 流式解析破坏 UTF-8 中文商品名称，避免商品名称匹配失败。
- 修复到账别称改名后已有明细认账规则匹配到账信息回显为空，并补充改名联动保护。

本次功能修订没有新增数据库结构迁移。当前发布线已有 v9.40 日期汇总差异金额修正脚本；如果线上尚未执行，先执行：

```bash
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.40-recognition-summary-variance-diff.sql
```

该脚本会按当前任务差异重算 `recognition_date_summaries.diff_amount`。

## 线上部署步骤

### 1. 上传部署文件

```bash
cd /home/deploy/Documents/资金池认账

scp releases/finance-platform-v9.40.2-local.tar.gz \
  deploy-update-optimized.sh \
  migrate-v9.40-recognition-summary-variance-diff.sql \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

### 2. 按需执行 v9.40 数据修正

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
mysql --protocol=TCP -h localhost -u finance_user -p finance_recon < migrate-v9.40-recognition-summary-variance-diff.sql
```

如果已执行过该脚本，可跳过本步。

### 3. 部署代码

```bash
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v9.40.2-local.tar.gz
```

如需强制重新安装依赖：

```bash
FORCE_NPM_INSTALL=1 ./deploy-update-optimized.sh finance-platform-v9.40.2-local.tar.gz
```

### 4. 查看服务状态和日志

```bash
pm2 status
pm2 logs finance-platform --lines 80
```

## 功能验证

- 上传能唯一定位到流水任务的订单明细后，日期汇总列表应显示“认账执行中”，处理完成后 15 秒内切回最终状态。
- 手动点击日期汇总列表“开始认账”后，进入明细认账队列的任务应先显示“认账执行中”。
- 进入 `订单明细包`，右侧仅操作列固定；横向滚动时操作列下方不应透出其他内容。
- 存在未匹配明细的数据包应能从操作列直接查看未匹配明细。
- 多来源文件组成的数据包删除时，应能选择删除整个包或删除某个来源文件；已有制单结果时删除应被阻止。
- 编辑明细认账规则时，预算编码新增关联 NC项目后，应能直接选择新增的可用 NC项目。
- 进入 `认账信息设置 -> 公益平台`，平台项目搜索、固定搜索框和底部添加入口应按版本快照描述工作。
- 重新上传曾出现商品名称 `�` 乱码的订单明细 CSV，订单明细和商品名称预匹配应保持中文完整。
- 在 `到账信息汇总` 修改一个已被明细认账规则使用的到账别称后，进入该规则编辑页，`匹配到账信息` 应回显新别称。
- 对线上历史上已经因别称改名而失效的旧规则，编辑页会显示旧别称不可用提示；需要手动重新选择当前到账信息后保存一次。
