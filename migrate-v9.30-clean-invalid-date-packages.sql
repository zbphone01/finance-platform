-- v9.30: 清理订单明细尾部汇总行误生成的非日期任务和明细数据包
-- 执行前请先备份数据库。
-- 只清理 bill_date 不是 YYYY-MM-DD 的记录；正常日期数据不受影响。

START TRANSACTION;

DELETE mr
FROM match_results mr
JOIN recognition_tasks rt ON rt.id = mr.task_id
WHERE rt.bill_date NOT REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  AND COALESCE(mr.voucher_status, 'pending') <> 'created';

DELETE ofi
FROM order_files ofi
JOIN bill_details bd ON bd.order_file_id = ofi.id
WHERE bd.bill_date NOT REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';

DELETE FROM bill_details
WHERE bill_date NOT REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$';

DELETE FROM recognition_tasks
WHERE bill_date NOT REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  AND COALESCE(bank_flow_count, 0) = 0;

COMMIT;
