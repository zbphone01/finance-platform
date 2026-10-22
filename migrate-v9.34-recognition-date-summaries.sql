CREATE TABLE IF NOT EXISTS recognition_date_summaries (
  bill_date VARCHAR(20) NOT NULL,
  primary_task_id BIGINT UNSIGNED NOT NULL,
  status ENUM('pending_recognition', 'processing', 'large_variance', 'partial_matched', 'completed', 'failed') NOT NULL DEFAULT 'pending_recognition',
  task_count INT NOT NULL DEFAULT 0,
  bank_flow_total DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  bank_flow_count INT NOT NULL DEFAULT 0,
  bill_detail_total DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  bill_detail_count INT NOT NULL DEFAULT 0,
  recognized_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  matched_count INT NOT NULL DEFAULT 0,
  unmatched_count INT NOT NULL DEFAULT 0,
  diff_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  has_detail_file TINYINT(1) NOT NULL DEFAULT 0,
  variance_rule_name VARCHAR(200) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  PRIMARY KEY (bill_date),
  KEY rds_status_idx (status),
  KEY rds_updated_at_idx (updated_at),
  KEY rds_primary_task_idx (primary_task_id)
);

INSERT INTO recognition_date_summaries (
  bill_date,
  primary_task_id,
  status,
  task_count,
  bank_flow_total,
  bank_flow_count,
  bill_detail_total,
  bill_detail_count,
  recognized_amount,
  matched_count,
  unmatched_count,
  diff_amount,
  has_detail_file,
  variance_rule_name,
  updated_at,
  completed_at
)
SELECT
  task_summary.bill_date,
  task_summary.primary_task_id,
  task_summary.status,
  task_summary.task_count,
  task_summary.bank_flow_total,
  task_summary.bank_flow_count,
  task_summary.bill_detail_total,
  task_summary.bill_detail_count,
  COALESCE(result_summary.recognized_amount, 0.00) AS recognized_amount,
  task_summary.matched_count,
  task_summary.unmatched_count,
  ABS(task_summary.bill_detail_total - task_summary.detail_bank_flow_total) AS diff_amount,
  task_summary.has_detail_file,
  task_summary.variance_rule_name,
  task_summary.updated_at,
  task_summary.completed_at
FROM (
  SELECT
    rt.bill_date,
    MIN(rt.id) AS primary_task_id,
    CASE
      WHEN SUM(CASE WHEN rt.status = 'processing' THEN 1 ELSE 0 END) > 0 THEN 'processing'
      WHEN SUM(CASE WHEN rt.status = 'large_variance' THEN 1 ELSE 0 END) > 0 THEN 'large_variance'
      WHEN SUM(CASE WHEN rt.status = 'failed' THEN 1 ELSE 0 END) > 0 THEN 'failed'
      WHEN SUM(CASE WHEN rt.status = 'partial_matched' THEN 1 ELSE 0 END) > 0 THEN 'partial_matched'
      WHEN SUM(COALESCE(rt.bank_flow_count, 0)) > 0
        AND SUM(CASE WHEN COALESCE(rt.bank_flow_count, 0) > 0 AND rt.status = 'completed' THEN 1 ELSE 0 END)
          = SUM(CASE WHEN COALESCE(rt.bank_flow_count, 0) > 0 THEN 1 ELSE 0 END)
        THEN 'completed'
      WHEN SUM(CASE WHEN rt.status = 'completed' THEN 1 ELSE 0 END) > 0 THEN 'partial_matched'
      ELSE 'pending_recognition'
    END AS status,
    COUNT(*) AS task_count,
    COALESCE(SUM(CAST(rt.bank_flow_total AS DECIMAL(18,2))), 0.00) AS bank_flow_total,
    COALESCE(SUM(rt.bank_flow_count), 0) AS bank_flow_count,
    COALESCE(SUM(CAST(rt.bill_detail_total AS DECIMAL(18,2))), 0.00) AS bill_detail_total,
    COALESCE(SUM(rt.bill_detail_count), 0) AS bill_detail_count,
    COALESCE(SUM(CASE WHEN COALESCE(rt.bill_detail_count, 0) > 0 THEN CAST(rt.bank_flow_total AS DECIMAL(18,2)) ELSE 0 END), 0.00) AS detail_bank_flow_total,
    COALESCE(SUM(rt.matched_count), 0) AS matched_count,
    COALESCE(SUM(rt.unmatched_count), 0) AS unmatched_count,
    MAX(CASE WHEN rt.has_detail_file THEN 1 ELSE 0 END) AS has_detail_file,
    SUBSTRING_INDEX(GROUP_CONCAT(CASE WHEN rt.status = 'large_variance' THEN rr.rule_name ELSE NULL END ORDER BY rt.id SEPARATOR ','), ',', 1) AS variance_rule_name,
    MAX(rt.updated_at) AS updated_at,
    MAX(rt.completed_at) AS completed_at
  FROM recognition_tasks rt
  LEFT JOIN recognition_rules rr ON rr.id = rt.rule_id
  GROUP BY rt.bill_date
) task_summary
LEFT JOIN (
  SELECT
    rt.bill_date,
    COALESCE(SUM(CAST(mr.split_amount AS DECIMAL(18,2))), 0.00) AS recognized_amount
  FROM match_results mr
  INNER JOIN recognition_tasks rt ON rt.id = mr.task_id
  GROUP BY rt.bill_date
) result_summary ON result_summary.bill_date = task_summary.bill_date
ON DUPLICATE KEY UPDATE
  primary_task_id = VALUES(primary_task_id),
  status = VALUES(status),
  task_count = VALUES(task_count),
  bank_flow_total = VALUES(bank_flow_total),
  bank_flow_count = VALUES(bank_flow_count),
  bill_detail_total = VALUES(bill_detail_total),
  bill_detail_count = VALUES(bill_detail_count),
  recognized_amount = VALUES(recognized_amount),
  matched_count = VALUES(matched_count),
  unmatched_count = VALUES(unmatched_count),
  diff_amount = VALUES(diff_amount),
  has_detail_file = VALUES(has_detail_file),
  variance_rule_name = VALUES(variance_rule_name),
  updated_at = VALUES(updated_at),
  completed_at = VALUES(completed_at);
