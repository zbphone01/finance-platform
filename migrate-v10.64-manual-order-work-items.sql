-- v10.64: 人工处理订单改用独立稀疏表，并支持归档明细快捷恢复后继续操作。
--
-- 表与索引：
--   1 张 manual_order_work_items；
--   4 个索引（主键 1 个 + 二级索引 3 个）。
--
-- 同步策略：
--   1. 首次执行回填热表和现有月归档表中的人工处理订单；
--   2. 在线写入由应用按 detail_id 同步；
--   3. 每日归档完成后，仅以 manual_order_work_items 的稀疏主键集合连接当日归档分区，
--      更新实际发生冷热位置变化的明细，不再扫描和复制全部订单明细。

CREATE TABLE IF NOT EXISTS manual_order_work_items (
  detail_id BIGINT UNSIGNED NOT NULL,
  task_id BIGINT UNSIGNED NOT NULL,
  original_task_id BIGINT UNSIGNED NULL,
  order_file_id BIGINT UNSIGNED NULL,
  rule_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
  summary_date DATE NOT NULL,
  partition_date DATE NOT NULL,
  bill_date DATE NOT NULL,
  upload_date VARCHAR(20) NULL,
  bill_no VARCHAR(100) NULL,
  rule_name VARCHAR(200) NOT NULL DEFAULT '',
  description VARCHAR(500) NOT NULL,
  total_amount DECIMAL(18,2) NOT NULL,
  detail_package_type ENUM('T+1', '打包明细') NOT NULL DEFAULT 'T+1',
  operation_status ENUM('ignored', 'transferred') NOT NULL,
  display_status ENUM('ignored', 'transferred', 'transferred_recognized') NOT NULL,
  match_result_id BIGINT UNSIGNED NULL,
  operation_reason VARCHAR(500) NULL,
  storage_location ENUM('hot', 'archive') NOT NULL DEFAULT 'hot',
  archive_table VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (detail_id),
  KEY mowi_summary_date_idx (summary_date, detail_id),
  KEY mowi_status_date_idx (display_status, summary_date, detail_id),
  KEY mowi_rule_status_date_idx (rule_id, display_status, summary_date, detail_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE bill_detail_archive_runs
  ADD COLUMN manual_work_items_synced_at TIMESTAMP NULL DEFAULT NULL
  AFTER recognition_status_synced_at;

DROP PROCEDURE IF EXISTS backfill_archived_manual_order_work_items_v1064;

DELIMITER //
CREATE PROCEDURE backfill_archived_manual_order_work_items_v1064()
backfill_archive: BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE run_id_value BIGINT UNSIGNED;
  DECLARE archive_date_value DATE;
  DECLARE archive_table_value VARCHAR(64);
  DECLARE archive_table_count INT DEFAULT 0;
  DECLARE error_text VARCHAR(1000);

  DECLARE run_cursor CURSOR FOR
    SELECT id, archive_date, archive_table
    FROM bill_detail_archive_runs
    WHERE status = 'completed'
    ORDER BY archive_date, id;

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  OPEN run_cursor;
  run_loop: LOOP
    FETCH run_cursor INTO run_id_value, archive_date_value, archive_table_value;
    IF done = 1 THEN
      LEAVE run_loop;
    END IF;

    IF archive_table_value IS NULL
       OR archive_table_value NOT REGEXP '^bill_details_archive_[0-9]{6}$' THEN
      SET error_text = CONCAT(
        'invalid bill detail archive table in run ',
        run_id_value,
        ': ',
        COALESCE(archive_table_value, 'NULL')
      );
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_text;
    END IF;

    SELECT COUNT(*)
      INTO archive_table_count
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = archive_table_value;

    IF archive_table_count <> 1 THEN
      SET error_text = CONCAT(
        'bill detail archive table is missing for run ',
        run_id_value,
        ': ',
        archive_table_value
      );
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_text;
    END IF;

    SET @manual_archive_date = archive_date_value;
    SET @manual_archive_table = archive_table_value;
    SET @backfill_manual_work_items_sql = CONCAT(
      'INSERT INTO manual_order_work_items (',
      'detail_id, task_id, original_task_id, order_file_id, rule_id, ',
      'summary_date, partition_date, bill_date, upload_date, bill_no, ',
      'rule_name, description, total_amount, detail_package_type, ',
      'operation_status, display_status, match_result_id, operation_reason, ',
      'storage_location, archive_table, created_at, updated_at',
      ') ',
      'SELECT ',
      'bd.id, bd.task_id, bd.original_task_id, bd.order_file_id, ',
      'COALESCE(bd.rule_id, ofl.rule_id, rt.rule_id, 0), ',
      'COALESCE(rt.bill_date, bd.partition_date), bd.partition_date, bd.bill_date, ',
      'ofl.upload_date, bd.bill_no, COALESCE(rr.rule_name, ''''), bd.description, ',
      'bd.total_amount, COALESCE(ofl.detail_package_type, ''T+1''), ',
      'bd.operation_status, ',
      'CASE ',
      'WHEN bd.operation_status = ''transferred'' AND bd.match_result_id IS NOT NULL ',
      'THEN ''transferred_recognized'' ',
      'WHEN bd.operation_status = ''transferred'' THEN ''transferred'' ',
      'ELSE ''ignored'' END, ',
      'bd.match_result_id, bd.ignore_reason, ''archive'', ?, NOW(), NOW() ',
      'FROM `',
      REPLACE(archive_table_value, '`', '``'),
      '` bd ',
      'LEFT JOIN order_files ofl ON ofl.id = bd.order_file_id ',
      'LEFT JOIN recognition_tasks rt ON rt.id = bd.task_id ',
      'LEFT JOIN recognition_rules rr ',
      'ON rr.id = COALESCE(bd.rule_id, ofl.rule_id, rt.rule_id) ',
      'WHERE bd.partition_date = ? ',
      'AND bd.detail_split_file_id IS NULL ',
      'AND (',
      '(bd.operation_status = ''ignored'' AND bd.match_result_id IS NULL ',
      'AND COALESCE(bd.ignore_reason, '''') NOT LIKE ''已拆分%'' ',
      'AND COALESCE(bd.ignore_reason, '''') NOT LIKE ''已按明细分账拆分认账%'') ',
      'OR bd.operation_status = ''transferred''',
      ') ',
      'ON DUPLICATE KEY UPDATE ',
      'task_id = VALUES(task_id), ',
      'original_task_id = VALUES(original_task_id), ',
      'order_file_id = VALUES(order_file_id), ',
      'rule_id = VALUES(rule_id), ',
      'summary_date = VALUES(summary_date), ',
      'partition_date = VALUES(partition_date), ',
      'bill_date = VALUES(bill_date), ',
      'upload_date = VALUES(upload_date), ',
      'bill_no = VALUES(bill_no), ',
      'rule_name = VALUES(rule_name), ',
      'description = VALUES(description), ',
      'total_amount = VALUES(total_amount), ',
      'detail_package_type = VALUES(detail_package_type), ',
      'operation_status = VALUES(operation_status), ',
      'display_status = VALUES(display_status), ',
      'match_result_id = VALUES(match_result_id), ',
      'operation_reason = VALUES(operation_reason), ',
      'storage_location = VALUES(storage_location), ',
      'archive_table = VALUES(archive_table), ',
      'updated_at = NOW()'
    );
    PREPARE backfill_manual_work_items_stmt FROM @backfill_manual_work_items_sql;
    EXECUTE backfill_manual_work_items_stmt USING @manual_archive_table, @manual_archive_date;
    DEALLOCATE PREPARE backfill_manual_work_items_stmt;

    UPDATE bill_detail_archive_runs
    SET manual_work_items_synced_at = NOW()
    WHERE id = run_id_value;
  END LOOP;
  CLOSE run_cursor;
END//
DELIMITER ;

-- 首次回填现有归档数据。归档表按 operation_status 索引和单日分区读取。
CALL backfill_archived_manual_order_work_items_v1064();
DROP PROCEDURE IF EXISTS backfill_archived_manual_order_work_items_v1064;

-- 首次回填当前热区；若极端情况下主键重复，以热区位置为准。
INSERT INTO manual_order_work_items (
  detail_id,
  task_id,
  original_task_id,
  order_file_id,
  rule_id,
  summary_date,
  partition_date,
  bill_date,
  upload_date,
  bill_no,
  rule_name,
  description,
  total_amount,
  detail_package_type,
  operation_status,
  display_status,
  match_result_id,
  operation_reason,
  storage_location,
  archive_table,
  created_at,
  updated_at
)
SELECT
  bd.id,
  bd.task_id,
  bd.original_task_id,
  bd.order_file_id,
  COALESCE(bd.rule_id, ofl.rule_id, rt.rule_id, 0),
  COALESCE(rt.bill_date, bd.partition_date),
  bd.partition_date,
  bd.bill_date,
  ofl.upload_date,
  bd.bill_no,
  COALESCE(rr.rule_name, ''),
  bd.description,
  bd.total_amount,
  COALESCE(ofl.detail_package_type, 'T+1'),
  bd.operation_status,
  CASE
    WHEN bd.operation_status = 'transferred' AND bd.match_result_id IS NOT NULL
      THEN 'transferred_recognized'
    WHEN bd.operation_status = 'transferred'
      THEN 'transferred'
    ELSE 'ignored'
  END,
  bd.match_result_id,
  bd.ignore_reason,
  'hot',
  NULL,
  NOW(),
  NOW()
FROM bill_details bd
LEFT JOIN order_files ofl ON ofl.id = bd.order_file_id
LEFT JOIN recognition_tasks rt ON rt.id = bd.task_id
LEFT JOIN recognition_rules rr
  ON rr.id = COALESCE(bd.rule_id, ofl.rule_id, rt.rule_id)
WHERE bd.detail_split_file_id IS NULL
  AND (
    (
      bd.operation_status = 'ignored'
      AND bd.match_result_id IS NULL
      AND COALESCE(bd.ignore_reason, '') NOT LIKE '已拆分%'
      AND COALESCE(bd.ignore_reason, '') NOT LIKE '已按明细分账拆分认账%'
    )
    OR bd.operation_status = 'transferred'
  )
ON DUPLICATE KEY UPDATE
  task_id = VALUES(task_id),
  original_task_id = VALUES(original_task_id),
  order_file_id = VALUES(order_file_id),
  rule_id = VALUES(rule_id),
  summary_date = VALUES(summary_date),
  partition_date = VALUES(partition_date),
  bill_date = VALUES(bill_date),
  upload_date = VALUES(upload_date),
  bill_no = VALUES(bill_no),
  rule_name = VALUES(rule_name),
  description = VALUES(description),
  total_amount = VALUES(total_amount),
  detail_package_type = VALUES(detail_package_type),
  operation_status = VALUES(operation_status),
  display_status = VALUES(display_status),
  match_result_id = VALUES(match_result_id),
  operation_reason = VALUES(operation_reason),
  storage_location = 'hot',
  archive_table = NULL,
  updated_at = NOW();

DROP PROCEDURE IF EXISTS sync_archived_manual_order_work_items;

DELIMITER //
CREATE PROCEDURE sync_archived_manual_order_work_items()
sync_work_items: BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE run_id_value BIGINT UNSIGNED;
  DECLARE archive_date_value DATE;
  DECLARE archive_table_value VARCHAR(64);
  DECLARE archive_completed_at_value TIMESTAMP;
  DECLARE archive_table_count INT DEFAULT 0;
  DECLARE error_text VARCHAR(1000);

  DECLARE run_cursor CURSOR FOR
    SELECT id, archive_date, archive_table, completed_at
    FROM bill_detail_archive_runs
    WHERE status = 'completed'
      AND completed_at IS NOT NULL
      AND (
        manual_work_items_synced_at IS NULL
        OR manual_work_items_synced_at < completed_at
      )
    ORDER BY archive_date, id;

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  OPEN run_cursor;
  run_loop: LOOP
    FETCH run_cursor
      INTO run_id_value, archive_date_value, archive_table_value, archive_completed_at_value;
    IF done = 1 THEN
      LEAVE run_loop;
    END IF;

    IF archive_table_value IS NULL
       OR archive_table_value NOT REGEXP '^bill_details_archive_[0-9]{6}$' THEN
      SET error_text = CONCAT(
        'invalid bill detail archive table in run ',
        run_id_value,
        ': ',
        COALESCE(archive_table_value, 'NULL')
      );
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_text;
    END IF;

    SELECT COUNT(*)
      INTO archive_table_count
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = archive_table_value;

    IF archive_table_count <> 1 THEN
      SET error_text = CONCAT(
        'bill detail archive table is missing for run ',
        run_id_value,
        ': ',
        archive_table_value
      );
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_text;
    END IF;

    SET @manual_archive_date = archive_date_value;
    SET @manual_archive_table = archive_table_value;
    SET @sync_manual_work_items_sql = CONCAT(
      'UPDATE manual_order_work_items work_item ',
      'INNER JOIN `',
      REPLACE(archive_table_value, '`', '``'),
      '` bd ON bd.id = work_item.detail_id ',
      'AND bd.partition_date = work_item.partition_date ',
      'LEFT JOIN order_files ofl ON ofl.id = bd.order_file_id ',
      'LEFT JOIN recognition_tasks rt ON rt.id = bd.task_id ',
      'LEFT JOIN recognition_rules rr ',
      'ON rr.id = COALESCE(bd.rule_id, ofl.rule_id, rt.rule_id) ',
      'SET ',
      'work_item.task_id = bd.task_id, ',
      'work_item.original_task_id = bd.original_task_id, ',
      'work_item.order_file_id = bd.order_file_id, ',
      'work_item.rule_id = COALESCE(bd.rule_id, ofl.rule_id, rt.rule_id, 0), ',
      'work_item.summary_date = COALESCE(rt.bill_date, bd.partition_date), ',
      'work_item.partition_date = bd.partition_date, ',
      'work_item.bill_date = bd.bill_date, ',
      'work_item.upload_date = ofl.upload_date, ',
      'work_item.bill_no = bd.bill_no, ',
      'work_item.rule_name = COALESCE(rr.rule_name, ''''), ',
      'work_item.description = bd.description, ',
      'work_item.total_amount = bd.total_amount, ',
      'work_item.detail_package_type = COALESCE(ofl.detail_package_type, ''T+1''), ',
      'work_item.operation_status = bd.operation_status, ',
      'work_item.display_status = CASE ',
      'WHEN bd.operation_status = ''transferred'' AND bd.match_result_id IS NOT NULL ',
      'THEN ''transferred_recognized'' ',
      'WHEN bd.operation_status = ''transferred'' THEN ''transferred'' ',
      'ELSE ''ignored'' END, ',
      'work_item.match_result_id = bd.match_result_id, ',
      'work_item.operation_reason = bd.ignore_reason, ',
      'work_item.storage_location = ''archive'', ',
      'work_item.archive_table = ?, ',
      'work_item.updated_at = NOW() ',
      'WHERE work_item.storage_location = ''hot'' ',
      'AND bd.partition_date = ?'
    );
    PREPARE sync_manual_work_items_stmt FROM @sync_manual_work_items_sql;
    EXECUTE sync_manual_work_items_stmt USING @manual_archive_table, @manual_archive_date;
    DEALLOCATE PREPARE sync_manual_work_items_stmt;

    UPDATE bill_detail_archive_runs
    SET manual_work_items_synced_at = NOW()
    WHERE id = run_id_value
      AND completed_at = archive_completed_at_value;
  END LOOP;
  CLOSE run_cursor;
END//
DELIMITER ;

-- 保留已有的归档状态同步与磁盘采集行为，再追加人工处理订单的稀疏位置同步。
DROP PROCEDURE IF EXISTS archive_bill_details_daily_with_storage_request;

DELIMITER //
CREATE PROCEDURE archive_bill_details_daily_with_storage_request()
BEGIN
  CALL archive_bill_details_daily();
  CALL sync_archived_match_result_statuses();
  CALL sync_archived_manual_order_work_items();

  INSERT INTO system_storage_snapshot (
    id,
    request_date,
    requested_archive_date,
    status,
    requested_at,
    error_message,
    updated_at
  )
  VALUES (
    1,
    CURDATE(),
    DATE_SUB(CURDATE(), INTERVAL 60 DAY),
    'pending',
    NOW(),
    NULL,
    NOW()
  )
  ON DUPLICATE KEY UPDATE
    request_date = VALUES(request_date),
    requested_archive_date = VALUES(requested_archive_date),
    status = 'pending',
    requested_at = NOW(),
    error_message = NULL,
    updated_at = NOW();
END//
DELIMITER ;

SET @manual_archive_date = NULL;
SET @manual_archive_table = NULL;
SET @backfill_manual_work_items_sql = NULL;
SET @sync_manual_work_items_sql = NULL;

SELECT
  COUNT(*) AS manual_order_count,
  SUM(display_status = 'ignored') AS ignored_count,
  SUM(display_status = 'transferred') AS transferred_count,
  SUM(display_status = 'transferred_recognized') AS transferred_recognized_count,
  SUM(storage_location = 'archive') AS archived_count
FROM manual_order_work_items;

SELECT
  archive_date,
  archive_table,
  status,
  completed_at,
  manual_work_items_synced_at
FROM bill_detail_archive_runs
ORDER BY archive_date DESC
LIMIT 20;
