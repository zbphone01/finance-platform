-- v9.39: 加速认账日期汇总筛选排序、银行流水按日期汇总任务分页加载
CREATE INDEX rds_status_bill_date_idx ON recognition_date_summaries (status, bill_date);
CREATE INDEX bf_task_id_idx ON bank_flows (task_id, id);
