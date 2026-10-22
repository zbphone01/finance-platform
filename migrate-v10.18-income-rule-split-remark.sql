-- v10.18: 到账认账规则分账新增备注字段
ALTER TABLE income_rule_splits
  ADD COLUMN remark VARCHAR(500) NULL AFTER income_attr;
