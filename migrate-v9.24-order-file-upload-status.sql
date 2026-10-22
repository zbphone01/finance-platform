ALTER TABLE order_files
  ADD COLUMN rule_id BIGINT UNSIGNED NULL AFTER file_name,
  ADD COLUMN upload_status ENUM('processing','completed','failed') NOT NULL DEFAULT 'completed' AFTER raw_columns,
  ADD COLUMN processed_count INT NOT NULL DEFAULT 0 AFTER entry_count,
  ADD COLUMN matched_count INT NOT NULL DEFAULT 0 AFTER processed_count,
  ADD COLUMN unmatched_count INT NOT NULL DEFAULT 0 AFTER matched_count,
  ADD COLUMN failed_reason VARCHAR(500) NULL AFTER unmatched_count,
  ADD INDEX of_rule_idx (rule_id),
  ADD INDEX of_upload_status_idx (upload_status);
