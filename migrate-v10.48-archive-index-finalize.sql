-- v10.48: 月归档订单明细索引两阶段精简（第二阶段：正式清理）。
--
-- 前置条件：
--   1. 已执行 migrate-v10.48-archive-index-canary.sql；
--   2. 已观察 3-7 个业务日；
--   3. 三个候选索引仍存在且均为 INVISIBLE；
--   4. 订单文件详情、日期详情、取消认账、归档恢复和自动归档均正常。
--
-- 本阶段删除三个候选索引并实际释放空间，同时把未来月归档表的
-- 创建逻辑切换为直接删除这些热表专用/重叠索引。

DROP PROCEDURE IF EXISTS finalize_bill_details_archive_indexes_v1048;

DELIMITER //
CREATE PROCEDURE finalize_bill_details_archive_indexes_v1048()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE target_table_name VARCHAR(64);
  DECLARE helper_count INT DEFAULT 0;
  DECLARE visible_candidate_count INT DEFAULT 0;

  DECLARE table_cursor CURSOR FOR
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name REGEXP '^bill_details_archive_[0-9]{6}$'
    ORDER BY table_name;

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  SELECT COUNT(*)
    INTO helper_count
  FROM information_schema.routines
  WHERE routine_schema = DATABASE()
    AND routine_type = 'PROCEDURE'
    AND routine_name = 'normalize_bill_details_archive_indexes_v1048';

  IF helper_count <> 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'v10.48 archive index canary migration has not been applied';
  END IF;

  -- Refuse to finalize when any candidate is still visible. This prevents a
  -- direct skip from the canary stage to irreversible index deletion.
  SELECT COUNT(DISTINCT CONCAT(table_name, ':', index_name))
    INTO visible_candidate_count
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name REGEXP '^bill_details_archive_[0-9]{6}$'
    AND index_name IN (
      'bd_order_file_idx',
      'bd_task_status_idx',
      'bd_rule_detail_split_status_idx'
    )
    AND is_visible = 'YES';

  IF visible_candidate_count > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'visible archive candidate indexes remain; complete canary observation first';
  END IF;

  -- First pass only validates every table and every replacement index. With
  -- all candidates already invisible, finalize_drop=0 performs no candidate
  -- DDL and avoids a partial drop caused by a later schema mismatch.
  OPEN table_cursor;
  validate_loop: LOOP
    FETCH table_cursor INTO target_table_name;
    IF done = 1 THEN
      LEAVE validate_loop;
    END IF;
    CALL normalize_bill_details_archive_indexes_v1048(target_table_name, 0, 0);
  END LOOP;
  CLOSE table_cursor;

  SET done = 0;

  -- Second pass performs the irreversible candidate index drops.
  OPEN table_cursor;
  finalize_loop: LOOP
    FETCH table_cursor INTO target_table_name;
    IF done = 1 THEN
      LEAVE finalize_loop;
    END IF;
    CALL normalize_bill_details_archive_indexes_v1048(target_table_name, 1, 0);
  END LOOP;
  CLOSE table_cursor;
END//
DELIMITER ;

CALL finalize_bill_details_archive_indexes_v1048();
DROP PROCEDURE IF EXISTS finalize_bill_details_archive_indexes_v1048;

-- Switch the month-table factory to the finalized archive index whitelist.
-- A new empty table may drop freshly inherited visible candidates immediately;
-- populated existing tables were required to pass the canary first.
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
  DECLARE created_table TINYINT DEFAULT 0;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    IF created_table = 1 THEN
      SET @cleanup_archive_table_sql = CONCAT(
        'DROP TABLE IF EXISTS `', REPLACE(archive_table_name, '`', '``'), '`'
      );
      PREPARE cleanup_archive_table_stmt FROM @cleanup_archive_table_sql;
      EXECUTE cleanup_archive_table_stmt;
      DEALLOCATE PREPARE cleanup_archive_table_stmt;
      SET @cleanup_archive_table_sql = NULL;
    END IF;
    RESIGNAL;
  END;

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
      'CREATE TABLE `', archive_table_name, '` LIKE bill_details'
    );
    PREPARE create_archive_table_stmt FROM @create_archive_table_sql;
    EXECUTE create_archive_table_stmt;
    DEALLOCATE PREPARE create_archive_table_stmt;
    SET created_table = 1;

    SET @remove_archive_partition_sql = CONCAT(
      'ALTER TABLE `', archive_table_name, '` REMOVE PARTITIONING'
    );
    PREPARE remove_archive_partition_stmt FROM @remove_archive_partition_sql;
    EXECUTE remove_archive_partition_stmt;
    DEALLOCATE PREPARE remove_archive_partition_stmt;

    CALL normalize_bill_details_archive_indexes_v1048(archive_table_name, 1, 1);

    SET partition_sql = CONCAT(
      'ALTER TABLE `', archive_table_name,
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
        'PARTITION p', DATE_FORMAT(day_cursor, '%Y%m%d'),
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
    SET created_table = 0;
  END IF;

  SET @create_archive_table_sql = NULL;
  SET @remove_archive_partition_sql = NULL;
  SET @archive_partition_sql = NULL;
END//
DELIMITER ;

SELECT
  table_name,
  index_name,
  MIN(is_visible) AS is_visible,
  GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ',') AS index_columns
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name REGEXP '^bill_details_archive_[0-9]{6}$'
  AND index_name IN (
    'bd_rule_partition_date_bill_no_uq',
    'bd_rule_bill_date_bill_no_partition_uq',
    'bd_order_file_idx',
    'bd_order_rec_item_idx',
    'bd_task_idx',
    'bd_task_status_idx',
    'bd_detail_split_file_idx',
    'bd_partition_status_idx',
    'bd_rule_detail_split_status_idx'
  )
GROUP BY table_name, index_name
ORDER BY table_name, index_name;

SELECT
  table_name,
  table_rows,
  data_length,
  index_length,
  data_length + index_length AS total_length
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name REGEXP '^bill_details_archive_[0-9]{6}$'
ORDER BY table_name;
