-- v9.89: 优化支付宝 T+1 大订单明细包认账执行索引
-- 典型查询：按订单明细包、匹配状态、是否已生成入账结果、规则项分组执行认账。
CREATE INDEX bd_order_rec_item_idx
  ON bill_details (order_file_id, match_status, match_result_id, rule_item_id);
