-- v10.37: 订单明细包的条数、收入和退款固定为上传成功后的入库快照。
-- 忽略、转移、认账和明细分账等后续业务操作不再改写这些字段。
-- 本迁移不新增字段，只从热表和归档表重建历史上传快照。

DROP PROCEDURE IF EXISTS rebuild_order_file_upload_snapshots_v1037;

DELIMITER //
CREATE PROCEDURE rebuild_order_file_upload_snapshots_v1037()
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

  DROP TEMPORARY TABLE IF EXISTS tmp_order_file_upload_snapshots_v1037;
  CREATE TEMPORARY TABLE tmp_order_file_upload_snapshots_v1037 (
    order_file_id BIGINT UNSIGNED NOT NULL,
    entry_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    order_total_amount DECIMAL(38,2) NOT NULL DEFAULT 0.00,
    refund_amount DECIMAL(38,2) NOT NULL DEFAULT 0.00,
    PRIMARY KEY (order_file_id)
  ) ENGINE=InnoDB;

  OPEN table_cursor;

  read_loop: LOOP
    FETCH table_cursor INTO target_table_name;
    IF done = 1 THEN
      LEAVE read_loop;
    END IF;

    SET @snapshot_sql = CONCAT(
      'INSERT INTO tmp_order_file_upload_snapshots_v1037 ',
      '(order_file_id, entry_count, order_total_amount, refund_amount) ',
      'SELECT order_file_id, COUNT(*), ',
      'COALESCE(SUM(CASE ',
      'WHEN CAST(refund_amount_snapshot AS DECIMAL(18,2)) > 0 THEN 0.00 ',
      'ELSE CAST(total_amount AS DECIMAL(18,2)) END), 0.00), ',
      'COALESCE(SUM(CAST(refund_amount_snapshot AS DECIMAL(18,2))), 0.00) ',
      'FROM `', REPLACE(target_table_name, '`', '``'), '` ',
      'WHERE order_file_id IS NOT NULL ',
      'AND detail_split_file_id IS NULL ',
      'GROUP BY order_file_id ',
      'ON DUPLICATE KEY UPDATE ',
      'entry_count = entry_count + VALUES(entry_count), ',
      'order_total_amount = order_total_amount + VALUES(order_total_amount), ',
      'refund_amount = refund_amount + VALUES(refund_amount)'
    );
    PREPARE snapshot_stmt FROM @snapshot_sql;
    EXECUTE snapshot_stmt;
    DEALLOCATE PREPARE snapshot_stmt;
  END LOOP;

  CLOSE table_cursor;

  UPDATE order_files target_file
  INNER JOIN tmp_order_file_upload_snapshots_v1037 snapshot
    ON snapshot.order_file_id = target_file.id
  SET
    target_file.entry_count = snapshot.entry_count,
    target_file.processed_count = snapshot.entry_count,
    target_file.order_total_amount = snapshot.order_total_amount,
    target_file.refund_amount = snapshot.refund_amount
  WHERE target_file.upload_status IN ('completed', 'abnormal');

  DROP TEMPORARY TABLE IF EXISTS tmp_order_file_upload_snapshots_v1037;
END//
DELIMITER ;

CALL rebuild_order_file_upload_snapshots_v1037();

DROP PROCEDURE IF EXISTS rebuild_order_file_upload_snapshots_v1037;
