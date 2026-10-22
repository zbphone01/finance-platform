-- v10.60: 订单明细进入月归档后，清理上传预匹配快照和分组增量。
--
-- order_file_recognition_summaries 只服务于新上传订单包的首次自动认账。
-- 任一来源明细进入归档后，该订单包的上传快照不再代表完整热区数据：
--   1. recognition_summary_valid 必须置为 0；
--   2. 对应 order_file_recognition_summaries 必须删除；
--   3. 来源订单包扣减增量必须删除；
--   4. 对应目标任务/规则/日期的转入增量必须删除；
--   5. 所有清理必须与当前 50000 行归档批次处于同一事务。
--
-- 本迁移不修改表结构、不增加索引，只替换 v10.43 的单日归档过程。
-- 执行前必须已经部署 v10.59 的 order_file_recognition_summaries，
-- 并先执行 migrate-v10.60-order-recognition-summary-deltas.sql。

DROP PROCEDURE IF EXISTS assert_archive_order_recognition_summary_ready_v1060;

DELIMITER //
CREATE PROCEDURE assert_archive_order_recognition_summary_ready_v1060()
BEGIN
  DECLARE dependency_count INT DEFAULT 0;

  SELECT COUNT(*)
    INTO dependency_count
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name IN (
      'bill_details',
      'order_files',
      'order_file_recognition_summaries',
      'order_recognition_summary_deltas',
      'bill_detail_archive_runs'
    );

  IF dependency_count <> 5 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'v10.60 archive summary cleanup dependencies are missing';
  END IF;
END//
DELIMITER ;

CALL assert_archive_order_recognition_summary_ready_v1060();
DROP PROCEDURE IF EXISTS assert_archive_order_recognition_summary_ready_v1060;

DROP PROCEDURE IF EXISTS archive_bill_details_day;

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
      '`) WHERE partition_date = ? ',
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
      '` SELECT bd.* FROM bill_details PARTITION (`',
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
DELIMITER ;
