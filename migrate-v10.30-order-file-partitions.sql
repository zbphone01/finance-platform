-- v10.30: Replace detail-level locator reads with file-level partition locator.
-- The new table keeps one row per order_file_id + partition_date, greatly reducing locator volume.

CREATE TABLE IF NOT EXISTS order_file_partitions (
  order_file_id BIGINT UNSIGNED NOT NULL,
  partition_date DATE NOT NULL,
  detail_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ofp_pk PRIMARY KEY (order_file_id, partition_date),
  KEY ofp_partition_date_idx (partition_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS rebuild_order_file_partitions_v1030;

DELIMITER //
CREATE PROCEDURE rebuild_order_file_partitions_v1030()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE target_table_name VARCHAR(128);

  DECLARE table_cursor CURSOR FOR
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND (
        table_name = 'bill_details'
        OR table_name LIKE 'bill\_details\_archive\_%'
      )
    ORDER BY CASE WHEN table_name = 'bill_details' THEN 0 ELSE 1 END, table_name;

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  DELETE FROM order_file_partitions;

  OPEN table_cursor;

  read_loop: LOOP
    FETCH table_cursor INTO target_table_name;
    IF done = 1 THEN
      LEAVE read_loop;
    END IF;

    SET @ddl = CONCAT(
      'INSERT INTO order_file_partitions (order_file_id, partition_date, detail_count, updated_at) ',
      'SELECT order_file_id, partition_date, COUNT(*), NOW() ',
      'FROM `', REPLACE(target_table_name, '`', '``'), '` ',
      'WHERE order_file_id IS NOT NULL ',
      'AND detail_split_file_id IS NULL ',
      'GROUP BY order_file_id, partition_date ',
      'ON DUPLICATE KEY UPDATE ',
      'detail_count = detail_count + VALUES(detail_count), ',
      'updated_at = NOW()'
    );
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END LOOP;

  CLOSE table_cursor;
END//
DELIMITER ;

CALL rebuild_order_file_partitions_v1030();

DROP PROCEDURE IF EXISTS rebuild_order_file_partitions_v1030;
