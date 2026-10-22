-- v10.42: 每日 bill_details 归档完成后采集一次数据盘使用量。
-- 只保留 id = 1 的最新快照；MySQL 归档事件负责发起请求，Node 服务负责采集操作系统磁盘数据。
-- 执行前需确认 v10.31 的 archive_bill_details_daily() 已存在且 event_scheduler = ON。

CREATE TABLE IF NOT EXISTS system_storage_snapshot (
  id INT UNSIGNED NOT NULL,
  request_date DATE NOT NULL,
  requested_archive_date DATE NOT NULL,
  status ENUM('pending', 'capturing', 'completed', 'failed') NOT NULL DEFAULT 'pending',
  snapshot_date DATE NULL,
  archive_date DATE NULL,
  mount_path VARCHAR(500) NULL,
  total_bytes BIGINT UNSIGNED NULL,
  used_bytes BIGINT UNSIGNED NULL,
  available_bytes BIGINT UNSIGNED NULL,
  usage_percent DECIMAL(5,2) NULL,
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  captured_at TIMESTAMP NULL,
  error_message VARCHAR(1000) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT system_storage_snapshot_single_row_chk CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS archive_bill_details_daily_with_storage_request;

DELIMITER //
CREATE PROCEDURE archive_bill_details_daily_with_storage_request()
BEGIN
  CALL archive_bill_details_daily();

  INSERT INTO system_storage_snapshot (
    id,
    request_date,
    requested_archive_date,
    status,
    requested_at,
    error_message,
    updated_at
  )
  VALUES (
    1,
    CURDATE(),
    DATE_SUB(CURDATE(), INTERVAL 60 DAY),
    'pending',
    NOW(),
    NULL,
    NOW()
  )
  ON DUPLICATE KEY UPDATE
    request_date = VALUES(request_date),
    requested_archive_date = VALUES(requested_archive_date),
    status = 'pending',
    requested_at = NOW(),
    error_message = NULL,
    updated_at = NOW();
END//
DELIMITER ;

SET @this_day_archive_event_at = STR_TO_DATE(
  CONCAT(DATE_FORMAT(CURDATE(), '%Y-%m-%d'), ' 03:10:00'),
  '%Y-%m-%d %H:%i:%s'
);
SET @next_day_archive_event_at = IF(
  NOW() < @this_day_archive_event_at,
  @this_day_archive_event_at,
  DATE_ADD(@this_day_archive_event_at, INTERVAL 1 DAY)
);

DROP EVENT IF EXISTS ev_bill_details_archive_old_daily_partitions;

SET @create_archive_event_sql = CONCAT(
  'CREATE EVENT ev_bill_details_archive_old_daily_partitions ',
  'ON SCHEDULE EVERY 1 DAY ',
  'STARTS ''',
  DATE_FORMAT(@next_day_archive_event_at, '%Y-%m-%d %H:%i:%s'),
  ''' ',
  'ON COMPLETION PRESERVE ENABLE ',
  'DO CALL archive_bill_details_daily_with_storage_request()'
);
PREPARE create_archive_event_stmt FROM @create_archive_event_sql;
EXECUTE create_archive_event_stmt;
DEALLOCATE PREPARE create_archive_event_stmt;

SET @this_day_archive_event_at = NULL;
SET @next_day_archive_event_at = NULL;
SET @create_archive_event_sql = NULL;
