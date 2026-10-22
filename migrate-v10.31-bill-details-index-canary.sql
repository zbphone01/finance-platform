-- v10.31: bill_details index canary.
-- 1. Add a shadow unique index whose leading columns match the historical
--    cross-partition de-duplication lookup: rule_id + bill_date + bill_no.
-- 2. Make four candidate indexes invisible on the hot table and existing
--    monthly archive tables. Invisible indexes remain stored and maintained;
--    this migration does not reclaim index space.

DROP PROCEDURE IF EXISTS prepare_bill_details_index_canary;

DELIMITER //
CREATE PROCEDURE prepare_bill_details_index_canary()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE target_table_name VARCHAR(128);
  DECLARE index_count INT DEFAULT 0;
  DECLARE visible_count INT DEFAULT 0;

  DECLARE table_cursor CURSOR FOR
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND (
        table_name = 'bill_details'
        OR table_name REGEXP '^bill_details_archive_[0-9]{6}$'
      )
    ORDER BY CASE WHEN table_name = 'bill_details' THEN 0 ELSE 1 END, table_name;

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  SELECT COUNT(*) INTO index_count
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_details'
    AND index_name = 'bd_rule_bill_date_bill_no_partition_uq';

  IF index_count = 0 THEN
    ALTER TABLE bill_details
      ADD UNIQUE INDEX bd_rule_bill_date_bill_no_partition_uq
        (rule_id, bill_date, bill_no, partition_date),
      ALGORITHM = INPLACE,
      LOCK = NONE;
  END IF;

  OPEN table_cursor;

  read_loop: LOOP
    FETCH table_cursor INTO target_table_name;
    IF done = 1 THEN
      LEAVE read_loop;
    END IF;

    SELECT COUNT(*), COUNT(DISTINCT CASE WHEN is_visible = 'YES' THEN index_name END)
      INTO index_count, visible_count
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND index_name = 'bd_status_idx';
    IF index_count > 0 AND visible_count > 0 THEN
      SET @ddl = CONCAT('ALTER TABLE `', REPLACE(target_table_name, '`', '``'), '` ALTER INDEX `bd_status_idx` INVISIBLE');
      PREPARE stmt FROM @ddl;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;

    SELECT COUNT(*), COUNT(DISTINCT CASE WHEN is_visible = 'YES' THEN index_name END)
      INTO index_count, visible_count
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND index_name = 'bd_original_task_idx';
    IF index_count > 0 AND visible_count > 0 THEN
      SET @ddl = CONCAT('ALTER TABLE `', REPLACE(target_table_name, '`', '``'), '` ALTER INDEX `bd_original_task_idx` INVISIBLE');
      PREPARE stmt FROM @ddl;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;

    SELECT COUNT(*), COUNT(DISTINCT CASE WHEN is_visible = 'YES' THEN index_name END)
      INTO index_count, visible_count
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND index_name = 'bd_lifecycle_package_idx';
    IF index_count > 0 AND visible_count > 0 THEN
      SET @ddl = CONCAT('ALTER TABLE `', REPLACE(target_table_name, '`', '``'), '` ALTER INDEX `bd_lifecycle_package_idx` INVISIBLE');
      PREPARE stmt FROM @ddl;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;

    SELECT COUNT(*), COUNT(DISTINCT CASE WHEN is_visible = 'YES' THEN index_name END)
      INTO index_count, visible_count
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND index_name = 'bd_operation_partition_idx';
    IF index_count > 0 AND visible_count > 0 THEN
      SET @ddl = CONCAT('ALTER TABLE `', REPLACE(target_table_name, '`', '``'), '` ALTER INDEX `bd_operation_partition_idx` INVISIBLE');
      PREPARE stmt FROM @ddl;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;
  END LOOP;

  CLOSE table_cursor;
  SET @ddl = NULL;
END//
DELIMITER ;

CALL prepare_bill_details_index_canary();

DROP PROCEDURE IF EXISTS prepare_bill_details_index_canary;

SELECT
  table_name,
  index_name,
  MIN(is_visible) AS is_visible,
  GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ',') AS index_columns
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND (
    table_name = 'bill_details'
    OR table_name REGEXP '^bill_details_archive_[0-9]{6}$'
  )
  AND index_name IN (
    'bd_rule_partition_date_bill_no_uq',
    'bd_rule_bill_date_bill_no_partition_uq',
    'bd_status_idx',
    'bd_original_task_idx',
    'bd_lifecycle_package_idx',
    'bd_operation_partition_idx'
  )
GROUP BY table_name, index_name
ORDER BY CASE WHEN table_name = 'bill_details' THEN 0 ELSE 1 END, table_name, index_name;
