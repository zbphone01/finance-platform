-- v9.28: 订单明细支持忽略、转移和取消操作
ALTER TABLE bill_details
  ADD COLUMN operation_status VARCHAR(20) NOT NULL DEFAULT 'active' AFTER match_result_id,
  ADD COLUMN original_task_id BIGINT UNSIGNED NULL AFTER operation_status,
  ADD INDEX bd_operation_status_idx (operation_status),
  ADD INDEX bd_original_task_idx (original_task_id);
