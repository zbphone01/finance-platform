# v9.58-local 版本快照

## 发布范围

- 本版用于替代 v9.57.1-local 包，包含 v9.58 本轮明细认账规则能力以及 v9.57 系列既有修正。
- 部署包：`releases/finance-platform-v9.58-local.tar.gz`。
- 推荐继续使用 `deploy-update-optimized.sh` 部署。

## 明细认账规则

- 规则基本信息新增 `条件认账` 开关，默认开启；历史已有规则按开启处理。
- 关闭 `条件认账` 后，不再填写认账关键字条件，只维护整包分账设置；订单包会按该分账设置汇总一次入账。
- 规则基本信息新增 `排除订单` 开关，默认关闭；历史已有规则按关闭处理。
- 开启 `排除订单` 后，需填写 `识别字段` 和 `字段关键字`；订单明细上传预匹配前会先按精确匹配丢弃命中的明细，未命中的明细继续走预匹配。
- 规则详情页中，开启的 `排除订单` 和 `明细分账` 会分别以独立卡片展示具体配置。
- 明细认账规则列表中，关闭条件认账的规则显示为 `整包入账`，方便区分普通条件规则。

## 订单明细上传

- 流式订单明细上传支持 `排除订单`：命中排除配置的行不写入 `bill_details`。
- 旧订单明细上传接口同步支持 `排除订单`，保持两条上传链路行为一致。
- 关闭 `条件认账` 的规则在上传时会把所有未排除的明细标记到同一个整包分账项，后续执行认账时按订单包汇总金额生成分账结果。

## 数据库迁移

- `migrate-v9.58-condition-recognition-enabled.sql`
  - `recognition_rules` 新增 `condition_recognition_enabled`，默认 `1`。
- `migrate-v9.59-exclude-order-rule.sql`
  - `recognition_rules` 新增 `exclude_order_enabled`、`exclude_order_field`、`exclude_order_keyword`。

## 延续约束

- 明细认账规则列表的普通 `编辑` 入口必须保持整体编辑；单条件编辑只保留在规则详情页。
- 订单明细包和认账及分账列表首屏必须继续读取缓存字段，不得改回实时扫描大明细表。
- `排除订单` 只在订单明细上传入库前生效，不对已入库历史明细做追溯删除。

## 验证

- `npm run check` 通过。
- `npm test -- api/lib/orderUploadStream.test.ts` 通过。
- `npm run build` 通过。
