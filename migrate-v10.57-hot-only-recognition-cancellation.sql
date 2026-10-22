-- v10.57: 取消认账只允许处理热区订单明细。
--
-- 1. match_results.has_archived_details 记录该入账结果是否已有订单明细进入月归档表；
-- 2. 回填现有月归档数据对应的入账结果；
-- 3. 每日归档完成后增量同步状态；
-- 4. 取消认账接口只读取该状态和热表，不再恢复归档订单明细。

ALTER TABLE match_results
  ADD COLUMN has_archived_details TINYINT(1) NOT NULL DEFAULT 0
  AFTER order_detail_count_snapshot;

ALTER TABLE bill_detail_archive_runs
  ADD COLUMN recognition_status_synced_at TIMESTAMP NULL DEFAULT NULL
  AFTER completed_at;

DROP PROCEDURE IF EXISTS sync_archived_match_result_statuses;

DELIMITER //
CREATE PROCEDURE sync_archived_match_result_statuses()
sync_statuses: BEGIN
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
        recognition_status_synced_at IS NULL
        OR recognition_status_synced_at < completed_at
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

    SET @sync_archive_date = archive_date_value;
    SET @sync_archived_match_results_sql = CONCAT(
      'UPDATE match_results mr ',
      'INNER JOIN (',
      'SELECT DISTINCT archived_detail.match_result_id ',
      'FROM `',
      REPLACE(archive_table_value, '`', '``'),
      '` archived_detail ',
      'WHERE archived_detail.partition_date = ? ',
      'AND archived_detail.match_result_id IS NOT NULL',
      ') archived_result ON archived_result.match_result_id = mr.id ',
      'SET mr.has_archived_details = 1'
    );
    PREPARE sync_archived_match_results_stmt FROM @sync_archived_match_results_sql;
    EXECUTE sync_archived_match_results_stmt USING @sync_archive_date;
    DEALLOCATE PREPARE sync_archived_match_results_stmt;

    UPDATE bill_detail_archive_runs
    SET recognition_status_synced_at = NOW()
    WHERE id = run_id_value
      AND completed_at = archive_completed_at_value;
  END LOOP;
  CLOSE run_cursor;

  SET @sync_archive_date = NULL;
  SET @sync_archived_match_results_sql = NULL;
END//
DELIMITER ;

-- 首次执行时回填全部已完成归档批次。
CALL sync_archived_match_result_statuses();

-- 保留 v10.42 的数据盘采集行为，并在归档返回后同步入账结果归档状态。
DROP PROCEDURE IF EXISTS archive_bill_details_daily_with_storage_request;

DELIMITER //
CREATE PROCEDURE archive_bill_details_daily_with_storage_request()
BEGIN
  CALL archive_bill_details_daily();
  CALL sync_archived_match_result_statuses();

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

SET @sync_archive_date = NULL;
SET @sync_archived_match_results_sql = NULL;

SELECT
  SUM(has_archived_details = 1) AS archived_match_result_count,
  SUM(has_archived_details = 0) AS hot_match_result_count
FROM match_results;

SELECT
  archive_date,
  archive_table,
  status,
  completed_at,
  recognition_status_synced_at
FROM bill_detail_archive_runs
ORDER BY archive_date DESC
LIMIT 20;
