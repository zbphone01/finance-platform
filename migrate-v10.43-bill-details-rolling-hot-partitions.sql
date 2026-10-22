-- v10.43: bill_details 全量归档与滚动热分区。
--
-- 目标结构：
--   p_unmatched : partition_date < 1970-01-02 的特殊暂存数据
--   p_late      : 60 天热区之前的迟到订单处理分区
--   pYYYYMMDD   : 最近 60 个自然日的日分区
--   p_future    : 未来日期兜底
--
-- 每日 02:30 补齐当天日分区；每日 03:10：
--   1. 将 60 天热区之前的全部明细按真实 partition_date 搬入月归档表；
--   2. 将刚满 60 天的日分区全部明细搬入月归档表；
--   3. 源日分区清空后，将其与 p_late 合并，释放旧日分区及其索引空间。
--
-- 本迁移不会新增 bill_details 索引。
-- 必须在维护窗口执行，并确认 v10.27 的月归档建表过程已经存在、
-- event_scheduler = ON、没有历史日期认账任务正在 processing。

DROP PROCEDURE IF EXISTS assert_bill_details_rolling_migration_ready_v1043;

DELIMITER //
CREATE PROCEDURE assert_bill_details_rolling_migration_ready_v1043()
BEGIN
  DECLARE dependency_count INT DEFAULT 0;
  DECLARE running_task_count BIGINT UNSIGNED DEFAULT 0;
  DECLARE running_detail_split_count BIGINT UNSIGNED DEFAULT 0;

  IF UPPER(CAST(@@event_scheduler AS CHAR)) <> 'ON' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'event_scheduler must be ON before v10.43 migration';
  END IF;

  SELECT COUNT(*)
    INTO dependency_count
  FROM information_schema.routines
  WHERE routine_schema = DATABASE()
    AND routine_type = 'PROCEDURE'
    AND routine_name = 'ensure_bill_details_archive_tables_around';
  IF dependency_count = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'v10.27 archive table procedure is missing';
  END IF;

  SELECT COUNT(*)
    INTO running_task_count
  FROM recognition_tasks
  WHERE bill_date <= DATE_SUB(CURDATE(), INTERVAL 60 DAY)
    AND status = 'processing';
  IF running_task_count > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'old recognition tasks are still processing';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM bill_details bd
    INNER JOIN detail_split_files dsf ON dsf.id = bd.detail_split_file_id
    WHERE bd.partition_date <= DATE_SUB(CURDATE(), INTERVAL 60 DAY)
      AND (
        dsf.upload_status = 'processing'
        OR dsf.recognition_phase IN ('finding_tasks', 'recognizing')
      )
    LIMIT 1
  ) INTO running_detail_split_count;
  IF running_detail_split_count > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'old detail split jobs are still processing';
  END IF;
END//
DELIMITER ;

CALL assert_bill_details_rolling_migration_ready_v1043();
DROP PROCEDURE IF EXISTS assert_bill_details_rolling_migration_ready_v1043;

DROP EVENT IF EXISTS ev_bill_details_archive_old_daily_partitions;
DROP EVENT IF EXISTS ev_bill_details_next_month_partitions;
DROP EVENT IF EXISTS ev_bill_details_rolling_partitions;

DROP PROCEDURE IF EXISTS archive_bill_details_daily;
DROP PROCEDURE IF EXISTS archive_bill_details_day;
DROP PROCEDURE IF EXISTS ensure_bill_details_next_month_partitions;
DROP PROCEDURE IF EXISTS ensure_bill_details_rolling_partitions;
DROP PROCEDURE IF EXISTS roll_bill_details_hot_window;
DROP PROCEDURE IF EXISTS initialize_bill_details_rolling_partitions_v1043;

DELIMITER //

CREATE PROCEDURE ensure_bill_details_rolling_partitions()
BEGIN
  DECLARE p_future_position INT DEFAULT 0;
  DECLARE p_future_lower_bound DATE;
  DECLARE target_end DATE;
  DECLARE day_cursor DATE;
  DECLARE partition_sql LONGTEXT;
  DECLARE separator_text VARCHAR(2) DEFAULT '';
  DECLARE days_to_create INT DEFAULT 0;
  DECLARE error_message VARCHAR(255);

  SELECT partition_ordinal_position
    INTO p_future_position
  FROM information_schema.partitions
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_details'
    AND partition_name = 'p_future'
    AND partition_description = 'MAXVALUE'
  LIMIT 1;

  IF p_future_position IS NULL OR p_future_position = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'bill_details partition p_future not found';
  END IF;

  SELECT STR_TO_DATE(REPLACE(partition_description, '''', ''), '%Y-%m-%d')
    INTO p_future_lower_bound
  FROM information_schema.partitions
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_details'
    AND partition_ordinal_position < p_future_position
    AND partition_description <> 'MAXVALUE'
  ORDER BY partition_ordinal_position DESC
  LIMIT 1;

  IF p_future_lower_bound IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'bill_details p_future lower bound cannot be determined';
  END IF;

  SET target_end = DATE_ADD(CURDATE(), INTERVAL 1 DAY);

  IF p_future_lower_bound >= target_end THEN
    SELECT
      p_future_lower_bound AS p_future_lower_bound,
      target_end AS rolling_partition_target_end,
      'skip: current day is already covered by an explicit partition' AS partition_maintenance_status;
  ELSE
    SET days_to_create = DATEDIFF(target_end, p_future_lower_bound);
    IF days_to_create > 400 THEN
      SET error_message = CONCAT(
        'bill_details p_future gap is too large: ',
        days_to_create,
        ' days'
      );
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = error_message;
    END IF;

    SET partition_sql = 'ALTER TABLE bill_details REORGANIZE PARTITION p_future INTO (';
    SET day_cursor = p_future_lower_bound;

    WHILE day_cursor < target_end DO
      SET partition_sql = CONCAT(
        partition_sql,
        separator_text,
        'PARTITION p',
        DATE_FORMAT(day_cursor, '%Y%m%d'),
        ' VALUES LESS THAN (''',
        DATE_FORMAT(DATE_ADD(day_cursor, INTERVAL 1 DAY), '%Y-%m-%d'),
        ''')'
      );
      SET separator_text = ', ';
      SET day_cursor = DATE_ADD(day_cursor, INTERVAL 1 DAY);
    END WHILE;

    SET partition_sql = CONCAT(
      partition_sql,
      separator_text,
      'PARTITION p_future VALUES LESS THAN (MAXVALUE))'
    );

    SET @bill_details_partition_sql = partition_sql;
    PREPARE bill_details_partition_stmt FROM @bill_details_partition_sql;
    EXECUTE bill_details_partition_stmt;
    DEALLOCATE PREPARE bill_details_partition_stmt;
  END IF;
END//

-- 保留旧过程名作为兼容入口，避免历史部署脚本或人工命令失效。
CREATE PROCEDURE ensure_bill_details_next_month_partitions()
BEGIN
  CALL ensure_bill_details_rolling_partitions();
END//

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
    PRIMARY KEY (id, partition_date)
  ) ENGINE=InnoDB;

  archive_batch_loop: LOOP
    START TRANSACTION;
    DELETE FROM tmp_bill_detail_archive_ids;

    SET @select_archive_batch_sql = CONCAT(
      'INSERT INTO tmp_bill_detail_archive_ids (id, partition_date) ',
      'SELECT id, partition_date FROM bill_details PARTITION (`',
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
  DECLARE expired_partition_row_count BIGINT UNSIGNED DEFAULT 0;

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

  SET @expired_partition_row_count = 0;
  SET @expired_partition_row_sql = CONCAT(
    'SELECT COUNT(*) INTO @expired_partition_row_count ',
    'FROM bill_details PARTITION (',
    expired_partition_list,
    ')'
  );
  PREPARE expired_partition_row_stmt FROM @expired_partition_row_sql;
  EXECUTE expired_partition_row_stmt;
  DEALLOCATE PREPARE expired_partition_row_stmt;
  SET expired_partition_row_count = COALESCE(@expired_partition_row_count, 0);

  -- 任一过期日仍有 processing 任务或归档失败时，保留整段分区，下一日重试。
  IF expired_partition_row_count > 0 THEN
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

  -- 迟到订单按真实日期归档；限制单次最多处理 31 个日期，避免异常积压拖垮事件线程。
  late_date_loop: LOOP
    IF processed_date_count >= 31 THEN
      LEAVE late_date_loop;
    END IF;

    SELECT MIN(partition_date)
      INTO candidate_date
    FROM bill_details
    WHERE partition_date >= '1970-01-02'
      AND partition_date < hot_start;

    IF candidate_date IS NULL THEN
      LEAVE late_date_loop;
    END IF;

    CALL archive_bill_details_day(candidate_date);

    SELECT COUNT(*)
      INTO remaining_count
    FROM bill_details
    WHERE partition_date = candidate_date;

    -- processing 任务会让归档跳过；避免在同一事件内无限循环。
    IF remaining_count > 0 THEN
      LEAVE late_date_loop;
    END IF;

    SET processed_date_count = processed_date_count + 1;
  END LOOP;

  CALL roll_bill_details_hot_window();
END//

CREATE PROCEDURE initialize_bill_details_rolling_partitions_v1043()
initialize_partitions: BEGIN
  DECLARE hot_start DATE;
  DECLARE oldest_date DATE;
  DECLARE remaining_old_count BIGINT UNSIGNED DEFAULT 0;
  DECLARE old_partition_count INT DEFAULT 0;
  DECLARE future_partition_count INT DEFAULT 0;
  DECLARE old_partition_list LONGTEXT;
  DECLARE future_partition_list LONGTEXT;

  SET hot_start = DATE_SUB(CURDATE(), INTERVAL 59 DAY);
  SET SESSION group_concat_max_len = 1000000;

  -- 首次执行先归档全部热区之前的数据；遇到 processing 任务时停止并要求维护后重跑。
  initialize_archive_loop: LOOP
    SELECT MIN(partition_date)
      INTO oldest_date
    FROM bill_details
    WHERE partition_date >= '1970-01-02'
      AND partition_date < hot_start;

    IF oldest_date IS NULL THEN
      LEAVE initialize_archive_loop;
    END IF;

    CALL archive_bill_details_day(oldest_date);

    SELECT COUNT(*)
      INTO remaining_old_count
    FROM bill_details
    WHERE partition_date = oldest_date;

    IF remaining_old_count > 0 THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'old bill_details rows remain; stop processing tasks and rerun v10.43 migration';
    END IF;
  END LOOP;

  SELECT
    COUNT(*),
    GROUP_CONCAT(
      CONCAT('`', REPLACE(partition_name, '`', '``'), '`')
      ORDER BY partition_ordinal_position
      SEPARATOR ', '
    )
    INTO old_partition_count, old_partition_list
  FROM information_schema.partitions
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_details'
    AND partition_name NOT IN ('p_unmatched', 'p_future')
    AND partition_description <> 'MAXVALUE'
    AND STR_TO_DATE(REPLACE(partition_description, '''', ''), '%Y-%m-%d') <= hot_start;

  IF old_partition_count > 0 THEN
    SET @initialize_late_partition_sql = CONCAT(
      'ALTER TABLE bill_details REORGANIZE PARTITION ',
      old_partition_list,
      ' INTO (PARTITION p_late VALUES LESS THAN (''',
      DATE_FORMAT(hot_start, '%Y-%m-%d'),
      '''))'
    );
    PREPARE initialize_late_partition_stmt FROM @initialize_late_partition_sql;
    EXECUTE initialize_late_partition_stmt;
    DEALLOCATE PREPARE initialize_late_partition_stmt;
  END IF;

  -- 删除预创建的未来日分区，未来日期统一由 p_future 兜底。
  SELECT
    COUNT(*),
    GROUP_CONCAT(
      CONCAT('`', REPLACE(partition_name, '`', '``'), '`')
      ORDER BY partition_ordinal_position
      SEPARATOR ', '
    )
    INTO future_partition_count, future_partition_list
  FROM information_schema.partitions
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_details'
    AND (
      (
        partition_name REGEXP '^p[0-9]{8}$'
        AND STR_TO_DATE(SUBSTRING(partition_name, 2), '%Y%m%d') > CURDATE()
      )
      OR partition_name = 'p_future'
    );

  IF future_partition_count > 1 THEN
    SET @initialize_future_partition_sql = CONCAT(
      'ALTER TABLE bill_details REORGANIZE PARTITION ',
      future_partition_list,
      ' INTO (PARTITION p_future VALUES LESS THAN (MAXVALUE))'
    );
    PREPARE initialize_future_partition_stmt FROM @initialize_future_partition_sql;
    EXECUTE initialize_future_partition_stmt;
    DEALLOCATE PREPARE initialize_future_partition_stmt;
  END IF;

  CALL ensure_bill_details_rolling_partitions();
END//

DELIMITER ;

CALL initialize_bill_details_rolling_partitions_v1043();
DROP PROCEDURE IF EXISTS initialize_bill_details_rolling_partitions_v1043;

SET @next_partition_event_at = TIMESTAMP(
  CURDATE(),
  CAST('02:30:00' AS TIME)
);
SET @partition_event_day_offset = (@next_partition_event_at <= NOW());
SET @next_partition_event_at = DATE_ADD(
  @next_partition_event_at,
  INTERVAL @partition_event_day_offset DAY
);
SET @create_bill_details_partition_event_sql = CONCAT(
  'CREATE EVENT ev_bill_details_rolling_partitions ',
  'ON SCHEDULE EVERY 1 DAY ',
  'STARTS ''',
  DATE_FORMAT(@next_partition_event_at, '%Y-%m-%d %H:%i:%s'),
  ''' ',
  'ON COMPLETION PRESERVE ENABLE ',
  'DO CALL ensure_bill_details_rolling_partitions()'
);
PREPARE create_bill_details_partition_event_stmt FROM @create_bill_details_partition_event_sql;
EXECUTE create_bill_details_partition_event_stmt;
DEALLOCATE PREPARE create_bill_details_partition_event_stmt;

SET @next_day_archive_event_at = TIMESTAMP(
  CURDATE(),
  CAST('03:10:00' AS TIME)
);
SET @archive_event_day_offset = (@next_day_archive_event_at <= NOW());
SET @next_day_archive_event_at = DATE_ADD(
  @next_day_archive_event_at,
  INTERVAL @archive_event_day_offset DAY
);
SET @archive_wrapper_count = (
  SELECT COUNT(*)
  FROM information_schema.routines
  WHERE routine_schema = DATABASE()
    AND routine_type = 'PROCEDURE'
    AND routine_name = 'archive_bill_details_daily_with_storage_request'
);
SET @archive_event_procedure = IF(
  @archive_wrapper_count > 0,
  'archive_bill_details_daily_with_storage_request',
  'archive_bill_details_daily'
);
SET @create_archive_event_sql = CONCAT(
  'CREATE EVENT ev_bill_details_archive_old_daily_partitions ',
  'ON SCHEDULE EVERY 1 DAY ',
  'STARTS ''',
  DATE_FORMAT(@next_day_archive_event_at, '%Y-%m-%d %H:%i:%s'),
  ''' ',
  'ON COMPLETION PRESERVE ENABLE ',
  'DO CALL ',
  @archive_event_procedure,
  '()'
);
PREPARE create_archive_event_stmt FROM @create_archive_event_sql;
EXECUTE create_archive_event_stmt;
DEALLOCATE PREPARE create_archive_event_stmt;

SET @next_partition_event_at = NULL;
SET @partition_event_day_offset = NULL;
SET @create_bill_details_partition_event_sql = NULL;
SET @next_day_archive_event_at = NULL;
SET @archive_event_day_offset = NULL;
SET @archive_wrapper_count = NULL;
SET @archive_event_procedure = NULL;
SET @create_archive_event_sql = NULL;
SET @bill_details_partition_sql = NULL;
SET @running_partition_task_count = NULL;
SET @running_partition_task_sql = NULL;
SET @running_detail_split_count = NULL;
SET @running_detail_split_sql = NULL;
SET @archive_target_date = NULL;
SET @archive_summary_sql = NULL;
SET @archive_count_value = NULL;
SET @archive_total_value = NULL;
SET @select_archive_batch_sql = NULL;
SET @archive_batch_summary_sql = NULL;
SET @archive_batch_count_value = NULL;
SET @archive_batch_total_value = NULL;
SET @insert_archive_batch_sql = NULL;
SET @delete_archive_batch_sql = NULL;
SET @expired_partition_row_count = NULL;
SET @expired_partition_row_sql = NULL;
SET @roll_partition_sql = NULL;
SET @initialize_late_partition_sql = NULL;
SET @initialize_future_partition_sql = NULL;

SELECT
  partition_name,
  partition_description,
  table_rows
FROM information_schema.partitions
WHERE table_schema = DATABASE()
  AND table_name = 'bill_details'
  AND partition_name IS NOT NULL
ORDER BY partition_ordinal_position;

SHOW EVENTS LIKE 'ev_bill_details_rolling_partitions';
SHOW EVENTS LIKE 'ev_bill_details_archive_old_daily_partitions';
