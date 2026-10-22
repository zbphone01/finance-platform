-- v10.60: 忽略/转移订单的小型分组增量汇总。
--
-- 不扫描或回填历史 bill_details。历史订单包继续依赖
-- recognition_summary_valid = 0 或转入明细覆盖校验回退原明细查询。
--
-- source_deduction:
--   从来源订单包上传快照扣除已忽略或已转出的明细。
-- target_transfer_in:
--   向目标 task_id + rule_id + partition_date 增加待认账转入明细。
--
-- file_total 保存总数量和净额；rule_item 保存认账条件及收入/退款分组。

CREATE TABLE order_recognition_summary_deltas (
  delta_type ENUM('source_deduction', 'target_transfer_in') NOT NULL,
  order_file_id BIGINT UNSIGNED NOT NULL,
  task_id BIGINT UNSIGNED NOT NULL,
  rule_id BIGINT UNSIGNED NOT NULL,
  partition_date DATE NOT NULL,
  summary_kind ENUM('file_total', 'rule_item') NOT NULL,
  rule_item_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  is_refund TINYINT(1) NOT NULL DEFAULT 0,
  detail_count INT NOT NULL DEFAULT 0,
  total_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT orsd_pk PRIMARY KEY (
    delta_type,
    order_file_id,
    task_id,
    rule_id,
    partition_date,
    summary_kind,
    rule_item_id,
    is_refund
  ),
  KEY orsd_source_idx (delta_type, order_file_id),
  KEY orsd_target_idx (delta_type, task_id, rule_id, partition_date),
  CONSTRAINT orsd_order_file_fk
    FOREIGN KEY (order_file_id) REFERENCES order_files(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
