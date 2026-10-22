-- v9.40: 日期汇总差异金额改为当日差异跳过任务的差额合计
UPDATE recognition_date_summaries rds
LEFT JOIN (
  SELECT
    bill_date,
    COALESCE(SUM(CASE
      WHEN status = 'large_variance' THEN CAST(diff_amount AS DECIMAL(18, 2))
      ELSE 0
    END), 0.00) AS skipped_variance_diff_amount
  FROM recognition_tasks
  GROUP BY bill_date
) task_variance ON task_variance.bill_date = rds.bill_date
SET rds.diff_amount = COALESCE(task_variance.skipped_variance_diff_amount, 0.00);
