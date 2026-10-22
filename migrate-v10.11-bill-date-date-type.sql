-- v10.11: Convert bill_date columns from VARCHAR(20) to DATE.
-- Run during a maintenance window; bill_details can be large and the ALTER may rebuild the table.

DROP PROCEDURE IF EXISTS validate_bill_date_date_type_migration;

DELIMITER //
CREATE PROCEDURE validate_bill_date_date_type_migration()
BEGIN
  IF EXISTS (
    SELECT 1 FROM recognition_tasks
    WHERE bill_date IS NULL
      OR bill_date NOT REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR STR_TO_DATE(bill_date, '%Y-%m-%d') IS NULL
      OR DATE_FORMAT(STR_TO_DATE(bill_date, '%Y-%m-%d'), '%Y-%m-%d') <> bill_date
    LIMIT 1
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'recognition_tasks.bill_date contains invalid values';
  END IF;

  IF EXISTS (
    SELECT 1 FROM recognition_date_summaries
    WHERE bill_date IS NULL
      OR bill_date NOT REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR STR_TO_DATE(bill_date, '%Y-%m-%d') IS NULL
      OR DATE_FORMAT(STR_TO_DATE(bill_date, '%Y-%m-%d'), '%Y-%m-%d') <> bill_date
    LIMIT 1
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'recognition_date_summaries.bill_date contains invalid values';
  END IF;

  IF EXISTS (
    SELECT 1 FROM bill_details
    WHERE bill_date IS NULL
      OR bill_date NOT REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR STR_TO_DATE(bill_date, '%Y-%m-%d') IS NULL
      OR DATE_FORMAT(STR_TO_DATE(bill_date, '%Y-%m-%d'), '%Y-%m-%d') <> bill_date
    LIMIT 1
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'bill_details.bill_date contains invalid values';
  END IF;
END//
DELIMITER ;

CALL validate_bill_date_date_type_migration();

ALTER TABLE recognition_tasks
  MODIFY COLUMN bill_date DATE NOT NULL;

ALTER TABLE recognition_date_summaries
  MODIFY COLUMN bill_date DATE NOT NULL;

ALTER TABLE bill_details
  MODIFY COLUMN bill_date DATE NOT NULL;

DROP PROCEDURE IF EXISTS validate_bill_date_date_type_migration;
