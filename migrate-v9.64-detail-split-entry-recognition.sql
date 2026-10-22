-- v9.64: 明细分账改为先上传条目，再选择订单明细包执行拆分认账

ALTER TABLE detail_split_files
  MODIFY COLUMN order_file_id BIGINT UNSIGNED NULL,
  MODIFY COLUMN task_id BIGINT UNSIGNED NULL,
  ADD COLUMN recognition_keyword_field VARCHAR(100) NULL AFTER income_field;

ALTER TABLE bill_details
  ADD INDEX bd_rule_detail_split_status_idx (rule_id, detail_split_file_id, match_status, match_result_id),
  ADD INDEX bd_order_pending_split_idx (order_file_id, match_status, match_result_id);
