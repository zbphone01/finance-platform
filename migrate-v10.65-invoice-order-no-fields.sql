-- v10.65: 明细认账规则增加票据用单号字段配置。
-- 三个字段均允许为空，现有规则不回填；配置后订单上传会把对应原始列写入 raw_data。

ALTER TABLE recognition_rules
  ADD COLUMN invoice_financial_flow_no_field VARCHAR(100) NULL DEFAULT NULL AFTER order_no_field,
  ADD COLUMN invoice_business_flow_no_field VARCHAR(100) NULL DEFAULT NULL AFTER invoice_financial_flow_no_field,
  ADD COLUMN invoice_merchant_order_no_field VARCHAR(100) NULL DEFAULT NULL AFTER invoice_business_flow_no_field;
