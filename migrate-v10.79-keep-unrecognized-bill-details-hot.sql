-- v10.79: keep every unrecognized bill detail in the hot table and merge expired
-- daily partitions with retained rows into p_late. Only rows with a completed
-- recognition result are copied to monthly archive tables.
--
-- Historical unrecognized rows already in monthly archives are intentionally not
-- bulk-restored here; the existing single-detail restore path remains their fallback.

DROP PROCEDURE IF EXISTS archive_bill_details_daily;
DROP PROCEDURE IF EXISTS archive_bill_details_day;
DROP PROCEDURE IF EXISTS roll_bill_details_hot_window;

DELIMITER //

CREATE PROCEDURE archive_bill_details_day(IN target_date DATE)
archive_day: BEGIN
  DECLARE archive_table_name VARCHAR(64);
  DECLARE source_partition_name VARCHAR(64);
  DECLARE source_partition_count INT DEFAULT 0;
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

  IF target_date IS NULL OR target_date < '1970-01-02' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'archive target date is invalid';
  END IF;

  IF target_date > DATE_SUB(CURDATE(), INTERVAL 60 DAY) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'archive target date must be at least 60 days old';
  END IF;

  SET archive_table_name = CONCAT('bill_details_archive_', DATE_FORMAT(target_date, '%Y%m'));
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
      'unknown',
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

  SET source_partition_name = NULL;
  SELECT partition_name
    INTO source_partition_name
  FROM information_schema.partitions
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_details'
    AND partition_name IS NOT NULL
    AND partition_name <> 'p_unmatched'
    AND (
      partition_description = 'MAXVALUE'
      OR STR_TO_DATE(REPLACE(partition_description, '''', ''), '%Y-%m-%d') > target_date
    )
  ORDER BY partition_ordinal_position
  LIMIT 1;

  SELECT COUNT(*)
    INTO source_partition_count
  FROM information_schema.partitions
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_details'
    AND partition_name = source_partition_name;

  IF source_partition_name IS NULL OR source_partition_count = 0 THEN
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
      'unknown',
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
    REPLACE(source_partition_name, '`', '``'),
    '`) bd INNER JOIN recognition_tasks rt ON rt.id = bd.task_id ',
    'WHERE bd.partition_date = ? AND rt.status = ''processing'' LIMIT 1',
    ') INTO @running_partition_task_count'
  );
  PREPARE running_partition_task_stmt FROM @running_partition_task_sql;
  SET @archive_target_date = target_date;
  EXECUTE running_partition_task_stmt USING @archive_target_date;
  DEALLOCATE PREPARE running_partition_task_stmt;
  SET running_task_count = running_task_count + COALESCE(@running_partition_task_count, 0);

  SET @running_detail_split_count = 0;
  SET @running_detail_split_sql = CONCAT(
    'SELECT EXISTS(',
    'SELECT 1 FROM bill_details PARTITION (`',
    REPLACE(source_partition_name, '`', '``'),
    '`) bd INNER JOIN detail_split_files dsf ON dsf.id = bd.detail_split_file_id ',
    'WHERE bd.partition_date = ? ',
    'AND (dsf.upload_status = ''processing'' ',
    'OR dsf.recognition_phase IN (''finding_tasks'', ''recognizing'')) LIMIT 1',
    ') INTO @running_detail_split_count'
  );
  PREPARE running_detail_split_stmt FROM @running_detail_split_sql;
  EXECUTE running_detail_split_stmt USING @archive_target_date;
  DEALLOCATE PREPARE running_detail_split_stmt;
  SET running_task_count = running_task_count + COALESCE(@running_detail_split_count, 0);

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
      archive_table = VALUES(archive_table),
      partition_name = VALUES(partition_name),
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
    order_file_id BIGINT UNSIGNED NULL,
    task_id BIGINT UNSIGNED NOT NULL,
    rule_id BIGINT UNSIGNED NULL,
    operation_status VARCHAR(20) NOT NULL,
    PRIMARY KEY (id, partition_date),
    KEY tmp_archive_order_file_idx (order_file_id),
    KEY tmp_archive_transfer_idx (task_id, rule_id, partition_date, operation_status)
  ) ENGINE=InnoDB;

  archive_batch_loop: LOOP
    START TRANSACTION;
    DELETE FROM tmp_bill_detail_archive_ids;

    SET @select_archive_batch_sql = CONCAT(
      'INSERT INTO tmp_bill_detail_archive_ids ',
      '(id, partition_date, order_file_id, task_id, rule_id, operation_status) ',
      'SELECT id, partition_date, order_file_id, task_id, rule_id, operation_status ',
      'FROM bill_details PARTITION (`',
      REPLACE(source_partition_name, '`', '``'),
      '`) bd WHERE bd.partition_date = ? ',
      'AND bd.match_result_id IS NOT NULL ',
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
      REPLACE(source_partition_name, '`', '``'),
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
      '` (`id`, `task_id`, `rule_id`, `order_file_id`, `detail_split_file_id`, ',
      '`split_source_detail_id`, `bill_no`, `invoice_other_order_no_1`, ',
      '`invoice_other_order_no_2`, `bill_date`, `partition_date`, `description`, ',
      '`total_amount`, `refund_amount_snapshot`, `raw_data`, `match_status`, ',
      '`match_result_id`, `operation_status`, `lifecycle_status`, `original_task_id`, ',
      '`original_recognition_date`, `rule_item_id`, `ignore_reason`, `created_at`) ',
      'SELECT bd.`id`, bd.`task_id`, bd.`rule_id`, bd.`order_file_id`, ',
      'bd.`detail_split_file_id`, bd.`split_source_detail_id`, bd.`bill_no`, ',
      'bd.`invoice_other_order_no_1`, bd.`invoice_other_order_no_2`, bd.`bill_date`, ',
      'bd.`partition_date`, bd.`description`, bd.`total_amount`, ',
      'bd.`refund_amount_snapshot`, bd.`raw_data`, bd.`match_status`, ',
      'bd.`match_result_id`, bd.`operation_status`, bd.`lifecycle_status`, ',
      'bd.`original_task_id`, bd.`original_recognition_date`, bd.`rule_item_id`, ',
      'bd.`ignore_reason`, bd.`created_at` FROM bill_details PARTITION (`',
      REPLACE(source_partition_name, '`', '``'),
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
      REPLACE(source_partition_name, '`', '``'),
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

    UPDATE order_files archived_file
    INNER JOIN tmp_bill_detail_archive_ids selected
      ON selected.order_file_id = archived_file.id
    SET archived_file.recognition_summary_valid = 0
    WHERE selected.order_file_id IS NOT NULL
      AND archived_file.recognition_summary_valid <> 0;

    DELETE recognition_summary
    FROM order_file_recognition_summaries recognition_summary
    INNER JOIN tmp_bill_detail_archive_ids selected
      ON selected.order_file_id = recognition_summary.order_file_id
    WHERE selected.order_file_id IS NOT NULL;

    DELETE source_delta
    FROM order_recognition_summary_deltas source_delta
    INNER JOIN tmp_bill_detail_archive_ids selected
      ON selected.order_file_id = source_delta.order_file_id
    WHERE selected.order_file_id IS NOT NULL
      AND source_delta.delta_type = 'source_deduction';

    DELETE transfer_delta
    FROM order_recognition_summary_deltas transfer_delta
    INNER JOIN tmp_bill_detail_archive_ids selected
      ON selected.task_id = transfer_delta.task_id
      AND selected.rule_id = transfer_delta.rule_id
      AND selected.partition_date = transfer_delta.partition_date
    WHERE selected.operation_status = 'transferred'
      AND selected.rule_id IS NOT NULL
      AND transfer_delta.delta_type = 'target_transfer_in';

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
    archive_table = archive_table_name,
    partition_name = source_partition_name,
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

CREATE PROCEDURE roll_bill_details_hot_window()
roll_window: BEGIN
  DECLARE cutoff_date DATE;
  DECLARE hot_start DATE;
  DECLARE late_partition_count INT DEFAULT 0;
  DECLARE expired_partition_count INT DEFAULT 0;
  DECLARE expired_partition_list LONGTEXT;
  DECLARE expired_partition_processing_count BIGINT UNSIGNED DEFAULT 0;

  SET cutoff_date = DATE_SUB(CURDATE(), INTERVAL 60 DAY);
  SET hot_start = DATE_ADD(cutoff_date, INTERVAL 1 DAY);
  SET SESSION group_concat_max_len = 1000000;

  SELECT COUNT(*)
    INTO late_partition_count
  FROM information_schema.partitions
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_details'
    AND partition_name = 'p_late';

  SELECT
    COUNT(*),
    GROUP_CONCAT(
      CONCAT('`', REPLACE(partition_name, '`', '``'), '`')
      ORDER BY partition_ordinal_position
      SEPARATOR ', '
    )
    INTO expired_partition_count, expired_partition_list
  FROM information_schema.partitions
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_details'
    AND partition_name REGEXP '^p[0-9]{8}$'
    AND partition_description <> 'MAXVALUE'
    AND STR_TO_DATE(REPLACE(partition_description, '''', ''), '%Y-%m-%d') <= hot_start;

  IF expired_partition_count = 0 OR late_partition_count = 0 THEN
    LEAVE roll_window;
  END IF;

  SET @expired_partition_processing_count = 0;
  SET @expired_partition_processing_sql = CONCAT(
    'SELECT (',
    'EXISTS(SELECT 1 FROM bill_details PARTITION (',
    expired_partition_list,
    ') bd INNER JOIN recognition_tasks rt ON rt.id = bd.task_id ',
    'WHERE rt.status = ''processing'' LIMIT 1) ',
    'OR EXISTS(SELECT 1 FROM bill_details PARTITION (',
    expired_partition_list,
    ') bd INNER JOIN detail_split_files dsf ON dsf.id = bd.detail_split_file_id ',
    'WHERE (dsf.upload_status = ''processing'' ',
    'OR dsf.recognition_phase IN (''finding_tasks'', ''recognizing'')) LIMIT 1)',
    ') INTO @expired_partition_processing_count'
  );
  PREPARE expired_partition_processing_stmt FROM @expired_partition_processing_sql;
  EXECUTE expired_partition_processing_stmt;
  DEALLOCATE PREPARE expired_partition_processing_stmt;
  SET expired_partition_processing_count =
    COALESCE(@expired_partition_processing_count, 0);

  -- 非空过期日分区只要没有任务执行中即可并入 p_late；未认账行继续留在热表。
  IF expired_partition_processing_count > 0 THEN
    LEAVE roll_window;
  END IF;

  SET @roll_partition_sql = CONCAT(
    'ALTER TABLE bill_details REORGANIZE PARTITION `p_late`, ',
    expired_partition_list,
    ' INTO (PARTITION p_late VALUES LESS THAN (''',
    DATE_FORMAT(hot_start, '%Y-%m-%d'),
    '''))'
  );
  PREPARE roll_partition_stmt FROM @roll_partition_sql;
  EXECUTE roll_partition_stmt;
  DEALLOCATE PREPARE roll_partition_stmt;
END//

CREATE PROCEDURE archive_bill_details_daily()
archive_daily: BEGIN
  DECLARE cutoff_date DATE;
  DECLARE hot_start DATE;
  DECLARE candidate_date DATE;
  DECLARE remaining_count BIGINT UNSIGNED DEFAULT 0;
  DECLARE processed_date_count INT DEFAULT 0;

  SET cutoff_date = DATE_SUB(CURDATE(), INTERVAL 60 DAY);
  SET hot_start = DATE_ADD(cutoff_date, INTERVAL 1 DAY);

  CALL archive_bill_details_day(cutoff_date);

  -- 只选择已经可以归档的历史日期；未认账 p_late 行不阻塞后续日期。
  late_date_loop: LOOP
    IF processed_date_count >= 31 THEN
      LEAVE late_date_loop;
    END IF;

    SELECT MIN(bd.partition_date)
      INTO candidate_date
    FROM bill_details bd
    WHERE bd.partition_date >= '1970-01-02'
      AND bd.partition_date < hot_start
      AND bd.match_result_id IS NOT NULL;

    IF candidate_date IS NULL THEN
      LEAVE late_date_loop;
    END IF;

    CALL archive_bill_details_day(candidate_date);

    SELECT COUNT(*)
      INTO remaining_count
    FROM bill_details bd
    WHERE bd.partition_date = candidate_date
      AND bd.match_result_id IS NOT NULL;

    -- 仍有可归档行说明任务被跳过或批次失败，留到下一次事件重试。
    IF remaining_count > 0 THEN
      LEAVE late_date_loop;
    END IF;

    SET processed_date_count = processed_date_count + 1;
  END LOOP;

  CALL roll_bill_details_hot_window();
END//

DELIMITER ;

-- The existing archive event and storage wrapper continue calling these names.
ALTER EVENT ev_bill_details_archive_old_daily_partitions ENABLE;

SELECT
  routine_name
FROM information_schema.routines
WHERE routine_schema = DATABASE()
  AND routine_name IN (
    'archive_bill_details_day',
    'archive_bill_details_daily',
    'roll_bill_details_hot_window'
  )
ORDER BY routine_name;
