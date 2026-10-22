ALTER TABLE match_results
  ADD COLUMN management_fee_amount DECIMAL(18,2) DEFAULT 0.00 AFTER management_fee_ratio;

UPDATE match_results
SET management_fee_amount = ROUND(
  COALESCE(CAST(split_amount AS DECIMAL(18,2)), 0) *
  COALESCE(CAST(management_fee_ratio AS DECIMAL(5,2)), 0) / 100,
  2
);
