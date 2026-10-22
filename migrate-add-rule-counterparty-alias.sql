ALTER TABLE recognition_rules
  ADD COLUMN matched_counterparty_alias varchar(200) NULL
  AFTER rule_name;
