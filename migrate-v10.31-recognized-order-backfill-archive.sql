-- v10.31: 仅归档已认账订单明细，并每日补归档 60 天前后来完成认账的历史明细。
--
-- 关键原则：
-- 1. match_result_id IS NULL 的未认账明细继续留在 bill_details 热表。
-- 2. 补归档按 bill_details 的复合主键直接搬迁，不对归档表再次执行订单号或整包滤重。
-- 3. 每 50000 行一个事务；复制、运行快照更新和热表删除在同一事务内完成。
-- 4. 每日先处理刚满 60 天的日期，再补处理一个更早且仍有已认账热表行的日期。

DROP EVENT IF EXISTS ev_bill_details_archive_old_daily_partitions;
DROP PROCEDURE IF EXISTS archive_bill_details_daily;
DROP PROCEDURE IF EXISTS archive_bill_details_day;

DELIMITER //
CREATE PROCEDURE archive_bill_details_day(IN target_date DATE)
archive_day: BEGIN
  DECLARE archive_table_name VARCHAR(64);
  DECLARE source_partition_name VARCHAR(32);
  DECLARE existing_partition_count INT DEFAULT 0;
  DECLARE running_task_count BIGINT UNSIGNED DEFAULT 0;
  DECLARE lock_name VARCHAR(128);
  DECLARE lock_acquired INT DEFAULT 0;
  DECLARE had_completed_run INT DEFAULT 0;
  DECLARE archived_any_batch INT DEFAULT 0;
  DECLARE archive_count_value BIGINT UNSIGNED DEFAULT 0;
  DECLARE archive_total_value DECIMAL(20,2) DEFAULT 0.00;
  DECLARE batch_count_value BIGINT UNSIGNED DEFAULT 0;
  DECLARE batch_insert_count BIGINT UNSIGNED DEFAULT 0;
  DECLARE batch_delete_count BIGINT UNSIGNED DEFAULT 0;
  DECLARE batch_total_value DECIMAL(20,2) DEFAULT 0.00;
  DECLARE error_text VARCHAR(1000);

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    GET DIAGNOSTICS CONDITION 1 error_text = MESSAGE_TEXT;
    ROLLBACK;
    DROP TEMPORARY TABLE IF EXISTS tmp_bill_detail_archive_ids;
    UPDATE bill_detail_archive_runs
    SET
      status = IF(had_completed_run = 1 OR archived_any_batch = 1, 'completed', 'failed'),
      error_message = error_text,
      completed_at = NOW()
    WHERE archive_date = target_date;
    IF lock_acquired = 1 THEN
      DO RELEASE_LOCK(lock_name);
    END IF;
    RESIGNAL;
  END;

  IF target_date IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'archive target date is required';
  END IF;

  IF target_date > DATE_SUB(CURDATE(), INTERVAL 60 DAY) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'archive target date must be at least 60 days old';
  END IF;

  SET archive_table_name = CONCAT('bill_details_archive_', DATE_FORMAT(target_date, '%Y%m'));
  SET source_partition_name = CONCAT('p', DATE_FORMAT(target_date, '%Y%m%d'));
  SET lock_name = CONCAT(DATABASE(), ':bill_details_archive:', DATE_FORMAT(target_date, '%Y-%m-%d'));

  SELECT COUNT(*)
    INTO had_completed_run
  FROM bill_detail_archive_runs
  WHERE archive_date = target_date
    AND status = 'completed';

  SELECT GET_LOCK(lock_name, 0) INTO lock_acquired;
  IF lock_acquired <> 1 THEN
    INSERT INTO bill_detail_archive_runs (
      archive_date,
      archive_table,
      partition_name,
      status,
      error_message,
      started_at,
      completed_at
    )
    VALUES (
      target_date,
      archive_table_name,
      source_partition_name,
      'skipped',
      'archive lock is held by another session',
      NOW(),
      NOW()
    )
    ON DUPLICATE KEY UPDATE
      status = IF(bill_detail_archive_runs.status = 'completed', 'completed', 'skipped'),
      error_message = VALUES(error_message),
      completed_at = NOW();
    LEAVE archive_day;
  END IF;

  CALL ensure_bill_details_archive_tables_around(target_date);

  SELECT COUNT(*)
    INTO existing_partition_count
  FROM information_schema.partitions
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_details'
    AND partition_name = source_partition_name;

  IF existing_partition_count = 0 THEN
    INSERT INTO bill_detail_archive_runs (
      archive_date,
      archive_table,
      partition_name,
      status,
      error_message,
      started_at,
      completed_at
    )
    VALUES (
      target_date,
      archive_table_name,
      source_partition_name,
      'skipped',
      'source partition not found',
      NOW(),
      NOW()
    )
    ON DUPLICATE KEY UPDATE
      status = IF(bill_detail_archive_runs.status = 'completed', 'completed', 'skipped'),
      error_message = VALUES(error_message),
      completed_at = NOW();
    DO RELEASE_LOCK(lock_name);
    SET lock_acquired = 0;
    LEAVE archive_day;
  END IF;

  SELECT COUNT(*)
    INTO running_task_count
  FROM recognition_tasks
  WHERE bill_date = target_date
    AND status = 'processing';

  SET @running_partition_task_count = 0;
  SET @running_partition_task_sql = CONCAT(
    'SELECT EXISTS(',
    'SELECT 1 FROM bill_details PARTITION (`',
    source_partition_name,
    '`) bd INNER JOIN recognition_tasks rt ON rt.id = bd.task_id ',
    'WHERE bd.partition_date = ? AND rt.status = ''processing'' LIMIT 1',
    ') INTO @running_partition_task_count'
  );
  PREPARE running_partition_task_stmt FROM @running_partition_task_sql;
  SET @archive_target_date = target_date;
  EXECUTE running_partition_task_stmt USING @archive_target_date;
  DEALLOCATE PREPARE running_partition_task_stmt;
  SET running_task_count = running_task_count + COALESCE(@running_partition_task_count, 0);

  IF running_task_count > 0 THEN
    INSERT INTO bill_detail_archive_runs (
      archive_date,
      archive_table,
      partition_name,
      status,
      error_message,
      started_at,
      completed_at
    )
    VALUES (
      target_date,
      archive_table_name,
      source_partition_name,
      'skipped',
      'recognition task is still processing',
      NOW(),
      NOW()
    )
    ON DUPLICATE KEY UPDATE
      status = IF(bill_detail_archive_runs.status = 'completed', 'completed', 'skipped'),
      error_message = VALUES(error_message),
      completed_at = NOW();
    DO RELEASE_LOCK(lock_name);
    SET lock_acquired = 0;
    LEAVE archive_day;
  END IF;

  SET @archive_summary_sql = CONCAT(
    'SELECT COUNT(*), COALESCE(SUM(CAST(total_amount AS DECIMAL(18,2))), 0.00) ',
    'INTO @archive_count_value, @archive_total_value ',
    'FROM `',
    archive_table_name,
    '` WHERE partition_date = ?'
  );
  PREPARE archive_summary_stmt FROM @archive_summary_sql;
  EXECUTE archive_summary_stmt USING @archive_target_date;
  DEALLOCATE PREPARE archive_summary_stmt;
  SET archive_count_value = COALESCE(@archive_count_value, 0);
  SET archive_total_value = COALESCE(@archive_total_value, 0.00);

  INSERT INTO bill_detail_archive_runs (
    archive_date,
    archive_table,
    partition_name,
    status,
    source_count,
    archive_count,
    source_total,
    archive_total,
    error_message,
    started_at,
    completed_at
  )
  VALUES (
    target_date,
    archive_table_name,
    source_partition_name,
    IF(archive_count_value > 0 OR had_completed_run = 1, 'completed', 'running'),
    archive_count_value,
    archive_count_value,
    archive_total_value,
    archive_total_value,
    NULL,
    NOW(),
    IF(archive_count_value > 0 OR had_completed_run = 1, NOW(), NULL)
  )
  ON DUPLICATE KEY UPDATE
    archive_table = VALUES(archive_table),
    partition_name = VALUES(partition_name),
    status = VALUES(status),
    source_count = VALUES(source_count),
    archive_count = VALUES(archive_count),
    source_total = VALUES(source_total),
    archive_total = VALUES(archive_total),
    error_message = NULL,
    started_at = NOW(),
    completed_at = VALUES(completed_at);

  CREATE TEMPORARY TABLE IF NOT EXISTS tmp_bill_detail_archive_ids (
    id BIGINT UNSIGNED NOT NULL,
    partition_date DATE NOT NULL,
    PRIMARY KEY (id, partition_date)
  ) ENGINE=InnoDB;

  archive_batch_loop: LOOP
    START TRANSACTION;
    DELETE FROM tmp_bill_detail_archive_ids;

    SET @select_archive_batch_sql = CONCAT(
      'INSERT INTO tmp_bill_detail_archive_ids (id, partition_date) ',
      'SELECT id, partition_date FROM bill_details PARTITION (`',
      source_partition_name,
      '`) WHERE partition_date = ? AND match_result_id IS NOT NULL ',
      'LIMIT 50000 FOR UPDATE'
    );
    PREPARE select_archive_batch_stmt FROM @select_archive_batch_sql;
    EXECUTE select_archive_batch_stmt USING @archive_target_date;
    SET batch_count_value = ROW_COUNT();
    DEALLOCATE PREPARE select_archive_batch_stmt;

    IF batch_count_value = 0 THEN
      COMMIT;
      LEAVE archive_batch_loop;
    END IF;

    SET @archive_batch_summary_sql = CONCAT(
      'SELECT COUNT(*), COALESCE(SUM(CAST(bd.total_amount AS DECIMAL(18,2))), 0.00) ',
      'INTO @archive_batch_count_value, @archive_batch_total_value ',
      'FROM bill_details PARTITION (`',
      source_partition_name,
      '`) bd INNER JOIN tmp_bill_detail_archive_ids selected ',
      'ON selected.id = bd.id AND selected.partition_date = bd.partition_date'
    );
    PREPARE archive_batch_summary_stmt FROM @archive_batch_summary_sql;
    EXECUTE archive_batch_summary_stmt;
    DEALLOCATE PREPARE archive_batch_summary_stmt;
    SET batch_count_value = COALESCE(@archive_batch_count_value, 0);
    SET batch_total_value = COALESCE(@archive_batch_total_value, 0.00);

    SET @insert_archive_batch_sql = CONCAT(
      'INSERT INTO `',
      archive_table_name,
      '` SELECT bd.* FROM bill_details PARTITION (`',
      source_partition_name,
      '`) bd INNER JOIN tmp_bill_detail_archive_ids selected ',
      'ON selected.id = bd.id AND selected.partition_date = bd.partition_date'
    );
    PREPARE insert_archive_batch_stmt FROM @insert_archive_batch_sql;
    EXECUTE insert_archive_batch_stmt;
    SET batch_insert_count = ROW_COUNT();
    DEALLOCATE PREPARE insert_archive_batch_stmt;

    IF batch_insert_count <> batch_count_value THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'archive batch insert verification failed';
    END IF;

    SET @delete_archive_batch_sql = CONCAT(
      'DELETE bd FROM bill_details PARTITION (`',
      source_partition_name,
      '`) bd INNER JOIN tmp_bill_detail_archive_ids selected ',
      'ON selected.id = bd.id AND selected.partition_date = bd.partition_date'
    );
    PREPARE delete_archive_batch_stmt FROM @delete_archive_batch_sql;
    EXECUTE delete_archive_batch_stmt;
    SET batch_delete_count = ROW_COUNT();
    DEALLOCATE PREPARE delete_archive_batch_stmt;

    IF batch_delete_count <> batch_count_value THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'archive batch delete verification failed';
    END IF;

    UPDATE bill_detail_archive_runs
    SET
      status = 'completed',
      source_count = archive_count_value + batch_count_value,
      archive_count = archive_count_value + batch_count_value,
      source_total = archive_total_value + batch_total_value,
      archive_total = archive_total_value + batch_total_value,
      error_message = NULL,
      completed_at = NOW()
    WHERE archive_date = target_date;

    COMMIT;
    SET archived_any_batch = 1;
    SET had_completed_run = 1;
    SET archive_count_value = archive_count_value + batch_count_value;
    SET archive_total_value = archive_total_value + batch_total_value;
  END LOOP;

  DROP TEMPORARY TABLE IF EXISTS tmp_bill_detail_archive_ids;

  UPDATE bill_detail_archive_runs
  SET
    status = 'completed',
    source_count = archive_count_value,
    archive_count = archive_count_value,
    source_total = archive_total_value,
    archive_total = archive_total_value,
    error_message = NULL,
    completed_at = NOW()
  WHERE archive_date = target_date;

  DO RELEASE_LOCK(lock_name);
  SET lock_acquired = 0;
END//

CREATE PROCEDURE archive_bill_details_daily()
archive_daily: BEGIN
  DECLARE cutoff_date DATE;
  DECLARE candidate_partition_name VARCHAR(64);
  DECLARE candidate_date DATE;
  DECLARE done INT DEFAULT 0;

  DECLARE historical_partition_cursor CURSOR FOR
    SELECT
      partition_name,
      STR_TO_DATE(SUBSTRING(partition_name, 2), '%Y%m%d') AS partition_date
    FROM information_schema.partitions
    WHERE table_schema = DATABASE()
      AND table_name = 'bill_details'
      AND partition_name REGEXP '^p[0-9]{8}$'
      AND STR_TO_DATE(SUBSTRING(partition_name, 2), '%Y%m%d') < DATE_SUB(CURDATE(), INTERVAL 60 DAY)
    ORDER BY partition_date;

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  SET cutoff_date = DATE_SUB(CURDATE(), INTERVAL 60 DAY);
  CALL archive_bill_details_day(cutoff_date);

  OPEN historical_partition_cursor;
  historical_scan_loop: LOOP
    FETCH historical_partition_cursor INTO candidate_partition_name, candidate_date;
    IF done = 1 THEN
      LEAVE historical_scan_loop;
    END IF;

    SET @historical_recognized_exists = 0;
    SET @historical_candidate_sql = CONCAT(
      'SELECT EXISTS(',
      'SELECT 1 FROM bill_details PARTITION (`',
      candidate_partition_name,
      '`) WHERE partition_date = ? AND match_result_id IS NOT NULL LIMIT 1',
      ') INTO @historical_recognized_exists'
    );
    PREPARE historical_candidate_stmt FROM @historical_candidate_sql;
    SET @historical_candidate_date = candidate_date;
    EXECUTE historical_candidate_stmt USING @historical_candidate_date;
    DEALLOCATE PREPARE historical_candidate_stmt;

    IF COALESCE(@historical_recognized_exists, 0) = 1 THEN
      CALL archive_bill_details_day(candidate_date);
      LEAVE historical_scan_loop;
    END IF;
  END LOOP;
  CLOSE historical_partition_cursor;
END//
DELIMITER ;

CALL ensure_bill_details_archive_tables_around(DATE_SUB(CURDATE(), INTERVAL 60 DAY));

SET @this_day_archive_event_at = STR_TO_DATE(
  CONCAT(DATE_FORMAT(CURDATE(), '%Y-%m-%d'), ' 03:10:00'),
  '%Y-%m-%d %H:%i:%s'
);
SET @next_day_archive_event_at = IF(
  NOW() < @this_day_archive_event_at,
  @this_day_archive_event_at,
  DATE_ADD(@this_day_archive_event_at, INTERVAL 1 DAY)
);
SET @create_archive_event_sql = CONCAT(
  'CREATE EVENT ev_bill_details_archive_old_daily_partitions ',
  'ON SCHEDULE EVERY 1 DAY ',
  'STARTS ''',
  DATE_FORMAT(@next_day_archive_event_at, '%Y-%m-%d %H:%i:%s'),
  ''' ',
  'ON COMPLETION PRESERVE ENABLE ',
  'DO CALL archive_bill_details_daily()'
);
PREPARE create_archive_event_stmt FROM @create_archive_event_sql;
EXECUTE create_archive_event_stmt;
DEALLOCATE PREPARE create_archive_event_stmt;

SET @this_day_archive_event_at = NULL;
SET @next_day_archive_event_at = NULL;
SET @create_archive_event_sql = NULL;
SET @archive_target_date = NULL;
SET @running_partition_task_count = NULL;
SET @running_partition_task_sql = NULL;
SET @archive_summary_sql = NULL;
SET @archive_count_value = NULL;
SET @archive_total_value = NULL;
SET @select_archive_batch_sql = NULL;
SET @archive_batch_summary_sql = NULL;
SET @archive_batch_count_value = NULL;
SET @archive_batch_total_value = NULL;
SET @insert_archive_batch_sql = NULL;
SET @delete_archive_batch_sql = NULL;
SET @historical_recognized_exists = NULL;
SET @historical_candidate_sql = NULL;
SET @historical_candidate_date = NULL;
