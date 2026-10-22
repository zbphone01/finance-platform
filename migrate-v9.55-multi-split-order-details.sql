-- v9.55: 明细认账规则支持单条多分账预识别
ALTER TABLE recognition_rules
  ADD COLUMN multi_split_keyword_field VARCHAR(100) NULL AFTER order_no_field,
  ADD COLUMN multi_split_keyword VARCHAR(100) NULL AFTER multi_split_keyword_field,
  ADD COLUMN multi_split_match_field VARCHAR(100) NULL AFTER multi_split_keyword;

ALTER TABLE bill_details
  MODIFY COLUMN match_status ENUM('unmatched', 'matched', 'pending_split', 'ignored', 'manual_ignored') NOT NULL DEFAULT 'unmatched';
