-- v9.66: 修复明细分账后订单明细包来源行状态和汇总缓存

UPDATE bill_details
SET match_status = 'ignored'
WHERE operation_status = 'ignored'
  AND ignore_reason LIKE '已按明细分账拆分认账%'
  AND match_status = 'pending_split';

UPDATE order_files ofi
JOIN (
  SELECT
    order_file_id,
    COUNT(*) AS entry_count,
    COALESCE(SUM(CAST(total_amount AS DECIMAL(18,2))), 0.00) AS order_total_amount,
    SUM(CASE WHEN match_status = 'matched' THEN 1 ELSE 0 END) AS matched_count,
    SUM(CASE WHEN match_status = 'unmatched' THEN 1 ELSE 0 END) AS unmatched_count,
    SUM(CASE WHEN match_status = 'pending_split' THEN 1 ELSE 0 END) AS pending_split_count
  FROM bill_details
  WHERE order_file_id IS NOT NULL
    AND detail_split_file_id IS NULL
  GROUP BY order_file_id
) s ON s.order_file_id = ofi.id
SET
  ofi.entry_count = s.entry_count,
  ofi.processed_count = s.entry_count,
  ofi.order_total_amount = s.order_total_amount,
  ofi.matched_count = s.matched_count,
  ofi.unmatched_count = s.unmatched_count,
  ofi.pending_split_count = s.pending_split_count;
