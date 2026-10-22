-- v10.29: Drop unused bill_details description index.
-- 条件认账规则的关键字字段和关键字均为必填，description 不再作为自动认账主查询路径。

DROP PROCEDURE IF EXISTS drop_bill_details_desc_idx;

DELIMITER //
CREATE PROCEDURE drop_bill_details_desc_idx()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE target_table_name VARCHAR(128);
  DECLARE index_count INT DEFAULT 0;

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

  OPEN table_cursor;

  read_loop: LOOP
    FETCH table_cursor INTO target_table_name;
    IF done = 1 THEN
      LEAVE read_loop;
    END IF;

    SELECT COUNT(*) INTO index_count
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND index_name = 'bd_desc_idx';

    IF index_count > 0 THEN
      SET @ddl = CONCAT('ALTER TABLE `', REPLACE(target_table_name, '`', '``'), '` DROP INDEX `bd_desc_idx`');
      PREPARE stmt FROM @ddl;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;
  END LOOP;

  CLOSE table_cursor;
END//
DELIMITER ;

CALL drop_bill_details_desc_idx();

DROP PROCEDURE IF EXISTS drop_bill_details_desc_idx;
