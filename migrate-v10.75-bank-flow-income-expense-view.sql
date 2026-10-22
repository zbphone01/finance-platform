-- v10.75: 日期汇总缓存银行流水收入总额；支出流水只读，不再参与认账状态。
-- 本迁移不删除或回滚历史支出认账结果和凭证。

ALTER TABLE recognition_date_summaries
  ADD COLUMN bank_flow_income_total DECIMAL(18,2) NOT NULL DEFAULT 0.00
  AFTER bank_flow_total;

DROP TEMPORARY TABLE IF EXISTS tmp_v1075_task_flow_direction;
CREATE TEMPORARY TABLE tmp_v1075_task_flow_direction (
  task_id BIGINT UNSIGNED NOT NULL,
  all_flow_count INT NOT NULL,
  income_flow_count INT NOT NULL,
  income_flow_total DECIMAL(18,2) NOT NULL,
  PRIMARY KEY (task_id)
) ENGINE=InnoDB;

INSERT INTO tmp_v1075_task_flow_direction (
  task_id,
  all_flow_count,
  income_flow_count,
  income_flow_total
)
SELECT
  bf.task_id,
  COUNT(*) AS all_flow_count,
  SUM(CASE WHEN bf.income > 0 THEN 1 ELSE 0 END) AS income_flow_count,
  COALESCE(SUM(CASE WHEN bf.income > 0 THEN bf.income ELSE 0 END), 0.00) AS income_flow_total
FROM bank_flows bf
GROUP BY bf.task_id;

-- 纯支出任务不再等待认账。已存在的历史部分认账、差异、失败或完成状态不强制改写。
UPDATE recognition_tasks rt
JOIN tmp_v1075_task_flow_direction tf ON tf.task_id = rt.id
SET
  rt.status = 'completed',
  rt.completed_at = COALESCE(rt.completed_at, NOW()),
  rt.updated_at = NOW()
WHERE tf.all_flow_count > 0
  AND tf.income_flow_count = 0
  AND rt.status = 'pending_details';

-- 回填收入总额，并按“收入参与认账、纯支出任务忽略”的口径重算日期状态。
UPDATE recognition_date_summaries rds
JOIN (
  SELECT
    rt.bill_date,
    COALESCE(SUM(tf.income_flow_total), 0.00) AS bank_flow_income_total,
    COALESCE(SUM(tf.income_flow_count), 0) AS bank_flow_count,
    CASE
      WHEN SUM(CASE
        WHEN (COALESCE(tf.all_flow_count, 0) = 0 OR COALESCE(tf.income_flow_count, 0) > 0)
          AND rt.status = 'processing' THEN 1 ELSE 0 END) > 0 THEN 'processing'
      WHEN SUM(CASE
        WHEN (COALESCE(tf.all_flow_count, 0) = 0 OR COALESCE(tf.income_flow_count, 0) > 0)
          AND rt.status = 'large_variance' THEN 1 ELSE 0 END) > 0 THEN 'large_variance'
      WHEN SUM(CASE
        WHEN (COALESCE(tf.all_flow_count, 0) = 0 OR COALESCE(tf.income_flow_count, 0) > 0)
          AND rt.status = 'failed' THEN 1 ELSE 0 END) > 0 THEN 'failed'
      WHEN SUM(CASE
        WHEN (COALESCE(tf.all_flow_count, 0) = 0 OR COALESCE(tf.income_flow_count, 0) > 0)
          AND rt.status = 'partial_matched' THEN 1 ELSE 0 END) > 0 THEN 'partial_matched'
      WHEN SUM(CASE
        WHEN COALESCE(tf.all_flow_count, 0) = 0 OR COALESCE(tf.income_flow_count, 0) > 0
          THEN 1 ELSE 0 END) = 0 THEN 'completed'
      WHEN SUM(CASE WHEN COALESCE(tf.income_flow_count, 0) > 0 THEN 1 ELSE 0 END) > 0
        AND SUM(CASE
          WHEN COALESCE(tf.income_flow_count, 0) > 0 AND rt.status = 'completed'
            THEN 1 ELSE 0 END)
          = SUM(CASE WHEN COALESCE(tf.income_flow_count, 0) > 0 THEN 1 ELSE 0 END)
        THEN 'completed'
      WHEN SUM(CASE
        WHEN (COALESCE(tf.all_flow_count, 0) = 0 OR COALESCE(tf.income_flow_count, 0) > 0)
          AND rt.status = 'completed' THEN 1 ELSE 0 END) > 0 THEN 'partial_matched'
      ELSE 'pending_recognition'
    END AS summary_status
  FROM recognition_tasks rt
  LEFT JOIN tmp_v1075_task_flow_direction tf ON tf.task_id = rt.id
  GROUP BY rt.bill_date
) refreshed ON refreshed.bill_date = rds.bill_date
SET
  rds.bank_flow_income_total = refreshed.bank_flow_income_total,
  rds.bank_flow_count = refreshed.bank_flow_count,
  rds.status = refreshed.summary_status,
  rds.updated_at = NOW();

DROP TEMPORARY TABLE IF EXISTS tmp_v1075_task_flow_direction;
