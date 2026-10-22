ALTER TABLE match_results
  ADD COLUMN platform_project_display_name VARCHAR(700) NULL AFTER platform_project_name,
  ADD COLUMN bank_reference_no VARCHAR(100) NULL AFTER platform_project_detail,
  ADD COLUMN bank_transaction_time VARCHAR(30) NULL AFTER bank_reference_no,
  ADD COLUMN bank_income DECIMAL(18,2) NULL AFTER bank_transaction_time,
  ADD COLUMN bank_counterparty_account VARCHAR(100) NULL AFTER bank_income,
  ADD COLUMN bank_counterparty_name VARCHAR(200) NULL AFTER bank_counterparty_account,
  ADD COLUMN bank_counterparty_bank VARCHAR(200) NULL AFTER bank_counterparty_name,
  ADD COLUMN bank_summary VARCHAR(500) NULL AFTER bank_counterparty_bank,
  ADD COLUMN bank_purpose VARCHAR(500) NULL AFTER bank_summary,
  ADD COLUMN bank_post_script VARCHAR(500) NULL AFTER bank_purpose;

UPDATE match_results mr
LEFT JOIN bank_flows bf ON bf.id = mr.bank_flow_id
SET
  mr.bank_reference_no = bf.reference_no,
  mr.bank_transaction_time = bf.transaction_time,
  mr.bank_income = bf.income,
  mr.bank_counterparty_account = bf.counterparty_account,
  mr.bank_counterparty_name = bf.counterparty_name,
  mr.bank_counterparty_bank = bf.counterparty_bank,
  mr.bank_summary = bf.summary,
  mr.bank_purpose = bf.purpose,
  mr.bank_post_script = bf.post_script
WHERE mr.bank_flow_id IS NOT NULL;

UPDATE match_results mr
LEFT JOIN projects p ON p.code = SUBSTRING_INDEX(mr.platform_project_name, '_', 1)
LEFT JOIN fundraising_platforms fp ON fp.platform_id = p.platform_id
SET mr.platform_project_display_name = CASE
  WHEN mr.platform_project_name IS NULL OR mr.platform_project_name = '' THEN mr.platform_project_name
  WHEN mr.platform_project_name LIKE '% / %' THEN mr.platform_project_name
  WHEN fp.name IS NOT NULL THEN CONCAT(fp.name, ' / ', mr.platform_project_name)
  ELSE mr.platform_project_name
END;

CREATE INDEX mr_entry_time_id_idx ON match_results (entry_time, id);
CREATE INDEX mr_entry_time_budget_idx ON match_results (entry_time, budget_code);
CREATE INDEX mr_entry_time_voucher_idx ON match_results (entry_time, voucher_status);
