-- v9.60: 明细分账包上传与分账明细入库

CREATE TABLE IF NOT EXISTS detail_split_files (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_file_id BIGINT UNSIGNED NOT NULL,
  task_id BIGINT UNSIGNED NOT NULL,
  rule_id BIGINT UNSIGNED NOT NULL,
  file_name VARCHAR(200) NOT NULL,
  match_field VARCHAR(100) NOT NULL,
  income_field VARCHAR(100) NOT NULL,
  raw_columns TEXT NULL,
  upload_status ENUM('processing', 'completed', 'failed') NOT NULL DEFAULT 'completed',
  entry_count INT NOT NULL DEFAULT 0,
  processed_count INT NOT NULL DEFAULT 0,
  matched_count INT NOT NULL DEFAULT 0,
  unmatched_count INT NOT NULL DEFAULT 0,
  failed_reason VARCHAR(500) NULL,
  uploader_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX dsf_order_file_idx (order_file_id),
  INDEX dsf_task_idx (task_id),
  INDEX dsf_rule_idx (rule_id),
  INDEX dsf_upload_status_idx (upload_status),
  INDEX dsf_created_at_idx (created_at)
);

ALTER TABLE bill_details
  ADD COLUMN detail_split_file_id BIGINT UNSIGNED NULL AFTER order_file_id,
  ADD COLUMN split_source_detail_id BIGINT UNSIGNED NULL AFTER detail_split_file_id,
  ADD INDEX bd_detail_split_file_idx (detail_split_file_id),
  ADD INDEX bd_split_source_detail_idx (split_source_detail_id);
