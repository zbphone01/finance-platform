-- v10.66: 新增订单文件级票据单号索引任务；实际索引由票据系统低优先级分批建立

CREATE TABLE IF NOT EXISTS `invoice_order_index_jobs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `order_file_id` bigint unsigned NOT NULL,
  `rule_id` bigint unsigned NULL,
  `field_snapshot` json NOT NULL,
  `status` enum('queued','running','retry_wait','succeeded','failed') NOT NULL DEFAULT 'queued',
  `cursor_partition_date` date NULL,
  `cursor_detail_id` bigint unsigned NOT NULL DEFAULT 0,
  `indexed_detail_count` bigint unsigned NOT NULL DEFAULT 0,
  `indexed_identifier_count` bigint unsigned NOT NULL DEFAULT 0,
  `attempt_count` int NOT NULL DEFAULT 0,
  `system_error_count` int NOT NULL DEFAULT 0,
  `available_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lease_owner` varchar(100) NULL,
  `lease_expires_at` datetime NULL,
  `last_error` varchar(1000) NULL,
  `started_at` datetime NULL,
  `finished_at` datetime NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ioij_order_file_uq` (`order_file_id`),
  KEY `ioij_status_available_idx` (`status`, `available_at`, `id`),
  KEY `ioij_lease_idx` (`status`, `lease_expires_at`),
  CONSTRAINT `ioij_order_file_fk`
    FOREIGN KEY (`order_file_id`) REFERENCES `order_files` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
