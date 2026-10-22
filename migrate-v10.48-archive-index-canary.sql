-- v10.48: 月归档订单明细索引两阶段精简（第一阶段：灰度）。
--
-- 本阶段不会删除现有月归档表的候选索引，也不会释放索引空间：
--   1. 将三个候选索引改为 INVISIBLE，观察替代索引和业务查询是否稳定；
--   2. 修正新建月归档表直接继承 bill_details 全部索引的问题；
--   3. 新表继承新旧两套唯一索引时，保留新版去重索引并删除旧索引；
--   4. 新表的三个候选索引同样先设为 INVISIBLE，待第二阶段统一删除。
--
-- 必须先执行本脚本并观察 3-7 个业务日，再执行
-- migrate-v10.48-archive-index-finalize.sql。

DROP PROCEDURE IF EXISTS normalize_bill_details_archive_indexes_v1048;

DELIMITER //
CREATE PROCEDURE normalize_bill_details_archive_indexes_v1048(
  IN target_table_name VARCHAR(64),
  IN finalize_drop TINYINT,
  IN allow_visible_drop TINYINT
)
BEGIN
  DECLARE table_count INT DEFAULT 0;
  DECLARE index_count INT DEFAULT 0;
  DECLARE index_non_unique INT DEFAULT 1;
  DECLARE index_visible VARCHAR(3) DEFAULT 'NO';
  DECLARE index_columns TEXT DEFAULT '';
  DECLARE replacement_count INT DEFAULT 0;
  DECLARE replacement_visible VARCHAR(3) DEFAULT 'NO';
  DECLARE replacement_columns TEXT DEFAULT '';
  DECLARE error_text VARCHAR(1000);

  IF target_table_name IS NULL
     OR target_table_name NOT REGEXP '^bill_details_archive_[0-9]{6}$' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'invalid bill details archive table name';
  END IF;

  SELECT COUNT(*)
    INTO table_count
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name = target_table_name;

  IF table_count <> 1 THEN
    SET error_text = CONCAT('archive table does not exist: ', target_table_name);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_text;
  END IF;

  -- Existing archive tables retain the historical unique index. A newly
  -- created table inherits both unique indexes from bill_details; in that
  -- case keep the newer cross-partition de-duplication index and remove the
  -- old duplicate structure while the table is still empty.
  SELECT
    COUNT(DISTINCT index_name),
    COALESCE(MIN(non_unique), 1),
    COALESCE(MIN(is_visible), 'NO'),
    COALESCE(GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ','), '')
    INTO index_count, index_non_unique, index_visible, index_columns
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = target_table_name
    AND index_name = 'bd_rule_bill_date_bill_no_partition_uq';

  IF index_count > 0 THEN
    IF index_count <> 1
       OR index_non_unique <> 0
       OR index_visible <> 'YES'
       OR index_columns <> 'rule_id,bill_date,bill_no,partition_date' THEN
      SET error_text = CONCAT('unexpected new archive unique index definition: ', target_table_name);
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_text;
    END IF;

    SELECT
      COUNT(DISTINCT index_name),
      COALESCE(MIN(non_unique), 1),
      COALESCE(GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ','), '')
      INTO replacement_count, index_non_unique, replacement_columns
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND index_name = 'bd_rule_partition_date_bill_no_uq';

    IF replacement_count > 0 THEN
      IF replacement_count <> 1
         OR index_non_unique <> 0
         OR replacement_columns <> 'rule_id,partition_date,bill_date,bill_no' THEN
        SET error_text = CONCAT('unexpected old archive unique index definition: ', target_table_name);
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_text;
      END IF;

      SET @archive_index_ddl = CONCAT(
        'ALTER TABLE `', REPLACE(target_table_name, '`', '``'),
        '` DROP INDEX `bd_rule_partition_date_bill_no_uq`, ALGORITHM=INPLACE, LOCK=NONE'
      );
      PREPARE archive_index_stmt FROM @archive_index_ddl;
      EXECUTE archive_index_stmt;
      DEALLOCATE PREPARE archive_index_stmt;
    END IF;
  ELSE
    SELECT
      COUNT(DISTINCT index_name),
      COALESCE(MIN(non_unique), 1),
      COALESCE(MIN(is_visible), 'NO'),
      COALESCE(GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ','), '')
      INTO replacement_count, index_non_unique, replacement_visible, replacement_columns
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND index_name = 'bd_rule_partition_date_bill_no_uq';

    IF replacement_count <> 1
       OR index_non_unique <> 0
       OR replacement_visible <> 'YES'
       OR replacement_columns <> 'rule_id,partition_date,bill_date,bill_no' THEN
      SET error_text = CONCAT('archive business unique index is missing or invalid: ', target_table_name);
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_text;
    END IF;
  END IF;

  -- Candidate 1: bd_order_file_idx is covered by the left prefix of
  -- bd_order_rec_item_idx.
  SELECT
    COUNT(DISTINCT index_name),
    COALESCE(MIN(is_visible), 'NO'),
    COALESCE(GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ','), '')
    INTO index_count, index_visible, index_columns
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = target_table_name
    AND index_name = 'bd_order_file_idx';

  IF index_count > 0 THEN
    IF index_count <> 1 OR index_columns <> 'order_file_id' THEN
      SET error_text = CONCAT('unexpected bd_order_file_idx definition: ', target_table_name);
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_text;
    END IF;

    SELECT
      COUNT(DISTINCT index_name),
      COALESCE(MIN(is_visible), 'NO'),
      COALESCE(GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ','), '')
      INTO replacement_count, replacement_visible, replacement_columns
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND index_name = 'bd_order_rec_item_idx';

    IF replacement_count <> 1
       OR replacement_visible <> 'YES'
       OR replacement_columns <> 'order_file_id,match_status,match_result_id,rule_item_id' THEN
      SET error_text = CONCAT('bd_order_file_idx replacement is missing or invalid: ', target_table_name);
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_text;
    END IF;

    IF finalize_drop = 1 THEN
      IF index_visible = 'YES' AND allow_visible_drop <> 1 THEN
        SET error_text = CONCAT('bd_order_file_idx is still visible; canary is incomplete: ', target_table_name);
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_text;
      END IF;
      SET @archive_index_ddl = CONCAT(
        'ALTER TABLE `', REPLACE(target_table_name, '`', '``'),
        '` DROP INDEX `bd_order_file_idx`, ALGORITHM=INPLACE, LOCK=NONE'
      );
      PREPARE archive_index_stmt FROM @archive_index_ddl;
      EXECUTE archive_index_stmt;
      DEALLOCATE PREPARE archive_index_stmt;
    ELSEIF index_visible = 'YES' THEN
      SET @archive_index_ddl = CONCAT(
        'ALTER TABLE `', REPLACE(target_table_name, '`', '``'),
        '` ALTER INDEX `bd_order_file_idx` INVISIBLE'
      );
      PREPARE archive_index_stmt FROM @archive_index_ddl;
      EXECUTE archive_index_stmt;
      DEALLOCATE PREPARE archive_index_stmt;
    END IF;
  END IF;

  -- Candidate 2: archived task maintenance only needs task_id; retain the
  -- narrower bd_task_idx and remove the hot-table task/status composite index.
  SELECT
    COUNT(DISTINCT index_name),
    COALESCE(MIN(is_visible), 'NO'),
    COALESCE(GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ','), '')
    INTO index_count, index_visible, index_columns
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = target_table_name
    AND index_name = 'bd_task_status_idx';

  IF index_count > 0 THEN
    IF index_count <> 1 OR index_columns <> 'task_id,match_status' THEN
      SET error_text = CONCAT('unexpected bd_task_status_idx definition: ', target_table_name);
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_text;
    END IF;

    SELECT
      COUNT(DISTINCT index_name),
      COALESCE(MIN(is_visible), 'NO'),
      COALESCE(GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ','), '')
      INTO replacement_count, replacement_visible, replacement_columns
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND index_name = 'bd_task_idx';

    IF replacement_count <> 1
       OR replacement_visible <> 'YES'
       OR replacement_columns <> 'task_id' THEN
      SET error_text = CONCAT('bd_task_status_idx replacement is missing or invalid: ', target_table_name);
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_text;
    END IF;

    IF finalize_drop = 1 THEN
      IF index_visible = 'YES' AND allow_visible_drop <> 1 THEN
        SET error_text = CONCAT('bd_task_status_idx is still visible; canary is incomplete: ', target_table_name);
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_text;
      END IF;
      SET @archive_index_ddl = CONCAT(
        'ALTER TABLE `', REPLACE(target_table_name, '`', '``'),
        '` DROP INDEX `bd_task_status_idx`, ALGORITHM=INPLACE, LOCK=NONE'
      );
      PREPARE archive_index_stmt FROM @archive_index_ddl;
      EXECUTE archive_index_stmt;
      DEALLOCATE PREPARE archive_index_stmt;
    ELSEIF index_visible = 'YES' THEN
      SET @archive_index_ddl = CONCAT(
        'ALTER TABLE `', REPLACE(target_table_name, '`', '``'),
        '` ALTER INDEX `bd_task_status_idx` INVISIBLE'
      );
      PREPARE archive_index_stmt FROM @archive_index_ddl;
      EXECUTE archive_index_stmt;
      DEALLOCATE PREPARE archive_index_stmt;
    END IF;
  END IF;

  -- Candidate 3: the rule/detail-split/status composite index serves hot-table
  -- recognition execution. Archive reads retain the dedicated detail split
  -- index and the partition/rule/status index.
  SELECT
    COUNT(DISTINCT index_name),
    COALESCE(MIN(is_visible), 'NO'),
    COALESCE(GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ','), '')
    INTO index_count, index_visible, index_columns
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = target_table_name
    AND index_name = 'bd_rule_detail_split_status_idx';

  IF index_count > 0 THEN
    IF index_count <> 1
       OR index_columns <> 'rule_id,detail_split_file_id,match_status,match_result_id' THEN
      SET error_text = CONCAT('unexpected bd_rule_detail_split_status_idx definition: ', target_table_name);
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_text;
    END IF;

    SELECT
      COUNT(DISTINCT index_name),
      COALESCE(MIN(is_visible), 'NO'),
      COALESCE(GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ','), '')
      INTO replacement_count, replacement_visible, replacement_columns
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND index_name = 'bd_detail_split_file_idx';

    IF replacement_count <> 1
       OR replacement_visible <> 'YES'
       OR replacement_columns <> 'detail_split_file_id' THEN
      SET error_text = CONCAT('detail split archive index is missing or invalid: ', target_table_name);
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_text;
    END IF;

    SELECT
      COUNT(DISTINCT index_name),
      COALESCE(MIN(is_visible), 'NO'),
      COALESCE(GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ','), '')
      INTO replacement_count, replacement_visible, replacement_columns
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND index_name = 'bd_partition_status_idx';

    IF replacement_count <> 1
       OR replacement_visible <> 'YES'
       OR replacement_columns <> 'partition_date,rule_id,operation_status,match_status' THEN
      SET error_text = CONCAT('partition/status archive index is missing or invalid: ', target_table_name);
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_text;
    END IF;

    IF finalize_drop = 1 THEN
      IF index_visible = 'YES' AND allow_visible_drop <> 1 THEN
        SET error_text = CONCAT('bd_rule_detail_split_status_idx is still visible; canary is incomplete: ', target_table_name);
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_text;
      END IF;
      SET @archive_index_ddl = CONCAT(
        'ALTER TABLE `', REPLACE(target_table_name, '`', '``'),
        '` DROP INDEX `bd_rule_detail_split_status_idx`, ALGORITHM=INPLACE, LOCK=NONE'
      );
      PREPARE archive_index_stmt FROM @archive_index_ddl;
      EXECUTE archive_index_stmt;
      DEALLOCATE PREPARE archive_index_stmt;
    ELSEIF index_visible = 'YES' THEN
      SET @archive_index_ddl = CONCAT(
        'ALTER TABLE `', REPLACE(target_table_name, '`', '``'),
        '` ALTER INDEX `bd_rule_detail_split_status_idx` INVISIBLE'
      );
      PREPARE archive_index_stmt FROM @archive_index_ddl;
      EXECUTE archive_index_stmt;
      DEALLOCATE PREPARE archive_index_stmt;
    END IF;
  END IF;

  SET @archive_index_ddl = NULL;
END//
DELIMITER ;

DROP PROCEDURE IF EXISTS prepare_bill_details_archive_index_canary_v1048;

DELIMITER //
CREATE PROCEDURE prepare_bill_details_archive_index_canary_v1048()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE target_table_name VARCHAR(64);
  DECLARE archive_table_count INT DEFAULT 0;
  DECLARE candidate_index_count INT DEFAULT 0;

  DECLARE table_cursor CURSOR FOR
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name REGEXP '^bill_details_archive_[0-9]{6}$'
    ORDER BY table_name;

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  SELECT COUNT(*)
    INTO archive_table_count
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name REGEXP '^bill_details_archive_[0-9]{6}$';

  IF archive_table_count = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'no monthly bill details archive tables found';
  END IF;

  -- Prevent an out-of-order canary rerun from replacing the finalized future
  -- table procedure after every candidate index has already been removed.
  SELECT COUNT(DISTINCT CONCAT(table_name, ':', index_name))
    INTO candidate_index_count
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name REGEXP '^bill_details_archive_[0-9]{6}$'
    AND index_name IN (
      'bd_order_file_idx',
      'bd_task_status_idx',
      'bd_rule_detail_split_status_idx'
    );

  IF candidate_index_count = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'archive index finalization may already be complete; do not rerun canary';
  END IF;

  OPEN table_cursor;
  read_loop: LOOP
    FETCH table_cursor INTO target_table_name;
    IF done = 1 THEN
      LEAVE read_loop;
    END IF;
    CALL normalize_bill_details_archive_indexes_v1048(target_table_name, 0, 0);
  END LOOP;
  CLOSE table_cursor;
END//
DELIMITER ;

CALL prepare_bill_details_archive_index_canary_v1048();
DROP PROCEDURE IF EXISTS prepare_bill_details_archive_index_canary_v1048;

-- Replace only the month-table factory. The rolling partition and archive
-- procedures continue calling this stable routine name.
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

    CALL normalize_bill_details_archive_indexes_v1048(archive_table_name, 0, 0);

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
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = DATABASE()
  AND routine_name IN (
    'normalize_bill_details_archive_indexes_v1048',
    'ensure_bill_details_archive_month_table'
  )
ORDER BY routine_name;
