-- v9.77: 明细认账规则增加退款订单判断字段
ALTER TABLE recognition_rules
  ADD COLUMN refund_order_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER exclude_order_keyword,
  ADD COLUMN refund_judge_field VARCHAR(100) NULL AFTER refund_order_enabled,
  ADD COLUMN refund_judge_value VARCHAR(500) NULL AFTER refund_judge_field,
  ADD COLUMN refund_amount_field VARCHAR(100) NULL AFTER refund_judge_value;
