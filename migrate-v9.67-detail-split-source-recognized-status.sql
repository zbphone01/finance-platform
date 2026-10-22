-- v9.67: 已拆分来源订单行同步分账子明细认账结果，用于日期汇总列表显示已认账并保留原订单号

UPDATE bill_details source_detail
JOIN (
  SELECT split_source_detail_id, MIN(match_result_id) AS match_result_id
  FROM bill_details
  WHERE split_source_detail_id IS NOT NULL
    AND match_result_id IS NOT NULL
  GROUP BY split_source_detail_id
) recognized_split ON recognized_split.split_source_detail_id = source_detail.id
SET source_detail.match_result_id = recognized_split.match_result_id
WHERE source_detail.operation_status = 'ignored'
  AND source_detail.ignore_reason LIKE '已按明细分账拆分认账%'
  AND source_detail.match_result_id IS NULL;
