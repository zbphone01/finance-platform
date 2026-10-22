-- v10.52: 到账认账规则支持百分比和认账时填写两种分账形式
ALTER TABLE income_rule_splits
  ADD COLUMN split_form ENUM('百分比', '认账时填写')
  NOT NULL DEFAULT '百分比' AFTER income_rule_id;
