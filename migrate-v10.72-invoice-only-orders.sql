-- v10.72: 独立保存不参与认账、只供票据系统开票使用的订单明细。
-- 不修改 recognition_rules、order_files、bill_details 或认账任务表。

CREATE TABLE IF NOT EXISTS `invoice_only_rules` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `rule_name` varchar(200) NOT NULL,
  `date_field` varchar(100) NOT NULL,
  `time_field` varchar(100) NOT NULL,
  `income_field` varchar(100) NOT NULL,
  `order_no_field` varchar(100) NOT NULL,
  `invoice_other_order_no_1_field` varchar(100) DEFAULT NULL,
  `invoice_other_order_no_2_field` varchar(100) DEFAULT NULL,
  `description_field` varchar(100) NOT NULL,
  `creator_id` bigint unsigned NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ior_creator_idx` (`creator_id`),
  CONSTRAINT `ior_creator_fk` FOREIGN KEY (`creator_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `invoice_only_order_files` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `file_name` varchar(200) NOT NULL,
  `rule_id` bigint unsigned NOT NULL,
  `bill_date` date NOT NULL,
  `raw_columns` text,
  `invoice_order_no_field_snapshot` json DEFAULT NULL,
  `upload_status` enum('processing','completed','failed') NOT NULL DEFAULT 'processing',
  `entry_count` int NOT NULL DEFAULT 0,
  `processed_count` int NOT NULL DEFAULT 0,
  `order_total_amount` decimal(18,2) NOT NULL DEFAULT 0.00,
  `failed_reason` varchar(500) DEFAULT NULL,
  `uploader_id` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ioof_rule_idx` (`rule_id`),
  KEY `ioof_uploader_idx` (`uploader_id`),
  CONSTRAINT `ioof_rule_fk` FOREIGN KEY (`rule_id`) REFERENCES `invoice_only_rules` (`id`),
  CONSTRAINT `ioof_uploader_fk` FOREIGN KEY (`uploader_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `invoice_only_order_details` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `order_file_id` bigint unsigned NOT NULL,
  `order_datetime` datetime NOT NULL,
  `bill_no` varchar(100) DEFAULT NULL,
  `invoice_other_order_no_1` varchar(255) DEFAULT NULL,
  `invoice_other_order_no_2` varchar(255) DEFAULT NULL,
  `description` varchar(500) NOT NULL,
  `total_amount` decimal(18,2) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `iood_order_file_idx` (`order_file_id`),
  CONSTRAINT `iood_order_file_fk` FOREIGN KEY (`order_file_id`)
    REFERENCES `invoice_only_order_files` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
