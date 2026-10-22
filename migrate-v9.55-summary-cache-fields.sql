-- v9.55: 统计缓存补充待拆分与订单明细包金额
ALTER TABLE order_files
  ADD COLUMN order_total_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00 AFTER processed_count,
  ADD COLUMN pending_split_count INT NOT NULL DEFAULT 0 AFTER unmatched_count;

ALTER TABLE recognition_tasks
  ADD COLUMN pending_split_count INT DEFAULT 0 AFTER unmatched_count;

ALTER TABLE recognition_date_summaries
  ADD COLUMN pending_split_count INT NOT NULL DEFAULT 0 AFTER unmatched_count;

UPDATE order_files f
LEFT JOIN (
  SELECT
    order_file_id,
    COUNT(*) AS entry_count,
    COALESCE(SUM(CAST(total_amount AS DECIMAL(18,2))), 0.00) AS order_total_amount,
    SUM(CASE WHEN match_status = 'matched' THEN 1 ELSE 0 END) AS matched_count,
    SUM(CASE WHEN match_status = 'unmatched' THEN 1 ELSE 0 END) AS unmatched_count,
    SUM(CASE WHEN match_status = 'pending_split' THEN 1 ELSE 0 END) AS pending_split_count
  FROM bill_details
  WHERE COALESCE(operation_status, 'active') <> 'ignored'
  GROUP BY order_file_id
) s ON s.order_file_id = f.id
SET
  f.entry_count = COALESCE(s.entry_count, 0),
  f.processed_count = COALESCE(s.entry_count, 0),
  f.order_total_amount = COALESCE(s.order_total_amount, 0.00),
  f.matched_count = COALESCE(s.matched_count, 0),
  f.unmatched_count = COALESCE(s.unmatched_count, 0),
  f.pending_split_count = COALESCE(s.pending_split_count, 0);

UPDATE recognition_tasks t
LEFT JOIN (
  SELECT
    task_id,
    COALESCE(SUM(CAST(total_amount AS DECIMAL(18,2))), 0.00) AS bill_detail_total,
    COUNT(*) AS bill_detail_count,
    SUM(CASE WHEN match_result_id IS NOT NULL THEN 1 ELSE 0 END) AS matched_count,
    SUM(CASE WHEN match_status = 'unmatched' THEN 1 ELSE 0 END) AS unmatched_count,
    SUM(CASE WHEN match_status = 'pending_split' AND match_result_id IS NULL THEN 1 ELSE 0 END) AS pending_split_count
  FROM bill_details bd
  WHERE COALESCE(operation_status, 'active') <> 'ignored'
    AND NOT EXISTS (
      SELECT 1 FROM order_files f
      WHERE f.id = bd.order_file_id AND f.upload_status = 'abnormal'
    )
  GROUP BY task_id
) s ON s.task_id = t.id
SET
  t.bill_detail_total = COALESCE(s.bill_detail_total, 0.00),
  t.bill_detail_count = COALESCE(s.bill_detail_count, 0),
  t.matched_count = COALESCE(s.matched_count, 0),
  t.unmatched_count = COALESCE(s.unmatched_count, 0),
  t.pending_split_count = COALESCE(s.pending_split_count, 0),
  t.has_detail_file = COALESCE(s.bill_detail_count, 0) > 0;

UPDATE recognition_date_summaries r
LEFT JOIN (
  SELECT
    bill_date,
    SUM(bill_detail_count) AS bill_detail_count,
    SUM(matched_count) AS matched_count,
    SUM(unmatched_count) AS unmatched_count,
    SUM(pending_split_count) AS pending_split_count,
    SUM(CASE WHEN has_detail_file THEN 1 ELSE 0 END) AS detail_task_count
  FROM recognition_tasks
  GROUP BY bill_date
) s ON s.bill_date = r.bill_date
SET
  r.bill_detail_count = COALESCE(s.bill_detail_count, 0),
  r.matched_count = COALESCE(s.matched_count, 0),
  r.unmatched_count = COALESCE(s.unmatched_count, 0),
  r.pending_split_count = COALESCE(s.pending_split_count, 0),
  r.has_detail_file = COALESCE(s.detail_task_count, 0) > 0,
  r.updated_at = NOW();
