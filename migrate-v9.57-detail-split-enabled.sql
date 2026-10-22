-- v9.57: 明细分账显式开关
ALTER TABLE recognition_rules
  ADD COLUMN detail_split_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER order_no_field;

UPDATE recognition_rules
SET detail_split_enabled = 1
WHERE COALESCE(TRIM(multi_split_keyword_field), '') <> ''
  AND COALESCE(TRIM(multi_split_keyword), '') <> ''
  AND COALESCE(TRIM(multi_split_match_field), '') <> '';
