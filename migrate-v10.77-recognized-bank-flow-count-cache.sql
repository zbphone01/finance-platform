-- v10.77: 缓存日期汇总的已认账收入流水条数。
-- 支出流水不参与认账条数统计。

ALTER TABLE recognition_date_summaries
  ADD COLUMN recognized_bank_flow_count INT NOT NULL DEFAULT 0
  AFTER bank_flow_count;

UPDATE recognition_date_summaries rds
LEFT JOIN (
  SELECT
    rt.bill_date,
    SUM(CASE
      WHEN bf.income > 0 AND bf.recognition_status = 'recognized' THEN 1
      ELSE 0
    END) AS recognized_bank_flow_count
  FROM recognition_tasks rt
  LEFT JOIN bank_flows bf ON bf.task_id = rt.id
  GROUP BY rt.bill_date
) refreshed ON refreshed.bill_date = rds.bill_date
SET
  rds.recognized_bank_flow_count = COALESCE(refreshed.recognized_bank_flow_count, 0),
  rds.updated_at = NOW();
