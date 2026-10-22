-- v10.28: 删除订单明细冗余字段
-- 订单原始日期继续使用 bill_details.bill_date；可认账/到账归属日期和分区日期统一使用 partition_date。
-- 订单明细金额只保留 total_amount；数量、单价、税额、对手方、分类、匹配入账户名等原始/冗余信息如需排查，继续从 raw_data 或订单文件读取。
-- 本迁移会处理主表 bill_details、所有已存在的 bill_details_archive_YYYYMM 归档表，以及 bill_detail_locator。

DROP PROCEDURE IF EXISTS drop_bill_details_redundant_columns;

DELIMITER //
CREATE PROCEDURE drop_bill_details_redundant_columns()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE target_table_name VARCHAR(128);
  DECLARE index_count INT DEFAULT 0;
  DECLARE column_count INT DEFAULT 0;

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
      AND index_name = 'bd_rule_order_date_bill_no_idx';
    IF index_count > 0 THEN
      SET @ddl = CONCAT('ALTER TABLE `', REPLACE(target_table_name, '`', '``'), '` DROP INDEX `bd_rule_order_date_bill_no_idx`');
      PREPARE stmt FROM @ddl;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;

    SELECT COUNT(*) INTO index_count
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND index_name = 'bd_recognition_date_idx';
    IF index_count > 0 THEN
      SET @ddl = CONCAT('ALTER TABLE `', REPLACE(target_table_name, '`', '``'), '` DROP INDEX `bd_recognition_date_idx`');
      PREPARE stmt FROM @ddl;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;

    SELECT COUNT(*) INTO index_count
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND index_name = 'bd_partition_rec_status_idx';
    IF index_count > 0 THEN
      SET @ddl = CONCAT('ALTER TABLE `', REPLACE(target_table_name, '`', '``'), '` DROP INDEX `bd_partition_rec_status_idx`');
      PREPARE stmt FROM @ddl;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;

    SELECT COUNT(*) INTO index_count
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND index_name = 'bd_operation_recognition_idx';
    IF index_count > 0 THEN
      SET @ddl = CONCAT('ALTER TABLE `', REPLACE(target_table_name, '`', '``'), '` DROP INDEX `bd_operation_recognition_idx`');
      PREPARE stmt FROM @ddl;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;

    SELECT COUNT(*) INTO index_count
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND index_name = 'bd_amount_idx';
    IF index_count > 0 THEN
      SET @ddl = CONCAT('ALTER TABLE `', REPLACE(target_table_name, '`', '``'), '` DROP INDEX `bd_amount_idx`');
      PREPARE stmt FROM @ddl;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;

    SELECT COUNT(*) INTO column_count
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND column_name = 'order_date';
    IF column_count > 0 THEN
      SET @ddl = CONCAT('ALTER TABLE `', REPLACE(target_table_name, '`', '``'), '` DROP COLUMN `order_date`');
      PREPARE stmt FROM @ddl;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;

    SELECT COUNT(*) INTO column_count
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND column_name = 'recognition_date';
    IF column_count > 0 THEN
      SET @ddl = CONCAT('ALTER TABLE `', REPLACE(target_table_name, '`', '``'), '` DROP COLUMN `recognition_date`');
      PREPARE stmt FROM @ddl;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;

    SELECT COUNT(*) INTO column_count
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND column_name = 'amount';
    IF column_count > 0 THEN
      SET @ddl = CONCAT('ALTER TABLE `', REPLACE(target_table_name, '`', '``'), '` DROP COLUMN `amount`');
      PREPARE stmt FROM @ddl;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;

    SELECT COUNT(*) INTO column_count
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND column_name = 'quantity';
    IF column_count > 0 THEN
      SET @ddl = CONCAT('ALTER TABLE `', REPLACE(target_table_name, '`', '``'), '` DROP COLUMN `quantity`');
      PREPARE stmt FROM @ddl;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;

    SELECT COUNT(*) INTO column_count
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND column_name = 'unit_price';
    IF column_count > 0 THEN
      SET @ddl = CONCAT('ALTER TABLE `', REPLACE(target_table_name, '`', '``'), '` DROP COLUMN `unit_price`');
      PREPARE stmt FROM @ddl;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;

    SELECT COUNT(*) INTO column_count
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND column_name = 'tax_amount';
    IF column_count > 0 THEN
      SET @ddl = CONCAT('ALTER TABLE `', REPLACE(target_table_name, '`', '``'), '` DROP COLUMN `tax_amount`');
      PREPARE stmt FROM @ddl;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;

    SELECT COUNT(*) INTO column_count
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND column_name = 'counterparty';
    IF column_count > 0 THEN
      SET @ddl = CONCAT('ALTER TABLE `', REPLACE(target_table_name, '`', '``'), '` DROP COLUMN `counterparty`');
      PREPARE stmt FROM @ddl;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;

    SELECT COUNT(*) INTO column_count
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND column_name = 'category';
    IF column_count > 0 THEN
      SET @ddl = CONCAT('ALTER TABLE `', REPLACE(target_table_name, '`', '``'), '` DROP COLUMN `category`');
      PREPARE stmt FROM @ddl;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;

    SELECT COUNT(*) INTO column_count
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND column_name = 'matched_account_name';
    IF column_count > 0 THEN
      SET @ddl = CONCAT('ALTER TABLE `', REPLACE(target_table_name, '`', '``'), '` DROP COLUMN `matched_account_name`');
      PREPARE stmt FROM @ddl;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;

    SELECT COUNT(*) INTO index_count
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND index_name = 'bd_partition_status_idx';
    IF index_count = 0 THEN
      SET @ddl = CONCAT(
        'ALTER TABLE `',
        REPLACE(target_table_name, '`', '``'),
        '` ADD INDEX `bd_partition_status_idx` (`partition_date`, `rule_id`, `operation_status`, `match_status`)'
      );
      PREPARE stmt FROM @ddl;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;

    SELECT COUNT(*) INTO index_count
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = target_table_name
      AND index_name = 'bd_operation_partition_idx';
    IF index_count = 0 THEN
      SET @ddl = CONCAT(
        'ALTER TABLE `',
        REPLACE(target_table_name, '`', '``'),
        '` ADD INDEX `bd_operation_partition_idx` (`operation_status`, `partition_date`, `id`)'
      );
      PREPARE stmt FROM @ddl;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;
  END LOOP;

  CLOSE table_cursor;

  SELECT COUNT(*) INTO index_count
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_detail_locator'
    AND index_name = 'bdl_recognition_lifecycle_idx';
  IF index_count > 0 THEN
    ALTER TABLE bill_detail_locator DROP INDEX bdl_recognition_lifecycle_idx;
  END IF;

  SELECT COUNT(*) INTO column_count
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_detail_locator'
    AND column_name = 'recognition_date';
  IF column_count > 0 THEN
    ALTER TABLE bill_detail_locator DROP COLUMN recognition_date;
  END IF;

  SELECT COUNT(*) INTO index_count
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_detail_locator'
    AND index_name = 'bdl_partition_lifecycle_idx';
  IF index_count = 0 THEN
    ALTER TABLE bill_detail_locator ADD INDEX bdl_partition_lifecycle_idx (partition_date, lifecycle_status);
  END IF;

  SET @ddl = NULL;
END//
DELIMITER ;

CALL drop_bill_details_redundant_columns();

DROP PROCEDURE IF EXISTS drop_bill_details_redundant_columns;
