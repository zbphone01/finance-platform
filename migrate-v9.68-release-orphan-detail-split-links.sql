-- v9.68: 删除订单明细包后释放悬挂的明细分账子明细绑定

UPDATE bill_details split_detail
LEFT JOIN bill_details source_detail ON source_detail.id = split_detail.split_source_detail_id
SET
  split_detail.task_id = 0,
  split_detail.order_file_id = NULL,
  split_detail.split_source_detail_id = NULL,
  split_detail.bill_date = '1970-01-01',
  split_detail.match_result_id = NULL
WHERE split_detail.detail_split_file_id IS NOT NULL
  AND split_detail.split_source_detail_id IS NOT NULL
  AND source_detail.id IS NULL;

UPDATE detail_split_files dsf
LEFT JOIN (
  SELECT
    detail_split_file_id,
    COUNT(*) AS entry_count,
    SUM(CASE WHEN match_status = 'unmatched' THEN 1 ELSE 0 END) AS unmatched_count,
    SUM(CASE WHEN match_status = 'matched' AND match_result_id IS NULL THEN 1 ELSE 0 END) AS pending_recognition_count,
    SUM(CASE WHEN match_result_id IS NOT NULL THEN 1 ELSE 0 END) AS recognized_count
  FROM bill_details
  WHERE detail_split_file_id IS NOT NULL
  GROUP BY detail_split_file_id
) s ON s.detail_split_file_id = dsf.id
SET
  dsf.entry_count = COALESCE(s.entry_count, 0),
  dsf.processed_count = COALESCE(s.entry_count, 0),
  dsf.unmatched_count = COALESCE(s.unmatched_count, 0),
  dsf.pending_recognition_count = COALESCE(s.pending_recognition_count, 0),
  dsf.recognized_count = COALESCE(s.recognized_count, 0),
  dsf.matched_count = COALESCE(s.pending_recognition_count, 0) + COALESCE(s.recognized_count, 0);
