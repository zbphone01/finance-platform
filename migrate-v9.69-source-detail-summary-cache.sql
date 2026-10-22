-- v9.69: 日期汇总订单明细快照只统计来源订单明细，不统计明细分账子明细

UPDATE recognition_tasks rt
LEFT JOIN (
  SELECT
    task_id,
    COUNT(*) AS detail_count,
    COALESCE(SUM(CAST(total_amount AS DECIMAL(18,2))), 0.00) AS detail_total,
    SUM(CASE WHEN match_result_id IS NOT NULL THEN 1 ELSE 0 END) AS matched_count,
    SUM(CASE WHEN match_status = 'unmatched' AND COALESCE(operation_status, 'active') = 'active' THEN 1 ELSE 0 END) AS unmatched_count,
    SUM(CASE WHEN match_status = 'pending_split' AND match_result_id IS NULL AND COALESCE(operation_status, 'active') = 'active' THEN 1 ELSE 0 END) AS pending_split_count
  FROM bill_details
  WHERE detail_split_file_id IS NULL
    AND (
      COALESCE(operation_status, 'active') = 'active'
      OR ignore_reason LIKE '已按明细分账拆分认账%'
    )
  GROUP BY task_id
) s ON s.task_id = rt.id
SET
  rt.bill_detail_count = COALESCE(s.detail_count, 0),
  rt.bill_detail_total = COALESCE(s.detail_total, 0.00),
  rt.matched_count = COALESCE(s.matched_count, 0),
  rt.unmatched_count = COALESCE(s.unmatched_count, 0),
  rt.pending_split_count = COALESCE(s.pending_split_count, 0),
  rt.has_detail_file = COALESCE(s.detail_count, 0) > 0,
  rt.updated_at = NOW();

UPDATE recognition_date_summaries rds
JOIN (
  SELECT
    rt.bill_date,
    COALESCE(SUM(CAST(rt.bill_detail_total AS DECIMAL(18,2))), 0.00) AS bill_detail_total,
    COALESCE(SUM(rt.bill_detail_count), 0) AS bill_detail_count,
    COALESCE(SUM(rt.matched_count), 0) AS matched_count,
    COALESCE(SUM(rt.unmatched_count), 0) AS unmatched_count,
    COALESCE(SUM(rt.pending_split_count), 0) AS pending_split_count
  FROM recognition_tasks rt
  GROUP BY rt.bill_date
) s ON s.bill_date = rds.bill_date
SET
  rds.bill_detail_total = s.bill_detail_total,
  rds.bill_detail_count = s.bill_detail_count,
  rds.matched_count = s.matched_count,
  rds.unmatched_count = s.unmatched_count,
  rds.pending_split_count = s.pending_split_count,
  rds.has_detail_file = s.bill_detail_count > 0,
  rds.updated_at = NOW();
