-- v10.71: 订单开票改为直接读取认账订单明细，不再维护已认账订单窄表投影。
--
-- 迁移范围：
--   1. order_files 固化上传时三个订单号字段名快照；
--   2. bill_details 及所有现存 bill_details_archive_YYYYMM 增加两个通用票据单号值字段；
--   3. 最近 24 个月按文件固化快照分 50000 行批次回填，早于上海月初减 24 个月的数据不回填；
--   4. 归档过程改用显式列清单，未来 CREATE TABLE ... LIKE bill_details 自动继承相同列顺序；
--   5. 字段快照转存完成后删除 invoice_recognized_projection_jobs。
--
-- 执行前必须停止 finance-platform 和 ticket-platform。本迁移不新增索引或 npm 依赖。

DROP PROCEDURE IF EXISTS assert_order_invoice_migration_ready_v1071;

DELIMITER //
CREATE PROCEDURE assert_order_invoice_migration_ready_v1071()
BEGIN
  DECLARE dependency_count INT DEFAULT 0;
  DECLARE running_upload_count BIGINT UNSIGNED DEFAULT 0;
  DECLARE running_projection_count BIGINT UNSIGNED DEFAULT 0;
  DECLARE running_archive_count BIGINT UNSIGNED DEFAULT 0;
  DECLARE archive_event_count INT DEFAULT 0;

  SELECT COUNT(*)
    INTO dependency_count
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name IN (
      'bill_details',
      'order_files',
      'recognition_rules',
      'invoice_recognized_projection_jobs',
      'bill_detail_archive_runs',
      'order_file_recognition_summaries',
      'order_recognition_summary_deltas'
    );

  IF dependency_count <> 7 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'v10.71 order invoice migration dependencies are missing';
  END IF;

  SELECT COUNT(*)
    INTO running_upload_count
  FROM order_files
  WHERE upload_status = 'processing';

  SELECT COUNT(*)
    INTO running_projection_count
  FROM invoice_recognized_projection_jobs
  WHERE status = 'running';

  SELECT COUNT(*)
    INTO running_archive_count
  FROM bill_detail_archive_runs
  WHERE status = 'running';

  IF running_upload_count <> 0
     OR running_projection_count <> 0
     OR running_archive_count <> 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'uploads, invoice projections, or bill detail archives are still running';
  END IF;

  SELECT COUNT(*)
    INTO archive_event_count
  FROM information_schema.events
  WHERE event_schema = DATABASE()
    AND event_name = 'ev_bill_details_archive_old_daily_partitions';

  IF archive_event_count <> 1 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'bill detail daily archive event is missing';
  END IF;
END//
DELIMITER ;

CALL assert_order_invoice_migration_ready_v1071();
DROP PROCEDURE IF EXISTS assert_order_invoice_migration_ready_v1071;

-- 防止迁移期间每日归档搬迁正在被修改或回填的行；迁移结束后重新启用。
ALTER EVENT ev_bill_details_archive_old_daily_partitions DISABLE;

ALTER TABLE bill_details
  ADD COLUMN invoice_other_order_no_1 VARCHAR(255) NULL DEFAULT NULL AFTER bill_no,
  ADD COLUMN invoice_other_order_no_2 VARCHAR(255) NULL DEFAULT NULL AFTER invoice_other_order_no_1;

ALTER TABLE order_files
  ADD COLUMN invoice_order_no_field_snapshot JSON NULL AFTER raw_columns;

-- 所有已存在月归档表增加相同字段，并保持与主表一致的物理列顺序。
DROP PROCEDURE IF EXISTS add_order_invoice_columns_to_archives_v1071;

DELIMITER //
CREATE PROCEDURE add_order_invoice_columns_to_archives_v1071()
BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE archive_table_name VARCHAR(64);
  DECLARE archive_cursor CURSOR FOR
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name REGEXP '^bill_details_archive_[0-9]{6}$'
    ORDER BY table_name;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  OPEN archive_cursor;
  archive_loop: LOOP
    FETCH archive_cursor INTO archive_table_name;
    IF done = 1 THEN
      LEAVE archive_loop;
    END IF;

    SET @add_invoice_archive_columns_sql = CONCAT(
      'ALTER TABLE `',
      REPLACE(archive_table_name, '`', '``'),
      '` ADD COLUMN invoice_other_order_no_1 VARCHAR(255) NULL DEFAULT NULL AFTER bill_no, ',
      'ADD COLUMN invoice_other_order_no_2 VARCHAR(255) NULL DEFAULT NULL AFTER invoice_other_order_no_1'
    );
    PREPARE add_invoice_archive_columns_stmt FROM @add_invoice_archive_columns_sql;
    EXECUTE add_invoice_archive_columns_stmt;
    DEALLOCATE PREPARE add_invoice_archive_columns_stmt;
  END LOOP;
  CLOSE archive_cursor;
END//
DELIMITER ;

CALL add_order_invoice_columns_to_archives_v1071();
DROP PROCEDURE IF EXISTS add_order_invoice_columns_to_archives_v1071;

-- 旧投影任务保存的是上传时字段配置。先转成 order_files 的新快照格式，再删除任务表。
UPDATE order_files order_file
INNER JOIN invoice_recognized_projection_jobs projection_job
  ON projection_job.order_file_id = order_file.id
SET order_file.invoice_order_no_field_snapshot = JSON_OBJECT(
  'version', 1,
  'orderNo', COALESCE(
    JSON_UNQUOTE(JSON_EXTRACT(projection_job.field_snapshot, '$.orderNo')),
    JSON_UNQUOTE(JSON_EXTRACT(projection_job.field_snapshot, '$.primaryOrder')),
    ''
  ),
  'otherOrderNo1', COALESCE(
    JSON_UNQUOTE(JSON_EXTRACT(projection_job.field_snapshot, '$.otherOrderNo1')),
    JSON_UNQUOTE(JSON_EXTRACT(projection_job.field_snapshot, '$.financialFlow')),
    ''
  ),
  'otherOrderNo2', COALESCE(
    JSON_UNQUOTE(JSON_EXTRACT(projection_job.field_snapshot, '$.otherOrderNo2')),
    JSON_UNQUOTE(JSON_EXTRACT(projection_job.field_snapshot, '$.businessFlow')),
    ''
  )
)
WHERE order_file.invoice_order_no_field_snapshot IS NULL;

DROP PROCEDURE IF EXISTS assert_order_invoice_snapshot_and_columns_v1071;

DELIMITER //
CREATE PROCEDURE assert_order_invoice_snapshot_and_columns_v1071()
BEGIN
  DECLARE invalid_column_order_count INT DEFAULT 0;
  DECLARE missing_snapshot_count BIGINT UNSIGNED DEFAULT 0;

  SELECT COUNT(*)
    INTO invalid_column_order_count
  FROM information_schema.tables target_table
  LEFT JOIN information_schema.columns bill_no_column
    ON bill_no_column.table_schema = target_table.table_schema
   AND bill_no_column.table_name = target_table.table_name
   AND bill_no_column.column_name = 'bill_no'
  LEFT JOIN information_schema.columns other_no_1_column
    ON other_no_1_column.table_schema = target_table.table_schema
   AND other_no_1_column.table_name = target_table.table_name
   AND other_no_1_column.column_name = 'invoice_other_order_no_1'
  LEFT JOIN information_schema.columns other_no_2_column
    ON other_no_2_column.table_schema = target_table.table_schema
   AND other_no_2_column.table_name = target_table.table_name
   AND other_no_2_column.column_name = 'invoice_other_order_no_2'
  LEFT JOIN information_schema.columns bill_date_column
    ON bill_date_column.table_schema = target_table.table_schema
   AND bill_date_column.table_name = target_table.table_name
   AND bill_date_column.column_name = 'bill_date'
  WHERE target_table.table_schema = DATABASE()
    AND (
      target_table.table_name = 'bill_details'
      OR target_table.table_name REGEXP '^bill_details_archive_[0-9]{6}$'
    )
    AND (
      bill_no_column.ordinal_position IS NULL
      OR other_no_1_column.ordinal_position <> bill_no_column.ordinal_position + 1
      OR other_no_2_column.ordinal_position <> other_no_1_column.ordinal_position + 1
      OR bill_date_column.ordinal_position <> other_no_2_column.ordinal_position + 1
    );

  IF invalid_column_order_count <> 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'bill detail invoice columns are missing or out of order';
  END IF;

  SELECT COUNT(*)
    INTO missing_snapshot_count
  FROM invoice_recognized_projection_jobs projection_job
  INNER JOIN order_files order_file ON order_file.id = projection_job.order_file_id
  WHERE order_file.invoice_order_no_field_snapshot IS NULL;

  IF missing_snapshot_count <> 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'invoice projection snapshots were not fully copied to order_files';
  END IF;
END//
DELIMITER ;

CALL assert_order_invoice_snapshot_and_columns_v1071();
DROP PROCEDURE IF EXISTS assert_order_invoice_snapshot_and_columns_v1071;

-- 按固化字段名从 raw_data 提取值。没有固化快照或原始值为空的历史行保持 NULL，禁止套用当前规则猜测。
DROP PROCEDURE IF EXISTS backfill_order_invoice_values_v1071;

DELIMITER //
CREATE PROCEDURE backfill_order_invoice_values_v1071()
backfill_all: BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE archive_table_name VARCHAR(64);
  DECLARE archive_month CHAR(6);
  DECLARE cutoff_date DATE;
  DECLARE cutoff_month CHAR(6);
  DECLARE batch_count BIGINT UNSIGNED DEFAULT 0;
  DECLARE archive_cursor CURSOR FOR
    SELECT table_name, RIGHT(table_name, 6)
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name REGEXP '^bill_details_archive_[0-9]{6}$'
    ORDER BY table_name;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    DROP TEMPORARY TABLE IF EXISTS tmp_order_invoice_backfill_ids;
    RESIGNAL;
  END;

  SET cutoff_date = DATE_SUB(
    STR_TO_DATE(
      DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'), '%Y-%m-01'),
      '%Y-%m-%d'
    ),
    INTERVAL 24 MONTH
  );
  SET cutoff_month = DATE_FORMAT(cutoff_date, '%Y%m');

  CREATE TEMPORARY TABLE tmp_order_invoice_backfill_ids (
    id BIGINT UNSIGNED NOT NULL,
    partition_date DATE NOT NULL,
    PRIMARY KEY (id, partition_date)
  ) ENGINE=InnoDB;

  hot_batch_loop: LOOP
    START TRANSACTION;
    DELETE FROM tmp_order_invoice_backfill_ids;

    INSERT INTO tmp_order_invoice_backfill_ids (id, partition_date)
    SELECT detail.id, detail.partition_date
    FROM bill_details detail
    INNER JOIN order_files order_file ON order_file.id = detail.order_file_id
    WHERE detail.bill_date >= cutoff_date
      AND detail.raw_data IS NOT NULL
      AND order_file.invoice_order_no_field_snapshot IS NOT NULL
      AND (
        (
          detail.invoice_other_order_no_1 IS NULL
          AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(
            order_file.invoice_order_no_field_snapshot,
            '$.otherOrderNo1'
          )), '') <> ''
          AND NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(
            detail.raw_data,
            CONCAT(
              '$."',
              REPLACE(REPLACE(
                JSON_UNQUOTE(JSON_EXTRACT(order_file.invoice_order_no_field_snapshot, '$.otherOrderNo1')),
                CHAR(92),
                CONCAT(CHAR(92), CHAR(92))
              ), '"', CONCAT(CHAR(92), '"')),
              '"'
            )
          ))), '') IS NOT NULL
        )
        OR
        (
          detail.invoice_other_order_no_2 IS NULL
          AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(
            order_file.invoice_order_no_field_snapshot,
            '$.otherOrderNo2'
          )), '') <> ''
          AND NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(
            detail.raw_data,
            CONCAT(
              '$."',
              REPLACE(REPLACE(
                JSON_UNQUOTE(JSON_EXTRACT(order_file.invoice_order_no_field_snapshot, '$.otherOrderNo2')),
                CHAR(92),
                CONCAT(CHAR(92), CHAR(92))
              ), '"', CONCAT(CHAR(92), '"')),
              '"'
            )
          ))), '') IS NOT NULL
        )
      )
    LIMIT 50000;

    SET batch_count = ROW_COUNT();
    IF batch_count = 0 THEN
      COMMIT;
      LEAVE hot_batch_loop;
    END IF;

    UPDATE bill_details detail
    INNER JOIN tmp_order_invoice_backfill_ids selected
      ON selected.id = detail.id
     AND selected.partition_date = detail.partition_date
    INNER JOIN order_files order_file ON order_file.id = detail.order_file_id
    SET
      detail.invoice_other_order_no_1 = COALESCE(
        detail.invoice_other_order_no_1,
        NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(
          detail.raw_data,
          CONCAT(
            '$."',
            REPLACE(REPLACE(
              JSON_UNQUOTE(JSON_EXTRACT(order_file.invoice_order_no_field_snapshot, '$.otherOrderNo1')),
              CHAR(92),
              CONCAT(CHAR(92), CHAR(92))
            ), '"', CONCAT(CHAR(92), '"')),
            '"'
          )
        ))), '')
      ),
      detail.invoice_other_order_no_2 = COALESCE(
        detail.invoice_other_order_no_2,
        NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(
          detail.raw_data,
          CONCAT(
            '$."',
            REPLACE(REPLACE(
              JSON_UNQUOTE(JSON_EXTRACT(order_file.invoice_order_no_field_snapshot, '$.otherOrderNo2')),
              CHAR(92),
              CONCAT(CHAR(92), CHAR(92))
            ), '"', CONCAT(CHAR(92), '"')),
            '"'
          )
        ))), '')
      );

    COMMIT;
  END LOOP;

  OPEN archive_cursor;
  archive_loop: LOOP
    FETCH archive_cursor INTO archive_table_name, archive_month;
    IF done = 1 THEN
      LEAVE archive_loop;
    END IF;
    IF archive_month < cutoff_month THEN
      ITERATE archive_loop;
    END IF;

    archive_batch_loop: LOOP
      START TRANSACTION;
      DELETE FROM tmp_order_invoice_backfill_ids;

      SET @select_invoice_archive_backfill_sql = CONCAT(
        'INSERT INTO tmp_order_invoice_backfill_ids (id, partition_date) ',
        'SELECT detail.id, detail.partition_date FROM `',
        REPLACE(archive_table_name, '`', '``'),
        '` detail INNER JOIN order_files order_file ON order_file.id = detail.order_file_id ',
        'WHERE detail.bill_date >= ? AND detail.raw_data IS NOT NULL ',
        'AND order_file.invoice_order_no_field_snapshot IS NOT NULL AND (',
        '(detail.invoice_other_order_no_1 IS NULL ',
        'AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(order_file.invoice_order_no_field_snapshot, ''$.otherOrderNo1'')), '''') <> '''' ',
        'AND NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(detail.raw_data, CONCAT(''$.\"'', ',
        'REPLACE(REPLACE(JSON_UNQUOTE(JSON_EXTRACT(order_file.invoice_order_no_field_snapshot, ''$.otherOrderNo1'')), ',
        'CHAR(92), CONCAT(CHAR(92), CHAR(92))), ''\"'', CONCAT(CHAR(92), ''\"'')), ''\"'')))), '''') IS NOT NULL) OR ',
        '(detail.invoice_other_order_no_2 IS NULL ',
        'AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(order_file.invoice_order_no_field_snapshot, ''$.otherOrderNo2'')), '''') <> '''' ',
        'AND NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(detail.raw_data, CONCAT(''$.\"'', ',
        'REPLACE(REPLACE(JSON_UNQUOTE(JSON_EXTRACT(order_file.invoice_order_no_field_snapshot, ''$.otherOrderNo2'')), ',
        'CHAR(92), CONCAT(CHAR(92), CHAR(92))), ''\"'', CONCAT(CHAR(92), ''\"'')), ''\"'')))), '''') IS NOT NULL)) ',
        'LIMIT 50000'
      );
      PREPARE select_invoice_archive_backfill_stmt FROM @select_invoice_archive_backfill_sql;
      SET @invoice_backfill_cutoff_date = cutoff_date;
      EXECUTE select_invoice_archive_backfill_stmt USING @invoice_backfill_cutoff_date;
      SET batch_count = ROW_COUNT();
      DEALLOCATE PREPARE select_invoice_archive_backfill_stmt;

      IF batch_count = 0 THEN
        COMMIT;
        LEAVE archive_batch_loop;
      END IF;

      SET @update_invoice_archive_backfill_sql = CONCAT(
        'UPDATE `',
        REPLACE(archive_table_name, '`', '``'),
        '` detail INNER JOIN tmp_order_invoice_backfill_ids selected ',
        'ON selected.id = detail.id AND selected.partition_date = detail.partition_date ',
        'INNER JOIN order_files order_file ON order_file.id = detail.order_file_id SET ',
        'detail.invoice_other_order_no_1 = COALESCE(detail.invoice_other_order_no_1, ',
        'NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(detail.raw_data, CONCAT(''$.\"'', ',
        'REPLACE(REPLACE(JSON_UNQUOTE(JSON_EXTRACT(order_file.invoice_order_no_field_snapshot, ''$.otherOrderNo1'')), ',
        'CHAR(92), CONCAT(CHAR(92), CHAR(92))), ''\"'', CONCAT(CHAR(92), ''\"'')), ''\"'')))), '''')), ',
        'detail.invoice_other_order_no_2 = COALESCE(detail.invoice_other_order_no_2, ',
        'NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(detail.raw_data, CONCAT(''$.\"'', ',
        'REPLACE(REPLACE(JSON_UNQUOTE(JSON_EXTRACT(order_file.invoice_order_no_field_snapshot, ''$.otherOrderNo2'')), ',
        'CHAR(92), CONCAT(CHAR(92), CHAR(92))), ''\"'', CONCAT(CHAR(92), ''\"'')), ''\"'')))), ''''))'
      );
      PREPARE update_invoice_archive_backfill_stmt FROM @update_invoice_archive_backfill_sql;
      EXECUTE update_invoice_archive_backfill_stmt;
      DEALLOCATE PREPARE update_invoice_archive_backfill_stmt;

      COMMIT;
    END LOOP;
  END LOOP;
  CLOSE archive_cursor;

  DROP TEMPORARY TABLE IF EXISTS tmp_order_invoice_backfill_ids;
END//
DELIMITER ;

CALL backfill_order_invoice_values_v1071();
DROP PROCEDURE IF EXISTS backfill_order_invoice_values_v1071;

-- 替换当前单日归档过程：保留 v10.60 的批次校验与快照清理，只把 bd.* 改为显式列清单。
DROP PROCEDURE IF EXISTS archive_bill_details_day;

DELIMITER //
CREATE PROCEDURE archive_bill_details_day(IN target_date DATE)
archive_day: BEGIN
  DECLARE archive_table_name VARCHAR(64);
  DECLARE source_partition_name VARCHAR(64);
  DECLARE source_partition_count INT DEFAULT 0;
  DECLARE running_task_count BIGINT UNSIGNED DEFAULT 0;
  DECLARE lock_name VARCHAR(128);
  DECLARE lock_acquired INT DEFAULT 0;
  DECLARE had_completed_run INT DEFAULT 0;
  DECLARE archived_any_batch INT DEFAULT 0;
  DECLARE archive_count_value BIGINT UNSIGNED DEFAULT 0;
  DECLARE archive_total_value DECIMAL(20,2) DEFAULT 0.00;
  DECLARE batch_count_value BIGINT UNSIGNED DEFAULT 0;
  DECLARE batch_insert_count BIGINT UNSIGNED DEFAULT 0;
  DECLARE batch_delete_count BIGINT UNSIGNED DEFAULT 0;
  DECLARE batch_total_value DECIMAL(20,2) DEFAULT 0.00;
  DECLARE error_text VARCHAR(1000);

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    GET DIAGNOSTICS CONDITION 1 error_text = MESSAGE_TEXT;
    ROLLBACK;
    DROP TEMPORARY TABLE IF EXISTS tmp_bill_detail_archive_ids;
    UPDATE bill_detail_archive_runs
    SET
      status = IF(had_completed_run = 1 OR archived_any_batch = 1, 'completed', 'failed'),
      error_message = error_text,
      completed_at = NOW()
    WHERE archive_date = target_date;
    IF lock_acquired = 1 THEN
      DO RELEASE_LOCK(lock_name);
    END IF;
    RESIGNAL;
  END;

  IF target_date IS NULL OR target_date < '1970-01-02' THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'archive target date is invalid';
  END IF;

  IF target_date > DATE_SUB(CURDATE(), INTERVAL 60 DAY) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'archive target date must be at least 60 days old';
  END IF;

  SET archive_table_name = CONCAT('bill_details_archive_', DATE_FORMAT(target_date, '%Y%m'));
  SET lock_name = CONCAT(DATABASE(), ':bill_details_archive:', DATE_FORMAT(target_date, '%Y-%m-%d'));

  SELECT COUNT(*)
    INTO had_completed_run
  FROM bill_detail_archive_runs
  WHERE archive_date = target_date
    AND status = 'completed';

  SELECT GET_LOCK(lock_name, 0) INTO lock_acquired;
  IF lock_acquired <> 1 THEN
    INSERT INTO bill_detail_archive_runs (
      archive_date,
      archive_table,
      partition_name,
      status,
      error_message,
      started_at,
      completed_at
    )
    VALUES (
      target_date,
      archive_table_name,
      'unknown',
      'skipped',
      'archive lock is held by another session',
      NOW(),
      NOW()
    )
    ON DUPLICATE KEY UPDATE
      status = IF(bill_detail_archive_runs.status = 'completed', 'completed', 'skipped'),
      error_message = VALUES(error_message),
      completed_at = NOW();
    LEAVE archive_day;
  END IF;

  CALL ensure_bill_details_archive_tables_around(target_date);

  SET source_partition_name = NULL;
  SELECT partition_name
    INTO source_partition_name
  FROM information_schema.partitions
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_details'
    AND partition_name IS NOT NULL
    AND partition_name <> 'p_unmatched'
    AND (
      partition_description = 'MAXVALUE'
      OR STR_TO_DATE(REPLACE(partition_description, '''', ''), '%Y-%m-%d') > target_date
    )
  ORDER BY partition_ordinal_position
  LIMIT 1;

  SELECT COUNT(*)
    INTO source_partition_count
  FROM information_schema.partitions
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_details'
    AND partition_name = source_partition_name;

  IF source_partition_name IS NULL OR source_partition_count = 0 THEN
    INSERT INTO bill_detail_archive_runs (
      archive_date,
      archive_table,
      partition_name,
      status,
      error_message,
      started_at,
      completed_at
    )
    VALUES (
      target_date,
      archive_table_name,
      'unknown',
      'skipped',
      'source partition not found',
      NOW(),
      NOW()
    )
    ON DUPLICATE KEY UPDATE
      status = IF(bill_detail_archive_runs.status = 'completed', 'completed', 'skipped'),
      error_message = VALUES(error_message),
      completed_at = NOW();
    DO RELEASE_LOCK(lock_name);
    SET lock_acquired = 0;
    LEAVE archive_day;
  END IF;

  SELECT COUNT(*)
    INTO running_task_count
  FROM recognition_tasks
  WHERE bill_date = target_date
    AND status = 'processing';

  SET @running_partition_task_count = 0;
  SET @running_partition_task_sql = CONCAT(
    'SELECT EXISTS(',
    'SELECT 1 FROM bill_details PARTITION (`',
    REPLACE(source_partition_name, '`', '``'),
    '`) bd INNER JOIN recognition_tasks rt ON rt.id = bd.task_id ',
    'WHERE bd.partition_date = ? AND rt.status = ''processing'' LIMIT 1',
    ') INTO @running_partition_task_count'
  );
  PREPARE running_partition_task_stmt FROM @running_partition_task_sql;
  SET @archive_target_date = target_date;
  EXECUTE running_partition_task_stmt USING @archive_target_date;
  DEALLOCATE PREPARE running_partition_task_stmt;
  SET running_task_count = running_task_count + COALESCE(@running_partition_task_count, 0);

  SET @running_detail_split_count = 0;
  SET @running_detail_split_sql = CONCAT(
    'SELECT EXISTS(',
    'SELECT 1 FROM bill_details PARTITION (`',
    REPLACE(source_partition_name, '`', '``'),
    '`) bd INNER JOIN detail_split_files dsf ON dsf.id = bd.detail_split_file_id ',
    'WHERE bd.partition_date = ? ',
    'AND (dsf.upload_status = ''processing'' ',
    'OR dsf.recognition_phase IN (''finding_tasks'', ''recognizing'')) LIMIT 1',
    ') INTO @running_detail_split_count'
  );
  PREPARE running_detail_split_stmt FROM @running_detail_split_sql;
  EXECUTE running_detail_split_stmt USING @archive_target_date;
  DEALLOCATE PREPARE running_detail_split_stmt;
  SET running_task_count = running_task_count + COALESCE(@running_detail_split_count, 0);

  IF running_task_count > 0 THEN
    INSERT INTO bill_detail_archive_runs (
      archive_date,
      archive_table,
      partition_name,
      status,
      error_message,
      started_at,
      completed_at
    )
    VALUES (
      target_date,
      archive_table_name,
      source_partition_name,
      'skipped',
      'recognition task is still processing',
      NOW(),
      NOW()
    )
    ON DUPLICATE KEY UPDATE
      archive_table = VALUES(archive_table),
      partition_name = VALUES(partition_name),
      status = IF(bill_detail_archive_runs.status = 'completed', 'completed', 'skipped'),
      error_message = VALUES(error_message),
      completed_at = NOW();
    DO RELEASE_LOCK(lock_name);
    SET lock_acquired = 0;
    LEAVE archive_day;
  END IF;

  SET @archive_summary_sql = CONCAT(
    'SELECT COUNT(*), COALESCE(SUM(CAST(total_amount AS DECIMAL(18,2))), 0.00) ',
    'INTO @archive_count_value, @archive_total_value ',
    'FROM `',
    archive_table_name,
    '` WHERE partition_date = ?'
  );
  PREPARE archive_summary_stmt FROM @archive_summary_sql;
  EXECUTE archive_summary_stmt USING @archive_target_date;
  DEALLOCATE PREPARE archive_summary_stmt;
  SET archive_count_value = COALESCE(@archive_count_value, 0);
  SET archive_total_value = COALESCE(@archive_total_value, 0.00);

  INSERT INTO bill_detail_archive_runs (
    archive_date,
    archive_table,
    partition_name,
    status,
    source_count,
    archive_count,
    source_total,
    archive_total,
    error_message,
    started_at,
    completed_at
  )
  VALUES (
    target_date,
    archive_table_name,
    source_partition_name,
    IF(archive_count_value > 0 OR had_completed_run = 1, 'completed', 'running'),
    archive_count_value,
    archive_count_value,
    archive_total_value,
    archive_total_value,
    NULL,
    NOW(),
    IF(archive_count_value > 0 OR had_completed_run = 1, NOW(), NULL)
  )
  ON DUPLICATE KEY UPDATE
    archive_table = VALUES(archive_table),
    partition_name = VALUES(partition_name),
    status = VALUES(status),
    source_count = VALUES(source_count),
    archive_count = VALUES(archive_count),
    source_total = VALUES(source_total),
    archive_total = VALUES(archive_total),
    error_message = NULL,
    started_at = NOW(),
    completed_at = VALUES(completed_at);

  CREATE TEMPORARY TABLE IF NOT EXISTS tmp_bill_detail_archive_ids (
    id BIGINT UNSIGNED NOT NULL,
    partition_date DATE NOT NULL,
    order_file_id BIGINT UNSIGNED NULL,
    task_id BIGINT UNSIGNED NOT NULL,
    rule_id BIGINT UNSIGNED NULL,
    operation_status VARCHAR(20) NOT NULL,
    PRIMARY KEY (id, partition_date),
    KEY tmp_archive_order_file_idx (order_file_id),
    KEY tmp_archive_transfer_idx (task_id, rule_id, partition_date, operation_status)
  ) ENGINE=InnoDB;

  archive_batch_loop: LOOP
    START TRANSACTION;
    DELETE FROM tmp_bill_detail_archive_ids;

    SET @select_archive_batch_sql = CONCAT(
      'INSERT INTO tmp_bill_detail_archive_ids ',
      '(id, partition_date, order_file_id, task_id, rule_id, operation_status) ',
      'SELECT id, partition_date, order_file_id, task_id, rule_id, operation_status ',
      'FROM bill_details PARTITION (`',
      REPLACE(source_partition_name, '`', '``'),
      '`) WHERE partition_date = ? ',
      'LIMIT 50000 FOR UPDATE'
    );
    PREPARE select_archive_batch_stmt FROM @select_archive_batch_sql;
    EXECUTE select_archive_batch_stmt USING @archive_target_date;
    SET batch_count_value = ROW_COUNT();
    DEALLOCATE PREPARE select_archive_batch_stmt;

    IF batch_count_value = 0 THEN
      COMMIT;
      LEAVE archive_batch_loop;
    END IF;

    SET @archive_batch_summary_sql = CONCAT(
      'SELECT COUNT(*), COALESCE(SUM(CAST(bd.total_amount AS DECIMAL(18,2))), 0.00) ',
      'INTO @archive_batch_count_value, @archive_batch_total_value ',
      'FROM bill_details PARTITION (`',
      REPLACE(source_partition_name, '`', '``'),
      '`) bd INNER JOIN tmp_bill_detail_archive_ids selected ',
      'ON selected.id = bd.id AND selected.partition_date = bd.partition_date'
    );
    PREPARE archive_batch_summary_stmt FROM @archive_batch_summary_sql;
    EXECUTE archive_batch_summary_stmt;
    DEALLOCATE PREPARE archive_batch_summary_stmt;
    SET batch_count_value = COALESCE(@archive_batch_count_value, 0);
    SET batch_total_value = COALESCE(@archive_batch_total_value, 0.00);

    SET @insert_archive_batch_sql = CONCAT(
      'INSERT INTO `',
      archive_table_name,
      '` (`id`, `task_id`, `rule_id`, `order_file_id`, `detail_split_file_id`, ',
      '`split_source_detail_id`, `bill_no`, `invoice_other_order_no_1`, ',
      '`invoice_other_order_no_2`, `bill_date`, `partition_date`, `description`, ',
      '`total_amount`, `refund_amount_snapshot`, `raw_data`, `match_status`, ',
      '`match_result_id`, `operation_status`, `lifecycle_status`, `original_task_id`, ',
      '`original_recognition_date`, `rule_item_id`, `ignore_reason`, `created_at`) ',
      'SELECT bd.`id`, bd.`task_id`, bd.`rule_id`, bd.`order_file_id`, ',
      'bd.`detail_split_file_id`, bd.`split_source_detail_id`, bd.`bill_no`, ',
      'bd.`invoice_other_order_no_1`, bd.`invoice_other_order_no_2`, bd.`bill_date`, ',
      'bd.`partition_date`, bd.`description`, bd.`total_amount`, ',
      'bd.`refund_amount_snapshot`, bd.`raw_data`, bd.`match_status`, ',
      'bd.`match_result_id`, bd.`operation_status`, bd.`lifecycle_status`, ',
      'bd.`original_task_id`, bd.`original_recognition_date`, bd.`rule_item_id`, ',
      'bd.`ignore_reason`, bd.`created_at` FROM bill_details PARTITION (`',
      REPLACE(source_partition_name, '`', '``'),
      '`) bd INNER JOIN tmp_bill_detail_archive_ids selected ',
      'ON selected.id = bd.id AND selected.partition_date = bd.partition_date'
    );
    PREPARE insert_archive_batch_stmt FROM @insert_archive_batch_sql;
    EXECUTE insert_archive_batch_stmt;
    SET batch_insert_count = ROW_COUNT();
    DEALLOCATE PREPARE insert_archive_batch_stmt;

    IF batch_insert_count <> batch_count_value THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'archive batch insert verification failed';
    END IF;

    SET @delete_archive_batch_sql = CONCAT(
      'DELETE bd FROM bill_details PARTITION (`',
      REPLACE(source_partition_name, '`', '``'),
      '`) bd INNER JOIN tmp_bill_detail_archive_ids selected ',
      'ON selected.id = bd.id AND selected.partition_date = bd.partition_date'
    );
    PREPARE delete_archive_batch_stmt FROM @delete_archive_batch_sql;
    EXECUTE delete_archive_batch_stmt;
    SET batch_delete_count = ROW_COUNT();
    DEALLOCATE PREPARE delete_archive_batch_stmt;

    IF batch_delete_count <> batch_count_value THEN
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'archive batch delete verification failed';
    END IF;

    UPDATE order_files archived_file
    INNER JOIN tmp_bill_detail_archive_ids selected
      ON selected.order_file_id = archived_file.id
    SET archived_file.recognition_summary_valid = 0
    WHERE selected.order_file_id IS NOT NULL
      AND archived_file.recognition_summary_valid <> 0;

    DELETE recognition_summary
    FROM order_file_recognition_summaries recognition_summary
    INNER JOIN tmp_bill_detail_archive_ids selected
      ON selected.order_file_id = recognition_summary.order_file_id
    WHERE selected.order_file_id IS NOT NULL;

    DELETE source_delta
    FROM order_recognition_summary_deltas source_delta
    INNER JOIN tmp_bill_detail_archive_ids selected
      ON selected.order_file_id = source_delta.order_file_id
    WHERE selected.order_file_id IS NOT NULL
      AND source_delta.delta_type = 'source_deduction';

    DELETE transfer_delta
    FROM order_recognition_summary_deltas transfer_delta
    INNER JOIN tmp_bill_detail_archive_ids selected
      ON selected.task_id = transfer_delta.task_id
      AND selected.rule_id = transfer_delta.rule_id
      AND selected.partition_date = transfer_delta.partition_date
    WHERE selected.operation_status = 'transferred'
      AND selected.rule_id IS NOT NULL
      AND transfer_delta.delta_type = 'target_transfer_in';

    UPDATE bill_detail_archive_runs
    SET
      status = 'completed',
      source_count = archive_count_value + batch_count_value,
      archive_count = archive_count_value + batch_count_value,
      source_total = archive_total_value + batch_total_value,
      archive_total = archive_total_value + batch_total_value,
      error_message = NULL,
      completed_at = NOW()
    WHERE archive_date = target_date;

    COMMIT;
    SET archived_any_batch = 1;
    SET had_completed_run = 1;
    SET archive_count_value = archive_count_value + batch_count_value;
    SET archive_total_value = archive_total_value + batch_total_value;
  END LOOP;

  DROP TEMPORARY TABLE IF EXISTS tmp_bill_detail_archive_ids;

  UPDATE bill_detail_archive_runs
  SET
    archive_table = archive_table_name,
    partition_name = source_partition_name,
    status = 'completed',
    source_count = archive_count_value,
    archive_count = archive_count_value,
    source_total = archive_total_value,
    archive_total = archive_total_value,
    error_message = NULL,
    completed_at = NOW()
  WHERE archive_date = target_date;

  DO RELEASE_LOCK(lock_name);
  SET lock_acquired = 0;
END//
DELIMITER ;

ALTER EVENT ev_bill_details_archive_old_daily_partitions ENABLE;

-- 结构、快照转存、历史回填和归档过程均成功后才删除旧任务表。
DROP TABLE invoice_recognized_projection_jobs;

SET @add_invoice_archive_columns_sql = NULL;
SET @select_invoice_archive_backfill_sql = NULL;
SET @update_invoice_archive_backfill_sql = NULL;
SET @invoice_backfill_cutoff_date = NULL;

SELECT
  table_name,
  GROUP_CONCAT(column_name ORDER BY ordinal_position SEPARATOR ',') AS invoice_column_order
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND (
    table_name = 'bill_details'
    OR table_name REGEXP '^bill_details_archive_[0-9]{6}$'
  )
  AND column_name IN (
    'bill_no',
    'invoice_other_order_no_1',
    'invoice_other_order_no_2',
    'bill_date'
  )
GROUP BY table_name
ORDER BY table_name;

SELECT
  COUNT(*) AS order_file_count,
  SUM(invoice_order_no_field_snapshot IS NOT NULL) AS snapshotted_order_file_count
FROM order_files;

SELECT
  COUNT(*) AS remaining_projection_table_count
FROM information_schema.tables
WHERE table_schema = DATABASE()
  AND table_name = 'invoice_recognized_projection_jobs';
