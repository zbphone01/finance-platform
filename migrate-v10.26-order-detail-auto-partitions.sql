-- v10.26: 自动维护订单明细未来日分区
-- 每月 5 日 02:30 由 MySQL Event Scheduler 调用存储过程，补齐下个月月底前的日分区。
-- 执行本脚本前请确认 MySQL 已开启 event_scheduler，且当前用户具备 ALTER、CREATE ROUTINE、EVENT 权限。

DROP EVENT IF EXISTS ev_bill_details_next_month_partitions;
DROP PROCEDURE IF EXISTS ensure_bill_details_next_month_partitions;

DELIMITER //
CREATE PROCEDURE ensure_bill_details_next_month_partitions()
BEGIN
  DECLARE p_future_position INT DEFAULT 0;
  DECLARE p_future_lower_bound DATE;
  DECLARE target_month_start DATE;
  DECLARE target_month_end DATE;
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

  SET target_month_start = DATE_ADD(
    STR_TO_DATE(DATE_FORMAT(CURDATE(), '%Y-%m-01'), '%Y-%m-%d'),
    INTERVAL 1 MONTH
  );
  SET target_month_end = DATE_ADD(target_month_start, INTERVAL 1 MONTH);

  IF p_future_lower_bound >= target_month_end THEN
    SELECT
      p_future_lower_bound AS p_future_lower_bound,
      target_month_start AS target_month_start,
      target_month_end AS target_month_end,
      'skip: target month already covered by existing partitions' AS partition_maintenance_status;
  ELSE
    SET days_to_create = DATEDIFF(target_month_end, p_future_lower_bound);

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

    WHILE day_cursor < target_month_end DO
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

    SELECT
      p_future_lower_bound AS created_from_date,
      target_month_end AS created_before_date,
      days_to_create AS created_partition_count,
      'ok: bill_details future daily partitions ensured' AS partition_maintenance_status;
  END IF;
END//
DELIMITER ;

CALL ensure_bill_details_next_month_partitions();

SET @this_month_partition_event_at = STR_TO_DATE(
  CONCAT(DATE_FORMAT(CURDATE(), '%Y-%m'), '-05 02:30:00'),
  '%Y-%m-%d %H:%i:%s'
);
SET @next_partition_event_at = IF(
  NOW() < @this_month_partition_event_at,
  @this_month_partition_event_at,
  DATE_ADD(@this_month_partition_event_at, INTERVAL 1 MONTH)
);
SET @create_bill_details_partition_event_sql = CONCAT(
  'CREATE EVENT ev_bill_details_next_month_partitions ',
  'ON SCHEDULE EVERY 1 MONTH ',
  'STARTS ''',
  DATE_FORMAT(@next_partition_event_at, '%Y-%m-%d %H:%i:%s'),
  ''' ',
  'ON COMPLETION PRESERVE ENABLE ',
  'DO CALL ensure_bill_details_next_month_partitions()'
);
PREPARE create_bill_details_partition_event_stmt FROM @create_bill_details_partition_event_sql;
EXECUTE create_bill_details_partition_event_stmt;
DEALLOCATE PREPARE create_bill_details_partition_event_stmt;

SET @this_month_partition_event_at = NULL;
SET @next_partition_event_at = NULL;
SET @create_bill_details_partition_event_sql = NULL;
