-- v9.86: 制单结果独立落库
CREATE TABLE IF NOT EXISTS `voucher_results` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `source_flow_id` bigint unsigned NOT NULL,
  `voucher_date` varchar(20) NOT NULL,
  `reference_text` varchar(200) NOT NULL,
  `is_aggregate` int NOT NULL DEFAULT 0,
  `aggregate_flow_count` int NOT NULL DEFAULT 1,
  `created_by` bigint unsigned NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `vr_source_flow_idx` (`source_flow_id`),
  KEY `vr_created_at_idx` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `voucher_result_flows` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `voucher_result_id` bigint unsigned NOT NULL,
  `bank_flow_id` bigint unsigned NOT NULL,
  `sort_order` int NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `vrf_flow_unique_idx` (`bank_flow_id`),
  KEY `vrf_result_idx` (`voucher_result_id`),
  KEY `vrf_flow_idx` (`bank_flow_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `voucher_result_lines` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `voucher_result_id` bigint unsigned NOT NULL,
  `match_result_id` bigint unsigned NULL,
  `line_no` int NOT NULL,
  `summary` varchar(1000) NOT NULL,
  `subject_code` varchar(100) NOT NULL,
  `subject_name` varchar(200) NOT NULL,
  `debit_amount` varchar(50) NOT NULL,
  `credit_amount` varchar(50) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `vrl_result_idx` (`voucher_result_id`),
  KEY `vrl_match_result_idx` (`match_result_id`),
  KEY `vrl_line_no_idx` (`voucher_result_id`, `line_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
