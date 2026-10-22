-- v9.36: 加速订单明细数据包列表按日期、规则、文件汇总展示
CREATE INDEX rt_date_rule_idx ON recognition_tasks (bill_date, rule_id);
CREATE INDEX of_task_rule_created_idx ON order_files (task_id, rule_id, created_at);
