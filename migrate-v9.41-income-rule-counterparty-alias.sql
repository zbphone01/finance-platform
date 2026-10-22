ALTER TABLE income_recognition_rules
  ADD COLUMN matched_counterparty_alias VARCHAR(200) NULL AFTER rule_name;
