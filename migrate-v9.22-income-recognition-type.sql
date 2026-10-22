ALTER TABLE income_recognition_rules
  ADD COLUMN recognition_type ENUM('银行直捐','渠道捐赠') NOT NULL DEFAULT '渠道捐赠' AFTER rule_name;

ALTER TABLE income_rule_splits
  ADD COLUMN feedback_type ENUM('反馈','重点反馈') NULL AFTER platform_project_name;
