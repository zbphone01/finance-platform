-- v9.59: 明细认账规则新增“排除订单”开关
ALTER TABLE recognition_rules
  ADD COLUMN exclude_order_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER condition_recognition_enabled,
  ADD COLUMN exclude_order_field VARCHAR(100) NULL AFTER exclude_order_enabled,
  ADD COLUMN exclude_order_keyword VARCHAR(500) NULL AFTER exclude_order_field;
