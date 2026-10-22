-- v10.02: Store recognition type snapshot on match results.
ALTER TABLE match_results
  ADD COLUMN recognition_type ENUM('银行直捐','渠道捐赠') NOT NULL DEFAULT '渠道捐赠' AFTER bank_flow_id;

UPDATE match_results mr
JOIN income_recognition_rules irr ON irr.id = mr.income_rule_id
SET mr.recognition_type = irr.recognition_type
WHERE mr.income_rule_id IS NOT NULL;
