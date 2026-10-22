# v10.40-local 部署说明

## 文件

- `releases/finance-platform-v10.40-local.tar.gz`：v10.40 部署包
- `deploy-update-optimized.sh`：推荐部署脚本
- `docs/VERSION_SNAPSHOT_v10.40-local.md`：版本快照

## 重要说明

- 从 v10.39 升级到 v10.40 不需要执行 SQL 迁移，直接部署代码包。
- 从 v10.36 升级时，必须先按 `docs/DEPLOY_v10.38-local.md` 依次完成 v10.37、v10.38 迁移，再部署 v10.40。
- 更旧环境先按历史部署说明补齐至 v10.38。
- 本版不新增依赖、不调整配置，不执行 `drizzle schema push`。

## 测试服务器1部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.40-local.tar.gz \
  deploy-update-optimized.sh \
  ubuntu@server1.example.com:/home/ubuntu/finance-platform/
```

部署：

```bash
ssh ubuntu@server1.example.com
cd /home/ubuntu/finance-platform
chmod +x deploy-update-optimized.sh
df -h / /var/lib/mysql
./deploy-update-optimized.sh finance-platform-v10.40-local.tar.gz
pm2 status
pm2 logs finance-platform --lines 120
```

## 测试服务器2部署

上传：

```bash
cd /home/deploy/Documents/资金池认账
scp releases/finance-platform-v10.40-local.tar.gz \
  deploy-update-optimized.sh \
  administrator@server2.example.com:/home/administrator/finance-platform/
```

部署：

```bash
ssh administrator@server2.example.com
cd /home/administrator/finance-platform
chmod +x deploy-update-optimized.sh
df -h / /var/lib/mysql
APP_DIR=/home/administrator/finance-platform ACCESS_HOST=server2.example.com ./deploy-update-optimized.sh finance-platform-v10.40-local.tar.gz
pm2 status
pm2 logs finance-platform --lines 120
```

## 功能验证

- 页面右上角版本号显示 `v10.40`。
- 删除明细分账包时列表显示“删除中”，全部操作不可点击；成功后条目消失并显示右上角提示。
- 新部署后首次打开明细分账上传弹窗时显示解析组件加载状态；连续点击“上传并执行”不会创建两个上传任务。
- 删除订单明细包弹窗没有右上角关闭按钮；删除前可取消，删除过程中不能关闭。
- 上传订单明细后，状态筛选行右侧显示“文件名，入库中 n 行”，入库完成后自动隐藏并显示右上角提示；过长文件名应缩略且不挤压筛选项。
- 新制凭证汇总行的结算方式为 `203_网上银行`；广发银行、工商银行分别显示 `广发银行1333账号`、`工商银行0733账号`。

## 回退

- v10.40 没有数据库迁移；代码可直接使用 v10.39 部署包回退。
- 回退后恢复 v10.39 的上传、删除和进度展示交互；已生成的凭证说明快照不会自动改写。
- 回退不会自动撤销 v10.40 已完成的上传、删除、制单或其他业务数据变化，需按业务流程单独核对。
