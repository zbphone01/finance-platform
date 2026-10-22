ALTER TABLE income_rule_splits
  ADD COLUMN member_name VARCHAR(200) NULL AFTER feedback_type,
  ADD COLUMN region ENUM('北京市', '外省市', '港澳台', '境外', '内部客商') NULL AFTER member_name,
  ADD COLUMN is_anonymous INT NOT NULL DEFAULT 0 AFTER region,
  ADD COLUMN management_fee_type ENUM('比例', '金额') NOT NULL DEFAULT '比例' AFTER is_anonymous,
  ADD COLUMN management_fee_value DECIMAL(18,2) DEFAULT 0.00 AFTER management_fee_type;

UPDATE income_rule_splits
SET management_fee_type = '比例',
    management_fee_value = COALESCE(CAST(management_fee_ratio AS DECIMAL(18,2)), 0.00)
WHERE management_fee_value IS NULL OR management_fee_value = 0.00;

ALTER TABLE match_results
  ADD COLUMN member_name VARCHAR(200) NULL AFTER bank_post_script,
  ADD COLUMN region ENUM('北京市', '外省市', '港澳台', '境外', '内部客商') NULL AFTER member_name,
  ADD COLUMN is_anonymous INT NOT NULL DEFAULT 0 AFTER region,
  ADD COLUMN management_fee_type ENUM('比例', '金额') NOT NULL DEFAULT '比例' AFTER is_anonymous,
  ADD COLUMN management_fee_value DECIMAL(18,2) DEFAULT 0.00 AFTER management_fee_type;

UPDATE match_results
SET management_fee_type = '比例',
    management_fee_value = COALESCE(CAST(management_fee_ratio AS DECIMAL(18,2)), 0.00)
WHERE management_fee_value IS NULL OR management_fee_value = 0.00;
