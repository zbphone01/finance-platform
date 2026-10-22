-- v9.79: 修复开启退款订单判断后，订单明细包收入金额被退款负数抵减的问题
-- 收入口径只汇总非退款明细；退款金额继续读取退款快照；异常判断改为明细绝对金额全为 0。

UPDATE order_files ofi
JOIN (
  SELECT
    bd.order_file_id,
    COUNT(*) AS entry_count,
    COALESCE(SUM(CASE WHEN CAST(bd.refund_amount_snapshot AS DECIMAL(18,2)) > 0 THEN 0 ELSE CAST(bd.total_amount AS DECIMAL(18,2)) END), 0.00) AS income_total,
    COALESCE(SUM(CAST(bd.refund_amount_snapshot AS DECIMAL(18,2))), 0.00) AS refund_total,
    COALESCE(SUM(ABS(CAST(bd.total_amount AS DECIMAL(18,2)))), 0.00) AS activity_total,
    SUM(CASE WHEN bd.match_status = 'matched' THEN 1 ELSE 0 END) AS matched_count,
    SUM(CASE WHEN bd.match_status = 'unmatched' THEN 1 ELSE 0 END) AS unmatched_count,
    SUM(CASE WHEN bd.match_status = 'pending_split' THEN 1 ELSE 0 END) AS pending_split_count
  FROM bill_details bd
  WHERE bd.detail_split_file_id IS NULL
    AND COALESCE(bd.operation_status, 'active') <> 'ignored'
  GROUP BY bd.order_file_id
) s ON s.order_file_id = ofi.id
SET
  ofi.entry_count = s.entry_count,
  ofi.processed_count = s.entry_count,
  ofi.order_total_amount = ROUND(s.income_total, 2),
  ofi.refund_amount = ROUND(s.refund_total, 2),
  ofi.matched_count = s.matched_count,
  ofi.unmatched_count = s.unmatched_count,
  ofi.pending_split_count = s.pending_split_count,
  ofi.upload_status = CASE
    WHEN s.entry_count > 0 AND ABS(s.activity_total) < 0.005 THEN 'abnormal'
    ELSE 'completed'
  END,
  ofi.failed_reason = CASE
    WHEN s.entry_count > 0 AND ABS(s.activity_total) < 0.005 THEN '订单总金额为0，已标记异常，不参与认账'
    ELSE NULL
  END
WHERE ofi.upload_status IN ('completed', 'abnormal');
