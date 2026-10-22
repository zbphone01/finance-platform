# v9.54-local 部署说明

## 文件

- `releases/finance-platform-v9.54-local.tar.gz`：v9.54 部署包
- `docs/VERSION_SNAPSHOT_v9.54-local.md`：版本快照
- `docs/finance-recon-SKILL.md`：项目技能文档，已更新到 v9.54

## 重要说明

- 本版无新增数据库迁移。
- 本版暂不进行线上部署；请随下一版一起部署。
- v9.54 主要包含：
  - 打包明细上传时增加到账日期选择。
  - 打包明细按所选到账日期生成订单明细包，并匹配同日打包到账银行流水。
  - 上传会话在创建和完成上传两个阶段都携带 `matchDate`，避免分片上传链路丢失日期。
  - 打包明细缺少有效到账日期时直接报错，不再默认使用上传当天。
  - 订单明细包相关列头从 `订单日期/上传日期` 调整为 `订单日期/匹配日期`。

## 暂不部署

本版仅完成本地打包与版本记录，不执行以下线上操作：

```bash
scp releases/finance-platform-v9.54-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/

ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
./deploy-update-optimized.sh finance-platform-v9.54-local.tar.gz
```

以上命令保留为后续随下一版合并部署时参考，请不要单独执行 v9.54 线上部署。

## 后续合并部署参考

下一版上线时，如需携带本版内容，继续使用推荐部署脚本：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v下一版-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/

ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
./deploy-update-optimized.sh finance-platform-v下一版-local.tar.gz
```

## 功能验证

- 上传订单明细并选择 `打包明细` 规则，应显示到账日期选择框。
- 选择 `2026-05-14` 后上传，上传会话应记录 `matchDate: 2026-05-14`。
- 上传成功后，订单明细包和日期汇总任务应落在所选匹配日期。
- 打包明细未携带有效到账日期时，应提示 `请选择有效的到账日期`。
- 进入 `订单明细包` 页面，列头应显示 `订单日期/匹配日期`。
- 进入日期汇总任务详情，订单明细表列头应显示 `订单日期/匹配日期`。
