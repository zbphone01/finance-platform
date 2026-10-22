-- v10.16: 到账认账规则分账新增捐赠来源
ALTER TABLE income_rule_splits
  ADD COLUMN donation_source varchar(50) NULL AFTER income_type;
