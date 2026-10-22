-- v9.58: 明细认账规则新增“条件认账”开关
ALTER TABLE recognition_rules
  ADD COLUMN condition_recognition_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER order_no_field;
