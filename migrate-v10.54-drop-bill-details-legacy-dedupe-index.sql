-- v10.54：删除 bill_details 主表已完成灰度验证的旧去重唯一索引。
--
-- 安全约束：
-- 1. 只处理主表 bill_details，不修改任何 bill_details_archive_YYYYMM 归档表。
-- 2. 删除前必须确认新唯一索引存在、可见且列顺序正确。
-- 3. 旧索引已经不存在时直接跳过，可重复执行。

DROP PROCEDURE IF EXISTS migrate_v10_54_drop_bill_details_legacy_dedupe_index;

DELIMITER //

CREATE PROCEDURE migrate_v10_54_drop_bill_details_legacy_dedupe_index()
BEGIN
  DECLARE v_table_count INT DEFAULT 0;
  DECLARE v_new_index_columns INT DEFAULT 0;
  DECLARE v_new_index_matching_columns INT DEFAULT 0;
  DECLARE v_new_index_visible_columns INT DEFAULT 0;
  DECLARE v_old_index_columns INT DEFAULT 0;

  SELECT COUNT(*)
    INTO v_table_count
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_details'
    AND table_type = 'BASE TABLE';

  IF v_table_count <> 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'v10.54 migration aborted: bill_details table is missing';
  END IF;

  SELECT
    COUNT(*),
    SUM(
      CASE
        WHEN (seq_in_index = 1 AND column_name = 'rule_id')
          OR (seq_in_index = 2 AND column_name = 'bill_date')
          OR (seq_in_index = 3 AND column_name = 'bill_no')
          OR (seq_in_index = 4 AND column_name = 'partition_date')
        THEN 1
        ELSE 0
      END
    ),
    SUM(CASE WHEN is_visible = 'YES' THEN 1 ELSE 0 END)
    INTO
      v_new_index_columns,
      v_new_index_matching_columns,
      v_new_index_visible_columns
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_details'
    AND index_name = 'bd_rule_bill_date_bill_no_partition_uq'
    AND non_unique = 0;

  IF v_new_index_columns <> 4
    OR v_new_index_matching_columns <> 4
    OR v_new_index_visible_columns <> 4 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'v10.54 migration aborted: replacement unique index is missing, invisible, or has an unexpected definition';
  END IF;

  SELECT COUNT(*)
    INTO v_old_index_columns
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_details'
    AND index_name = 'bd_rule_partition_date_bill_no_uq';

  IF v_old_index_columns > 0 THEN
    ALTER TABLE bill_details
      DROP INDEX bd_rule_partition_date_bill_no_uq,
      ALGORITHM = INPLACE,
      LOCK = NONE;
  END IF;
END//

DELIMITER ;

CALL migrate_v10_54_drop_bill_details_legacy_dedupe_index();
DROP PROCEDURE migrate_v10_54_drop_bill_details_legacy_dedupe_index;

SELECT
  index_name,
  non_unique,
  seq_in_index,
  column_name,
  is_visible
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'bill_details'
  AND index_name IN (
    'bd_rule_partition_date_bill_no_uq',
    'bd_rule_bill_date_bill_no_partition_uq'
  )
ORDER BY index_name, seq_in_index;
