CREATE TABLE IF NOT EXISTS `voucher_summaries` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `counterparty_record_id` bigint unsigned NOT NULL,
  `summary_text` varchar(500) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `vs_counterparty_idx` (`counterparty_record_id`),
  KEY `vs_active_idx` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
