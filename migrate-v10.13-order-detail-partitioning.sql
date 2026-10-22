-- v10.13: Prepare bill_details for 90-day daily partitions plus monthly archive partitions.
-- Run during a maintenance window. bill_details can be very large and the ALTER/PARTITION steps rebuild the table.

ALTER TABLE bill_details
  ADD COLUMN order_date DATE NULL AFTER bill_date,
  ADD COLUMN recognition_date DATE NULL AFTER order_date,
  ADD COLUMN partition_date DATE NOT NULL DEFAULT '1970-01-01' AFTER recognition_date,
  ADD COLUMN lifecycle_status ENUM('normal', 'unmatched_package', 'archived') NOT NULL DEFAULT 'normal' AFTER operation_status,
  ADD COLUMN original_recognition_date DATE NULL AFTER original_task_id;

UPDATE bill_details bd
LEFT JOIN order_files ofl ON ofl.id = bd.order_file_id
SET
  bd.order_date = CASE
    WHEN bd.detail_split_file_id IS NOT NULL AND bd.order_file_id IS NULL THEN NULL
    WHEN COALESCE(ofl.detail_package_type, 'T+1') = '打包明细' THEN NULL
    WHEN bd.bill_date = '1970-01-01' THEN NULL
    ELSE bd.bill_date
  END,
  bd.recognition_date = CASE
    WHEN bd.detail_split_file_id IS NOT NULL AND bd.order_file_id IS NULL THEN NULL
    WHEN COALESCE(ofl.detail_package_type, 'T+1') = '打包明细'
      THEN CASE
        WHEN ofl.upload_date REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          THEN CAST(ofl.upload_date AS DATE)
        ELSE NULL
      END
    WHEN bd.bill_date = '1970-01-01' THEN NULL
    ELSE DATE_ADD(bd.bill_date, INTERVAL 1 DAY)
  END,
  bd.partition_date = CASE
    WHEN bd.detail_split_file_id IS NOT NULL AND bd.order_file_id IS NULL THEN '1970-01-01'
    WHEN COALESCE(ofl.detail_package_type, 'T+1') = '打包明细'
      THEN CASE
        WHEN ofl.upload_date REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          THEN CAST(ofl.upload_date AS DATE)
        ELSE '1970-01-01'
      END
    WHEN bd.bill_date = '1970-01-01' THEN '1970-01-01'
    ELSE DATE_ADD(bd.bill_date, INTERVAL 1 DAY)
  END,
  bd.lifecycle_status = CASE
    WHEN bd.detail_split_file_id IS NOT NULL AND bd.order_file_id IS NULL THEN 'unmatched_package'
    WHEN COALESCE(ofl.detail_package_type, 'T+1') = '打包明细'
      AND (ofl.upload_date IS NULL OR ofl.upload_date = '' OR bd.task_id = 0)
      THEN 'unmatched_package'
    WHEN bd.bill_date = '1970-01-01' AND bd.task_id = 0 THEN 'unmatched_package'
    ELSE 'normal'
  END;

CREATE TABLE bill_detail_locator (
  detail_id BIGINT UNSIGNED NOT NULL,
  partition_date DATE NOT NULL,
  recognition_date DATE NULL,
  order_file_id BIGINT UNSIGNED NULL,
  task_id BIGINT UNSIGNED NULL,
  lifecycle_status ENUM('normal', 'unmatched_package', 'archived') NOT NULL DEFAULT 'normal',
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (detail_id),
  KEY bdl_partition_detail_idx (partition_date, detail_id),
  KEY bdl_recognition_lifecycle_idx (recognition_date, lifecycle_status),
  KEY bdl_order_file_idx (order_file_id),
  KEY bdl_task_idx (task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO bill_detail_locator (
  detail_id,
  partition_date,
  recognition_date,
  order_file_id,
  task_id,
  lifecycle_status,
  updated_at
)
SELECT
  id,
  partition_date,
  recognition_date,
  order_file_id,
  task_id,
  lifecycle_status,
  NOW()
FROM bill_details;

ALTER TABLE bill_details
  DROP PRIMARY KEY,
  DROP INDEX id,
  DROP INDEX bd_rule_date_bill_no_uq,
  ADD PRIMARY KEY (id, partition_date),
  ADD UNIQUE KEY bd_rule_partition_date_bill_no_uq (rule_id, partition_date, bill_date, bill_no),
  ADD KEY bd_rule_order_date_bill_no_idx (rule_id, order_date, bill_no),
  ADD KEY bd_recognition_date_idx (recognition_date),
  ADD KEY bd_partition_rec_status_idx (partition_date, recognition_date, rule_id, operation_status, match_status),
  ADD KEY bd_lifecycle_package_idx (lifecycle_status, created_at),
  ADD KEY bd_operation_recognition_idx (operation_status, recognition_date, id);

DROP PROCEDURE IF EXISTS repartition_bill_details_v1013;

DELIMITER //
CREATE PROCEDURE repartition_bill_details_v1013()
BEGIN
  DECLARE hot_start DATE;
  DECLARE future_end DATE;
  DECLARE month_cursor DATE;
  DECLARE hot_month_start DATE;
  DECLARE day_cursor DATE;
  DECLARE min_archive_date DATE;
  DECLARE partition_sql LONGTEXT;
  DECLARE is_partitioned INT DEFAULT 0;

  SELECT COUNT(*)
    INTO is_partitioned
  FROM information_schema.partitions
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_details'
    AND partition_name IS NOT NULL;

  IF is_partitioned = 0 THEN
    SET hot_start = DATE_SUB(CURDATE(), INTERVAL 89 DAY);
    SET hot_month_start = STR_TO_DATE(DATE_FORMAT(hot_start, '%Y-%m-01'), '%Y-%m-%d');
    SET future_end = DATE_ADD(CURDATE(), INTERVAL 60 DAY);

    SELECT MIN(partition_date)
      INTO min_archive_date
    FROM bill_details
    WHERE partition_date >= '1970-01-02'
      AND partition_date < hot_start;

    SET partition_sql = 'ALTER TABLE bill_details PARTITION BY RANGE COLUMNS(partition_date) (PARTITION p_unmatched VALUES LESS THAN (''1970-01-02'')';

    IF min_archive_date IS NOT NULL THEN
      SET month_cursor = STR_TO_DATE(DATE_FORMAT(min_archive_date, '%Y-%m-01'), '%Y-%m-%d');
      WHILE month_cursor < hot_month_start DO
        SET partition_sql = CONCAT(
          partition_sql,
          ', PARTITION p',
          DATE_FORMAT(month_cursor, '%Y'),
          'm',
          DATE_FORMAT(month_cursor, '%m'),
          ' VALUES LESS THAN (''',
          DATE_FORMAT(DATE_ADD(month_cursor, INTERVAL 1 MONTH), '%Y-%m-%d'),
          ''')'
        );
        SET month_cursor = DATE_ADD(month_cursor, INTERVAL 1 MONTH);
      END WHILE;
      IF month_cursor < hot_start THEN
        SET partition_sql = CONCAT(
          partition_sql,
          ', PARTITION p',
          DATE_FORMAT(month_cursor, '%Y'),
          'm',
          DATE_FORMAT(month_cursor, '%m'),
          '_tail VALUES LESS THAN (''',
          DATE_FORMAT(hot_start, '%Y-%m-%d'),
          ''')'
        );
      END IF;
    END IF;

    SET day_cursor = hot_start;
    WHILE day_cursor <= future_end DO
      SET partition_sql = CONCAT(
        partition_sql,
        ', PARTITION p',
        DATE_FORMAT(day_cursor, '%Y%m%d'),
        ' VALUES LESS THAN (''',
        DATE_FORMAT(DATE_ADD(day_cursor, INTERVAL 1 DAY), '%Y-%m-%d'),
        ''')'
      );
      SET day_cursor = DATE_ADD(day_cursor, INTERVAL 1 DAY);
    END WHILE;

    SET partition_sql = CONCAT(partition_sql, ', PARTITION p_future VALUES LESS THAN (MAXVALUE))');

    SET @sql = partition_sql;
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//
DELIMITER ;

CALL repartition_bill_details_v1013();

DROP PROCEDURE IF EXISTS repartition_bill_details_v1013;
