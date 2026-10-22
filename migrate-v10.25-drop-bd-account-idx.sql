-- v10.25: 删除当前前端搜索未使用的订单明细匹配账户名单列索引

DROP INDEX bd_account_idx ON bill_details;
