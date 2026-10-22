-- v9.78: 订单明细保存退款金额快照，并回填已按退款订单入库的历史明细
ALTER TABLE bill_details
  ADD COLUMN refund_amount_snapshot DECIMAL(18,2) NOT NULL DEFAULT 0.00 AFTER total_amount;

ALTER TABLE order_files
  ADD COLUMN refund_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00 AFTER order_total_amount;

UPDATE bill_details
SET refund_amount_snapshot = ABS(CAST(total_amount AS DECIMAL(18,2)))
WHERE LOCATE('__退款__', bill_no) > 0
  AND CAST(total_amount AS DECIMAL(18,2)) < 0
  AND refund_amount_snapshot = 0.00;

UPDATE order_files ofi
LEFT JOIN (
  SELECT
    order_file_id,
    COALESCE(SUM(CAST(refund_amount_snapshot AS DECIMAL(18,2))), 0.00) AS refund_amount
  FROM bill_details
  WHERE detail_split_file_id IS NULL
    AND COALESCE(operation_status, 'active') <> 'ignored'
  GROUP BY order_file_id
) bd ON bd.order_file_id = ofi.id
SET ofi.refund_amount = COALESCE(bd.refund_amount, 0.00);
