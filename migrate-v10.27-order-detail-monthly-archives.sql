-- v10.27: 订单明细 60 天热数据归档到月归档表
-- 归档策略：bill_details 保留热数据；每日凌晨将 CURDATE() - INTERVAL 60 DAY 的日分区
-- 复制到 bill_details_archive_YYYYMM（月表、日分区），校验后清空热表对应日分区。
-- 每次归档前会自动确保目标日期前一月、当月、后一月 3 张月归档表存在。

CREATE TABLE IF NOT EXISTS bill_detail_archive_runs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  archive_date DATE NOT NULL,
  archive_table VARCHAR(64) NOT NULL,
  partition_name VARCHAR(32) NOT NULL,
  status ENUM('running', 'completed', 'failed', 'skipped') NOT NULL DEFAULT 'running',
  source_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  archive_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  source_total DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  archive_total DECIMAL(20,2) NOT NULL DEFAULT 0.00,
  error_message VARCHAR(1000) NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY bdar_archive_date_uq (archive_date),
  KEY bdar_status_date_idx (status, archive_date),
  KEY bdar_archive_table_idx (archive_table)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP EVENT IF EXISTS ev_bill_details_archive_old_daily_partitions;
DROP PROCEDURE IF EXISTS archive_bill_details_daily;
DROP PROCEDURE IF EXISTS archive_bill_details_day;
DROP PROCEDURE IF EXISTS ensure_bill_details_archive_tables_around;
DROP PROCEDURE IF EXISTS ensure_bill_details_archive_month_table;

DELIMITER //
CREATE PROCEDURE ensure_bill_details_archive_month_table(IN input_date DATE)
BEGIN
  DECLARE month_start DATE;
  DECLARE next_month_start DATE;
  DECLARE day_cursor DATE;
  DECLARE archive_table_name VARCHAR(64);
  DECLARE partition_sql LONGTEXT;
  DECLARE separator_text VARCHAR(2) DEFAULT '';
  DECLARE existing_table_count INT DEFAULT 0;

  IF input_date IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'archive month input date is required';
  END IF;

  SET month_start = STR_TO_DATE(DATE_FORMAT(input_date, '%Y-%m-01'), '%Y-%m-%d');
  SET next_month_start = DATE_ADD(month_start, INTERVAL 1 MONTH);
  SET archive_table_name = CONCAT('bill_details_archive_', DATE_FORMAT(month_start, '%Y%m'));

  SELECT COUNT(*)
    INTO existing_table_count
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name = archive_table_name;

  IF existing_table_count = 0 THEN
    SET @create_archive_table_sql = CONCAT(
      'CREATE TABLE `',
      archive_table_name,
      '` LIKE bill_details'
    );
    PREPARE create_archive_table_stmt FROM @create_archive_table_sql;
    EXECUTE create_archive_table_stmt;
    DEALLOCATE PREPARE create_archive_table_stmt;

    SET @remove_archive_partition_sql = CONCAT(
      'ALTER TABLE `',
      archive_table_name,
      '` REMOVE PARTITIONING'
    );
    PREPARE remove_archive_partition_stmt FROM @remove_archive_partition_sql;
    EXECUTE remove_archive_partition_stmt;
    DEALLOCATE PREPARE remove_archive_partition_stmt;

    SET partition_sql = CONCAT(
      'ALTER TABLE `',
      archive_table_name,
      '` PARTITION BY RANGE COLUMNS(partition_date) (',
      'PARTITION p_before VALUES LESS THAN (''',
      DATE_FORMAT(month_start, '%Y-%m-%d'),
      ''')'
    );

    SET day_cursor = month_start;
    SET separator_text = ', ';
    WHILE day_cursor < next_month_start DO
      SET partition_sql = CONCAT(
        partition_sql,
        separator_text,
        'PARTITION p',
        DATE_FORMAT(day_cursor, '%Y%m%d'),
        ' VALUES LESS THAN (''',
        DATE_FORMAT(DATE_ADD(day_cursor, INTERVAL 1 DAY), '%Y-%m-%d'),
        ''')'
      );
      SET day_cursor = DATE_ADD(day_cursor, INTERVAL 1 DAY);
    END WHILE;

    SET partition_sql = CONCAT(
      partition_sql,
      ', PARTITION p_future VALUES LESS THAN (MAXVALUE))'
    );

    SET @archive_partition_sql = partition_sql;
    PREPARE archive_partition_stmt FROM @archive_partition_sql;
    EXECUTE archive_partition_stmt;
    DEALLOCATE PREPARE archive_partition_stmt;
  END IF;
END//

CREATE PROCEDURE ensure_bill_details_archive_tables_around(IN anchor_date DATE)
BEGIN
  IF anchor_date IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'archive table anchor date is required';
  END IF;

  CALL ensure_bill_details_archive_month_table(DATE_SUB(anchor_date, INTERVAL 1 MONTH));
  CALL ensure_bill_details_archive_month_table(anchor_date);
  CALL ensure_bill_details_archive_month_table(DATE_ADD(anchor_date, INTERVAL 1 MONTH));
END//

CREATE PROCEDURE archive_bill_details_day(IN target_date DATE)
BEGIN
  DECLARE archive_table_name VARCHAR(64);
  DECLARE source_partition_name VARCHAR(32);
  DECLARE existing_partition_count INT DEFAULT 0;
  DECLARE source_count_value BIGINT UNSIGNED DEFAULT 0;
  DECLARE archive_count_value BIGINT UNSIGNED DEFAULT 0;
  DECLARE source_total_value DECIMAL(20,2) DEFAULT 0.00;
  DECLARE archive_total_value DECIMAL(20,2) DEFAULT 0.00;
  DECLARE running_task_count BIGINT UNSIGNED DEFAULT 0;
  DECLARE lock_name VARCHAR(128);
  DECLARE lock_acquired INT DEFAULT 0;
  DECLARE existing_completed_count INT DEFAULT 0;
  DECLARE error_text VARCHAR(1000);

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    GET DIAGNOSTICS CONDITION 1 error_text = MESSAGE_TEXT;
    UPDATE bill_detail_archive_runs
    SET
      status = 'failed',
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

  SET archive_table_name = CONCAT('bill_details_archive_', DATE_FORMAT(target_date, '%Y%m'));
  SET source_partition_name = CONCAT('p', DATE_FORMAT(target_date, '%Y%m%d'));
  SET lock_name = CONCAT(DATABASE(), ':bill_details_archive:', DATE_FORMAT(target_date, '%Y-%m-%d'));

  SELECT COUNT(*)
    INTO existing_completed_count
  FROM bill_detail_archive_runs
  WHERE archive_date = target_date
    AND status = 'completed';

  IF existing_completed_count > 0 THEN
    SELECT target_date AS archive_date, 'skip: archive already completed' AS archive_status;
  ELSE
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
        status = 'skipped',
        error_message = VALUES(error_message),
        completed_at = NOW();
    ELSE
      CALL ensure_bill_details_archive_tables_around(target_date);

      SELECT COUNT(*)
        INTO existing_partition_count
      FROM information_schema.partitions
      WHERE table_schema = DATABASE()
        AND table_name = 'bill_details'
        AND partition_name = source_partition_name;

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
        IF(existing_partition_count = 0, 'skipped', 'running'),
        0,
        0,
        0.00,
        0.00,
        IF(existing_partition_count = 0, 'source partition not found', NULL),
        NOW(),
        IF(existing_partition_count = 0, NOW(), NULL)
      )
      ON DUPLICATE KEY UPDATE
        archive_table = VALUES(archive_table),
        partition_name = VALUES(partition_name),
        status = VALUES(status),
        source_count = 0,
        archive_count = 0,
        source_total = 0.00,
        archive_total = 0.00,
        error_message = VALUES(error_message),
        started_at = NOW(),
        completed_at = VALUES(completed_at);

      IF existing_partition_count > 0 THEN
        SELECT COUNT(*)
          INTO running_task_count
        FROM recognition_tasks
        WHERE bill_date = target_date
          AND status = 'processing';

        IF running_task_count > 0 THEN
          UPDATE bill_detail_archive_runs
          SET
            status = 'skipped',
            error_message = 'recognition task is still processing',
            completed_at = NOW()
          WHERE archive_date = target_date;
        ELSE
          SET @source_summary_sql = CONCAT(
            'SELECT COUNT(*), COALESCE(SUM(CAST(total_amount AS DECIMAL(18,2))), 0.00) ',
            'INTO @source_count_value, @source_total_value ',
            'FROM bill_details PARTITION (`',
            source_partition_name,
            '`) WHERE partition_date = ?'
          );
          PREPARE source_summary_stmt FROM @source_summary_sql;
          SET @archive_target_date = target_date;
          EXECUTE source_summary_stmt USING @archive_target_date;
          DEALLOCATE PREPARE source_summary_stmt;
          SET source_count_value = COALESCE(@source_count_value, 0);
          SET source_total_value = COALESCE(@source_total_value, 0.00);

          IF source_count_value = 0 THEN
            UPDATE bill_detail_archive_runs
            SET
              status = 'completed',
              source_count = 0,
              archive_count = 0,
              source_total = 0.00,
              archive_total = 0.00,
              error_message = NULL,
              completed_at = NOW()
            WHERE archive_date = target_date;
          ELSE
            SET @insert_archive_sql = CONCAT(
              'INSERT IGNORE INTO `',
              archive_table_name,
              '` SELECT * FROM bill_details PARTITION (`',
              source_partition_name,
              '`) WHERE partition_date = ?'
            );
            PREPARE insert_archive_stmt FROM @insert_archive_sql;
            EXECUTE insert_archive_stmt USING @archive_target_date;
            DEALLOCATE PREPARE insert_archive_stmt;

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

            IF archive_count_value <> source_count_value OR archive_total_value <> source_total_value THEN
              SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'archive verification failed';
            END IF;

            SET @truncate_partition_sql = CONCAT(
              'ALTER TABLE bill_details TRUNCATE PARTITION `',
              source_partition_name,
              '`'
            );
            PREPARE truncate_partition_stmt FROM @truncate_partition_sql;
            EXECUTE truncate_partition_stmt;
            DEALLOCATE PREPARE truncate_partition_stmt;

            UPDATE bill_detail_archive_runs
            SET
              status = 'completed',
              source_count = source_count_value,
              archive_count = archive_count_value,
              source_total = source_total_value,
              archive_total = archive_total_value,
              error_message = NULL,
              completed_at = NOW()
            WHERE archive_date = target_date;
          END IF;
        END IF;
      END IF;

      DO RELEASE_LOCK(lock_name);
      SET lock_acquired = 0;
    END IF;
  END IF;
END//

CREATE PROCEDURE archive_bill_details_daily()
BEGIN
  CALL archive_bill_details_day(DATE_SUB(CURDATE(), INTERVAL 60 DAY));
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
