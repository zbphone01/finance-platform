-- v10.70: 票据用单号收敛为订单号字段、其他单号1、其他单号2。
-- 本迁移不保留旧字段兼容：前两个票据单号字段直接改名，第三个字段及其数据直接删除。

ALTER TABLE `recognition_rules`
  CHANGE COLUMN `invoice_financial_flow_no_field` `invoice_other_order_no_1_field` VARCHAR(100) NULL DEFAULT NULL,
  CHANGE COLUMN `invoice_business_flow_no_field` `invoice_other_order_no_2_field` VARCHAR(100) NULL DEFAULT NULL,
  DROP COLUMN `invoice_merchant_order_no_field`;

UPDATE `invoice_recognized_projection_jobs`
SET `field_snapshot` = JSON_OBJECT(
  'version', 2,
  'orderNo', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`field_snapshot`, '$.primaryOrder')), ''),
  'otherOrderNo1', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`field_snapshot`, '$.financialFlow')), ''),
  'otherOrderNo2', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(`field_snapshot`, '$.businessFlow')), '')
);
