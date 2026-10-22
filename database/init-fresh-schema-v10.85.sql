-- finance-platform v10.85: complete fresh-install structure, no business/configuration data.
-- Empty database only. No historical migrations required. Events are created by scripts/ensure-mysql-events.mjs.
SET NAMES utf8mb4;
SET @fresh_old_fk = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS=0;

CREATE TABLE `bank_accounts` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `bank_name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `account_no` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `account_alias` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `source_type` enum('upload','manual') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual',
  `is_default` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ba_bank_account_uq` (`bank_name`,`account_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `bank_flows` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `task_id` bigint unsigned NOT NULL,
  `bank_name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '广发银行',
  `bank_account_id` bigint unsigned DEFAULT NULL,
  `matched_counterparty_id` bigint unsigned DEFAULT NULL,
  `arrival_match_status` enum('unmatched','matched','cancelled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unmatched',
  `reference_no` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `transaction_time` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `income` decimal(18,2) NOT NULL,
  `counterparty_account` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `counterparty_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `counterparty_bank` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `branch` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `summary` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `purpose` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `post_script` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `recognition_status` enum('unrecognized','partial_matched','recognized','large_variance') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unrecognized',
  `income_rule_id` bigint unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `bf_task_idx` (`task_id`),
  KEY `bf_ref_idx` (`reference_no`),
  KEY `bf_time_idx` (`transaction_time`),
  KEY `bf_task_id_idx` (`task_id`,`id`),
  KEY `bf_recognition_status_idx` (`recognition_status`),
  KEY `bf_status_time_id_idx` (`recognition_status`,`transaction_time`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `bill_detail_archive_runs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `archive_date` date NOT NULL,
  `archive_table` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `partition_name` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('running','completed','failed','skipped') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'running',
  `source_count` bigint unsigned NOT NULL DEFAULT '0',
  `archive_count` bigint unsigned NOT NULL DEFAULT '0',
  `source_total` decimal(20,2) NOT NULL DEFAULT '0.00',
  `archive_total` decimal(20,2) NOT NULL DEFAULT '0.00',
  `error_message` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `started_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  `recognition_status_synced_at` timestamp NULL DEFAULT NULL,
  `manual_work_items_synced_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `bdar_archive_date_uq` (`archive_date`),
  KEY `bdar_status_date_idx` (`status`,`archive_date`),
  KEY `bdar_archive_table_idx` (`archive_table`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `bill_detail_locator` (
  `detail_id` bigint unsigned NOT NULL,
  `partition_date` date NOT NULL,
  `order_file_id` bigint unsigned DEFAULT NULL,
  `task_id` bigint unsigned DEFAULT NULL,
  `lifecycle_status` enum('normal','unmatched_package','archived') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'normal',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`detail_id`),
  KEY `bdl_partition_detail_idx` (`partition_date`,`detail_id`),
  KEY `bdl_order_file_idx` (`order_file_id`),
  KEY `bdl_task_idx` (`task_id`),
  KEY `bdl_partition_lifecycle_idx` (`partition_date`,`lifecycle_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `bill_details` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `task_id` bigint unsigned NOT NULL,
  `rule_id` bigint unsigned DEFAULT NULL,
  `order_file_id` bigint unsigned DEFAULT NULL,
  `detail_split_file_id` bigint unsigned DEFAULT NULL,
  `split_source_detail_id` bigint unsigned DEFAULT NULL,
  `bill_no` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `invoice_other_order_no_1` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `invoice_other_order_no_2` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bill_date` date NOT NULL,
  `partition_date` date NOT NULL DEFAULT '1970-01-01',
  `description` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `total_amount` decimal(18,2) NOT NULL,
  `refund_amount_snapshot` decimal(18,2) NOT NULL DEFAULT '0.00',
  `match_status` enum('unmatched','matched','pending_split','ignored','manual_ignored') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unmatched',
  `match_result_id` bigint unsigned DEFAULT NULL,
  `operation_status` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `lifecycle_status` enum('normal','unmatched_package','archived') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'normal',
  `original_task_id` bigint unsigned DEFAULT NULL,
  `original_recognition_date` date DEFAULT NULL,
  `rule_item_id` bigint unsigned DEFAULT NULL,
  `ignore_reason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `raw_data` json DEFAULT NULL,
  PRIMARY KEY (`id`,`partition_date`),
  UNIQUE KEY `bd_rule_bill_date_bill_no_partition_uq` (`rule_id`,`bill_date`,`bill_no`,`partition_date`),
  KEY `bd_task_idx` (`task_id`),
  KEY `bd_order_file_idx` (`order_file_id`),
  KEY `bd_match_result_idx` (`match_result_id`),
  KEY `bd_bill_date_idx` (`bill_date`),
  KEY `bd_task_status_idx` (`task_id`,`match_status`),
  KEY `bd_operation_status_idx` (`operation_status`),
  KEY `bd_detail_split_file_idx` (`detail_split_file_id`),
  KEY `bd_split_source_detail_idx` (`split_source_detail_id`),
  KEY `bd_rule_detail_split_status_idx` (`rule_id`,`detail_split_file_id`,`match_status`,`match_result_id`),
  KEY `bd_order_rec_item_idx` (`order_file_id`,`match_status`,`match_result_id`,`rule_item_id`),
  KEY `bd_partition_status_idx` (`partition_date`,`rule_id`,`operation_status`,`match_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
/*!50500 PARTITION BY RANGE  COLUMNS(partition_date)
(PARTITION p_late VALUES LESS THAN ('1000-01-01') ENGINE = InnoDB,
 PARTITION p_future VALUES LESS THAN (MAXVALUE) ENGINE = InnoDB) */;

CREATE TABLE `budget_code_histories` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `budget_code_id` bigint unsigned NOT NULL,
  `code` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `effective_date` timestamp NOT NULL DEFAULT (now()),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `income_project` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `platform_id` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `bch_budget_idx` (`budget_code_id`),
  KEY `bch_created_idx` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `budget_codes` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `code` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `parent_id` bigint unsigned DEFAULT NULL,
  `level` int NOT NULL,
  `is_leaf` int NOT NULL DEFAULT '0',
  `sort_order` int NOT NULL DEFAULT '0',
  `is_active` int NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `income_project` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `associated_income_projects` json DEFAULT NULL,
  `associated_departments` json DEFAULT NULL,
  `platform_id` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `budget_parent_idx` (`parent_id`),
  KEY `budget_level_idx` (`level`),
  KEY `budget_leaf_idx` (`is_leaf`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `counterparty_match_accounts` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `counterparty_record_id` bigint unsigned NOT NULL,
  `bank_name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `account_no` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `account_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `summary` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `purpose` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `post_script` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `is_active` int NOT NULL DEFAULT '1',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `cma_record_sort_uq` (`counterparty_record_id`,`sort_order`),
  KEY `cma_record_idx` (`counterparty_record_id`),
  KEY `cma_account_idx` (`account_no`),
  KEY `cma_active_idx` (`is_active`),
  CONSTRAINT `cma_record_fk` FOREIGN KEY (`counterparty_record_id`) REFERENCES `counterparty_records` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `counterparty_records` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `voucher_summary_text` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `voucher_income_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '凭证收入名称',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `alias` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `detail_matching_mode` enum('单笔匹配','同日汇总匹配','多日汇总匹配') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '单笔匹配',
  `arrival_region` enum('北京市','外省市','港澳台','境外','内部客商') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recognition_type` enum('到账认账','明细认账') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '到账认账',
  `detail_package_type` enum('T+1','打包明细') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'T+1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `cr_alias_idx` (`alias`),
  KEY `cr_recognition_type_idx` (`recognition_type`),
  KEY `cr_detail_package_type_idx` (`detail_package_type`),
  KEY `cr_detail_matching_mode_idx` (`detail_matching_mode`),
  KEY `cr_arrival_region_idx` (`arrival_region`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `departments` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `code` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `parent_code` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `level` int NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `is_active` int NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `dept_code_idx` (`code`),
  KEY `dept_parent_idx` (`parent_code`),
  KEY `dept_level_idx` (`level`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `detail_split_files` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `order_file_id` bigint unsigned DEFAULT NULL,
  `task_id` bigint unsigned DEFAULT NULL,
  `rule_id` bigint unsigned NOT NULL,
  `file_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `match_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `income_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `recognition_keyword_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `order_no_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `raw_columns` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `upload_status` enum('processing','completed','failed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'completed',
  `entry_count` int NOT NULL DEFAULT '0',
  `processed_count` int NOT NULL DEFAULT '0',
  `matched_count` int NOT NULL DEFAULT '0',
  `unmatched_count` int NOT NULL DEFAULT '0',
  `pending_recognition_count` int NOT NULL DEFAULT '0',
  `recognized_count` int NOT NULL DEFAULT '0',
  `duplicate_count` int NOT NULL DEFAULT '0',
  `recognition_phase` enum('idle','finding_tasks','recognizing','completed','failed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'idle',
  `recognition_task_total` int NOT NULL DEFAULT '0',
  `recognition_task_completed` int NOT NULL DEFAULT '0',
  `recognition_failed_reason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `failed_reason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `uploader_id` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `dsf_order_file_idx` (`order_file_id`),
  KEY `dsf_task_idx` (`task_id`),
  KEY `dsf_rule_idx` (`rule_id`),
  KEY `dsf_upload_status_idx` (`upload_status`),
  KEY `dsf_created_at_idx` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `detail_split_order_dedup_keys` (
  `rule_id` bigint unsigned NOT NULL,
  `normalized_order_no` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `detail_split_file_id` bigint unsigned NOT NULL,
  `source_line_number` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`rule_id`,`normalized_order_no`),
  KEY `dsodk_file_idx` (`detail_split_file_id`),
  CONSTRAINT `dsodk_file_fk` FOREIGN KEY (`detail_split_file_id`) REFERENCES `detail_split_files` (`id`) ON DELETE CASCADE,
  CONSTRAINT `dsodk_rule_fk` FOREIGN KEY (`rule_id`) REFERENCES `recognition_rules` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `donation_activities` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `code` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `parent_code` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `level` int NOT NULL,
  `is_leaf` int NOT NULL DEFAULT '0',
  `sort_order` int NOT NULL DEFAULT '0',
  `is_active` int NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `da_code_idx` (`code`),
  KEY `da_parent_idx` (`parent_code`),
  KEY `da_active_idx` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `fundraising_platforms` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `platform_id` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  UNIQUE KEY `fundraising_platforms_platform_id_unique` (`platform_id`),
  KEY `fp_platform_id_idx` (`platform_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `income_recognition_rules` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `account_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `purpose` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `post_script` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `creator_id` bigint unsigned NOT NULL,
  `is_active` int NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `rule_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `matched_counterparty_alias` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recognition_type` enum('银行直捐','渠道捐赠') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '渠道捐赠',
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `income_rule_splits` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `income_rule_id` bigint unsigned NOT NULL,
  `split_form` enum('百分比','认账时填写') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '百分比',
  `split_ratio` decimal(5,2) NOT NULL DEFAULT '100.00',
  `income_type` enum('捐赠收入','会费收入','政府补助','个税返还','本金','投资收益','利息','其他收入','其他') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `donation_source` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `income_attr` enum('非限定性收入','限定性收入') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `remark` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `income_dept` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `budget_code` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `income_project` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `management_fee_ratio` decimal(5,2) DEFAULT '0.00',
  `expense_fund_source` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `platform_project_name` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `platform_project_detail` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `feedback_type` enum('反馈','重点反馈') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `member_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `project_center` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `region` enum('北京市','外省市','港澳台','境外','内部客商') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_anonymous` int NOT NULL DEFAULT '0',
  `management_fee_type` enum('比例','金额') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '比例',
  `management_fee_value` decimal(18,2) DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `irs_rule_idx` (`income_rule_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `invoice_only_order_details` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `order_file_id` bigint unsigned NOT NULL,
  `order_datetime` datetime NOT NULL,
  `bill_no` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `invoice_other_order_no_1` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `invoice_other_order_no_2` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `total_amount` decimal(18,2) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `iood_order_file_idx` (`order_file_id`),
  CONSTRAINT `iood_order_file_fk` FOREIGN KEY (`order_file_id`) REFERENCES `invoice_only_order_files` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `invoice_only_order_files` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `file_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `rule_id` bigint unsigned NOT NULL,
  `bill_date` date NOT NULL,
  `raw_columns` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `invoice_order_no_field_snapshot` json DEFAULT NULL,
  `upload_status` enum('processing','completed','failed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'processing',
  `entry_count` int NOT NULL DEFAULT '0',
  `processed_count` int NOT NULL DEFAULT '0',
  `order_total_amount` decimal(18,2) NOT NULL DEFAULT '0.00',
  `failed_reason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `uploader_id` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ioof_rule_idx` (`rule_id`),
  KEY `ioof_uploader_idx` (`uploader_id`),
  CONSTRAINT `ioof_rule_fk` FOREIGN KEY (`rule_id`) REFERENCES `invoice_only_rules` (`id`),
  CONSTRAINT `ioof_uploader_fk` FOREIGN KEY (`uploader_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `invoice_only_rules` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `rule_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `date_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `time_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `income_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `order_no_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `invoice_other_order_no_1_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `invoice_other_order_no_2_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `creator_id` bigint unsigned NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ior_creator_idx` (`creator_id`),
  CONSTRAINT `ior_creator_fk` FOREIGN KEY (`creator_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `manual_order_work_items` (
  `detail_id` bigint unsigned NOT NULL,
  `task_id` bigint unsigned NOT NULL,
  `original_task_id` bigint unsigned DEFAULT NULL,
  `order_file_id` bigint unsigned DEFAULT NULL,
  `rule_id` bigint unsigned NOT NULL DEFAULT '0',
  `summary_date` date NOT NULL,
  `partition_date` date NOT NULL,
  `bill_date` date NOT NULL,
  `upload_date` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bill_no` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `rule_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `description` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `total_amount` decimal(18,2) NOT NULL,
  `detail_package_type` enum('T+1','打包明细') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'T+1',
  `operation_status` enum('ignored','transferred') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_status` enum('ignored','transferred','transferred_recognized') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `match_result_id` bigint unsigned DEFAULT NULL,
  `operation_reason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `storage_location` enum('hot','archive') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'hot',
  `archive_table` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`detail_id`),
  KEY `mowi_summary_date_idx` (`summary_date`,`detail_id`),
  KEY `mowi_status_date_idx` (`display_status`,`summary_date`,`detail_id`),
  KEY `mowi_rule_status_date_idx` (`rule_id`,`display_status`,`summary_date`,`detail_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `match_results` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `task_id` bigint unsigned NOT NULL,
  `rule_item_id` bigint unsigned DEFAULT NULL,
  `income_type` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `donation_source` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `income_attr` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `income_dept` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `budget_code` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `income_project` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `management_fee_ratio` decimal(5,2) DEFAULT '0.00',
  `management_fee_amount` decimal(18,2) DEFAULT '0.00',
  `expense_fund_source` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `remark` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `voucher_receipt_channel_code` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `total_amount` decimal(18,2) NOT NULL,
  `split_amount` decimal(18,2) NOT NULL,
  `split_ratio` decimal(5,2) DEFAULT '100.00',
  `voucher_status` enum('pending','created') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `detail_count` int NOT NULL DEFAULT '0',
  `order_detail_count_snapshot` int NOT NULL DEFAULT '0',
  `has_archived_details` tinyint(1) NOT NULL DEFAULT '0',
  `entry_time` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `income_rule_id` bigint unsigned DEFAULT NULL,
  `bank_flow_id` bigint unsigned DEFAULT NULL,
  `recognition_type` enum('银行直捐','渠道捐赠') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '渠道捐赠',
  `platform_project_name` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `platform_project_display_name` varchar(700) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `platform_project_detail` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_reference_no` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_transaction_time` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_income` decimal(18,2) DEFAULT NULL,
  `bank_counterparty_account` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_counterparty_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_counterparty_bank` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_summary` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_purpose` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_post_script` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `feedback_type` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `member_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `project_center` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `membership_payment_years` int DEFAULT NULL,
  `region` enum('北京市','外省市','港澳台','境外','内部客商') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_anonymous` int NOT NULL DEFAULT '0',
  `management_fee_type` enum('比例','金额') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '比例',
  `management_fee_value` decimal(18,2) DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `mr_task_idx` (`task_id`),
  KEY `mr_budget_idx` (`budget_code`),
  KEY `mr_entry_time_idx` (`entry_time`),
  KEY `mr_bank_flow_idx` (`bank_flow_id`),
  KEY `mr_voucher_status_idx` (`voucher_status`),
  KEY `mr_entry_time_id_idx` (`entry_time`,`id`),
  KEY `mr_entry_time_budget_idx` (`entry_time`,`budget_code`),
  KEY `mr_entry_time_voucher_idx` (`entry_time`,`voucher_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `multi_day_match_group_flows` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `group_id` bigint unsigned NOT NULL,
  `bank_flow_id` bigint unsigned NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `mdmgf_bank_flow_uq` (`bank_flow_id`),
  UNIQUE KEY `mdmgf_group_flow_uq` (`group_id`,`bank_flow_id`),
  KEY `mdmgf_group_idx` (`group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `multi_day_match_groups` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `rule_id` bigint unsigned NOT NULL,
  `status` enum('unmatched','pending_confirmation','matched') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unmatched',
  `anchor_task_id` bigint unsigned DEFAULT NULL,
  `latest_bill_date` date DEFAULT NULL,
  `package_total` decimal(18,2) NOT NULL DEFAULT '0.00',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `mdmg_rule_status_idx` (`rule_id`,`status`),
  KEY `mdmg_anchor_task_idx` (`anchor_task_id`),
  KEY `mdmg_latest_bill_date_idx` (`latest_bill_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `order_file_partitions` (
  `order_file_id` bigint unsigned NOT NULL,
  `partition_date` date NOT NULL,
  `detail_count` int NOT NULL DEFAULT '0',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`order_file_id`,`partition_date`),
  KEY `ofp_partition_date_idx` (`partition_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `order_file_recognition_summaries` (
  `order_file_id` bigint unsigned NOT NULL,
  `rule_item_id` bigint unsigned NOT NULL,
  `is_refund` tinyint(1) NOT NULL DEFAULT '0',
  `detail_count` int NOT NULL DEFAULT '0',
  `total_amount` decimal(18,2) NOT NULL DEFAULT '0.00',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`order_file_id`,`rule_item_id`,`is_refund`),
  CONSTRAINT `ofrs_order_file_fk` FOREIGN KEY (`order_file_id`) REFERENCES `order_files` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `order_files` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `task_id` bigint unsigned NOT NULL,
  `file_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `rule_id` bigint unsigned DEFAULT NULL,
  `detail_package_type` enum('T+1','打包明细') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'T+1',
  `upload_date` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `multi_day_match_group_id` bigint unsigned DEFAULT NULL,
  `matched_account_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `entry_count` int NOT NULL DEFAULT '0',
  `processed_count` int NOT NULL DEFAULT '0',
  `order_total_amount` decimal(18,2) NOT NULL DEFAULT '0.00',
  `refund_amount` decimal(18,2) NOT NULL DEFAULT '0.00',
  `matched_count` int NOT NULL DEFAULT '0',
  `unmatched_count` int NOT NULL DEFAULT '0',
  `pending_split_count` int NOT NULL DEFAULT '0',
  `recognition_summary_valid` tinyint(1) NOT NULL DEFAULT '0',
  `failed_reason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `uploader_id` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `income_purpose` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `income_post_script` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `raw_columns` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `invoice_order_no_field_snapshot` json DEFAULT NULL,
  `upload_status` enum('processing','completed','failed','abnormal') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'completed',
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `of_task_idx` (`task_id`),
  KEY `of_account_idx` (`matched_account_name`),
  KEY `of_rule_idx` (`rule_id`),
  KEY `of_upload_status_idx` (`upload_status`),
  KEY `of_task_rule_created_idx` (`task_id`,`rule_id`,`created_at`),
  KEY `of_package_type_idx` (`detail_package_type`),
  KEY `of_upload_date_idx` (`upload_date`),
  KEY `of_multi_day_match_group_idx` (`multi_day_match_group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `order_recognition_summary_deltas` (
  `delta_type` enum('source_deduction','target_transfer_in') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `order_file_id` bigint unsigned NOT NULL,
  `task_id` bigint unsigned NOT NULL,
  `rule_id` bigint unsigned NOT NULL,
  `partition_date` date NOT NULL,
  `summary_kind` enum('file_total','rule_item') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `rule_item_id` bigint unsigned NOT NULL DEFAULT '0',
  `is_refund` tinyint(1) NOT NULL DEFAULT '0',
  `detail_count` int NOT NULL DEFAULT '0',
  `total_amount` decimal(18,2) NOT NULL DEFAULT '0.00',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`delta_type`,`order_file_id`,`task_id`,`rule_id`,`partition_date`,`summary_kind`,`rule_item_id`,`is_refund`),
  KEY `orsd_source_idx` (`delta_type`,`order_file_id`),
  KEY `orsd_target_idx` (`delta_type`,`task_id`,`rule_id`,`partition_date`),
  KEY `orsd_order_file_fk` (`order_file_id`),
  CONSTRAINT `orsd_order_file_fk` FOREIGN KEY (`order_file_id`) REFERENCES `order_files` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `project_details` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `project_id` bigint unsigned NOT NULL,
  `code` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `detail_info` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `pd_project_idx` (`project_id`),
  KEY `pd_code_idx` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `project_name_histories` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `project_id` bigint unsigned NOT NULL,
  `code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `platform_id` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `effective_date` timestamp NOT NULL DEFAULT (now()),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `pnh_project_idx` (`project_id`),
  KEY `pnh_created_idx` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `projects` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `parent_code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `level` int NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `is_active` int NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `platform_id` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `proj_code_idx` (`code`),
  KEY `proj_parent_idx` (`parent_code`),
  KEY `proj_level_idx` (`level`),
  KEY `proj_platform_idx` (`platform_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `recognition_date_summaries` (
  `bill_date` date NOT NULL,
  `primary_task_id` bigint unsigned NOT NULL,
  `status` enum('pending_recognition','processing','large_variance','partial_matched','completed','failed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending_recognition',
  `task_count` int NOT NULL DEFAULT '0',
  `bank_flow_total` decimal(18,2) NOT NULL DEFAULT '0.00',
  `bank_flow_income_total` decimal(18,2) NOT NULL DEFAULT '0.00',
  `bank_flow_count` int NOT NULL DEFAULT '0',
  `recognized_bank_flow_count` int NOT NULL DEFAULT '0',
  `bill_detail_total` decimal(18,2) NOT NULL DEFAULT '0.00',
  `bill_detail_count` int NOT NULL DEFAULT '0',
  `recognized_amount` decimal(18,2) NOT NULL DEFAULT '0.00',
  `matched_count` int NOT NULL DEFAULT '0',
  `unmatched_count` int NOT NULL DEFAULT '0',
  `pending_split_count` int NOT NULL DEFAULT '0',
  `diff_amount` decimal(18,2) NOT NULL DEFAULT '0.00',
  `has_detail_file` tinyint(1) NOT NULL DEFAULT '0',
  `variance_rule_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`bill_date`),
  KEY `rds_status_idx` (`status`),
  KEY `rds_updated_at_idx` (`updated_at`),
  KEY `rds_primary_task_idx` (`primary_task_id`),
  KEY `rds_status_bill_date_idx` (`status`,`bill_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `recognition_rule_exclude_conditions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `rule_id` bigint unsigned NOT NULL,
  `field_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `match_type` enum('等于','包含') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '等于',
  `keyword` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `rrec_rule_idx` (`rule_id`),
  CONSTRAINT `rrec_rule_fk` FOREIGN KEY (`rule_id`) REFERENCES `recognition_rules` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `recognition_rules` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `rule_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `matched_counterparty_alias` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `creator_id` bigint unsigned NOT NULL,
  `enabled_at` timestamp NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `date_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '时间',
  `income_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '金额',
  `order_no_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '订单号',
  `invoice_other_order_no_1_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `invoice_other_order_no_2_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `condition_recognition_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `exclude_order_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `exclude_order_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `exclude_order_keyword` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `refund_order_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `refund_judge_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `refund_judge_value` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `refund_direction_judge_value` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `refund_amount_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `detail_split_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `multi_split_keyword_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `multi_split_keyword` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `multi_split_match_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `detail_split_recognition_keyword_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '商品标题',
  `detail_split_income_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '买家实付金额',
  `detail_split_match_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '主订单编号',
  `detail_split_order_no_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '子订单编号',
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `rr_creator_idx` (`creator_id`),
  KEY `rr_active_idx` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `recognition_tasks` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `rule_id` bigint unsigned NOT NULL,
  `same_day_counterparty_id` bigint unsigned DEFAULT NULL,
  `bill_date` date NOT NULL,
  `creator_id` bigint unsigned NOT NULL,
  `status` enum('pending_details','processing','large_variance','partial_matched','completed','failed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending_details',
  `bank_flow_total` decimal(18,2) DEFAULT '0.00',
  `bill_detail_total` decimal(18,2) DEFAULT '0.00',
  `diff_amount` decimal(18,2) DEFAULT '0.00',
  `bank_flow_count` int DEFAULT '0',
  `bill_detail_count` int DEFAULT '0',
  `matched_count` int DEFAULT '0',
  `unmatched_count` int DEFAULT '0',
  `pending_split_count` int DEFAULT '0',
  `has_detail_file` tinyint(1) NOT NULL DEFAULT '0',
  `remark` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  UNIQUE KEY `rt_same_day_counterparty_date_uq` (`bill_date`,`same_day_counterparty_id`),
  KEY `rt_rule_idx` (`rule_id`),
  KEY `rt_status_idx` (`status`),
  KEY `rt_date_idx` (`bill_date`),
  KEY `rt_creator_idx` (`creator_id`),
  KEY `rt_date_rule_idx` (`bill_date`,`rule_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `role_permissions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `role` enum('operator','finance') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `permission_key` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `allowed` tinyint(1) NOT NULL DEFAULT '0',
  `updated_by` bigint unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `rp_role_permission_idx` (`role`,`permission_key`),
  KEY `rp_role_idx` (`role`),
  KEY `rp_permission_idx` (`permission_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `rule_item_splits` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `rule_item_id` bigint unsigned NOT NULL,
  `split_ratio` decimal(5,2) NOT NULL DEFAULT '100.00',
  `income_type` enum('捐赠收入','会费收入','政府补助','个税返还','本金','投资收益','利息','其他收入','其他') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `income_attr` enum('非限定性收入','限定性收入') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `income_dept` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `budget_code` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `income_project` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `management_fee_ratio` decimal(5,2) DEFAULT '0.00',
  `expense_fund_source` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `platform_project_name` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `platform_project_detail` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `ris_rule_item_idx` (`rule_item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `rule_items` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `rule_id` bigint unsigned NOT NULL,
  `keyword_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '商品名称',
  `detail_keyword` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `keyword_match_type` enum('等于','包含') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '等于',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `ri_rule_idx` (`rule_id`),
  KEY `ri_keyword_idx` (`detail_keyword`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `rule_update_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `operator_id` bigint unsigned NOT NULL,
  `operator_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `income_updated_count` int NOT NULL DEFAULT '0',
  `income_total_count` int NOT NULL DEFAULT '0',
  `detail_updated_count` int NOT NULL DEFAULT '0',
  `detail_total_count` int NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `rul_created_idx` (`created_at`),
  KEY `rul_operator_idx` (`operator_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `sessions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `token` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `expires_at` timestamp NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  UNIQUE KEY `sessions_token_unique` (`token`),
  KEY `sess_token_idx` (`token`),
  KEY `sess_user_idx` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `system_storage_snapshot` (
  `id` int unsigned NOT NULL,
  `request_date` date NOT NULL,
  `requested_archive_date` date NOT NULL,
  `status` enum('pending','capturing','completed','failed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `snapshot_date` date DEFAULT NULL,
  `archive_date` date DEFAULT NULL,
  `mount_path` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `total_bytes` bigint unsigned DEFAULT NULL,
  `used_bytes` bigint unsigned DEFAULT NULL,
  `available_bytes` bigint unsigned DEFAULT NULL,
  `usage_percent` decimal(5,2) DEFAULT NULL,
  `requested_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `captured_at` timestamp NULL DEFAULT NULL,
  `error_message` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  CONSTRAINT `system_storage_snapshot_single_row_chk` CHECK ((`id` = 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `unrecorded_counterparties` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `bank_name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `account_no` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `account_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `summary` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `purpose` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `post_script` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `first_seen_at` timestamp NOT NULL DEFAULT (now()),
  `last_seen_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  `occurrence_count` int NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `uc_account_no_idx` (`account_no`),
  KEY `uc_last_seen_idx` (`last_seen_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `users` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `role` enum('admin','operator','finance') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'operator',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `login_failed_attempts` int NOT NULL DEFAULT '0',
  `locked_at` timestamp NULL DEFAULT NULL,
  `two_factor_secret` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `two_factor_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `two_factor_enabled_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  UNIQUE KEY `users_username_unique` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `voucher_receipt_channels` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `channel_code` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '收款渠道编号',
  `channel_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '收款渠道名称',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `vrc_channel_code_idx` (`channel_code`),
  KEY `vrc_channel_name_idx` (`channel_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='凭证收款渠道';

CREATE TABLE `voucher_result_flows` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `voucher_result_id` bigint unsigned NOT NULL,
  `bank_flow_id` bigint unsigned NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `vrf_result_flow_unique_idx` (`voucher_result_id`,`bank_flow_id`),
  KEY `vrf_result_idx` (`voucher_result_id`),
  KEY `vrf_flow_idx` (`bank_flow_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `voucher_result_lines` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `voucher_result_id` bigint unsigned NOT NULL,
  `match_result_id` bigint unsigned DEFAULT NULL,
  `line_no` int NOT NULL,
  `line_type` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'overview',
  `summary` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `subject_code` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `subject_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `debit_amount` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `credit_amount` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `explanation_json` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `vrl_result_idx` (`voucher_result_id`),
  KEY `vrl_match_result_idx` (`match_result_id`),
  KEY `vrl_line_no_idx` (`voucher_result_id`,`line_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `voucher_results` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `source_flow_id` bigint unsigned NOT NULL,
  `voucher_date` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `reference_text` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `voucher_kind` enum('generated','manual') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'generated',
  `voucher_key` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'generated',
  `voucher_id_text` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `income_type` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `voucher_amount` decimal(18,2) DEFAULT NULL,
  `creation_group_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_aggregate` int NOT NULL DEFAULT '0',
  `aggregate_flow_count` int NOT NULL DEFAULT '1',
  `created_by` bigint unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `vr_source_key_uq` (`source_flow_id`,`voucher_key`),
  KEY `vr_source_flow_idx` (`source_flow_id`),
  KEY `vr_created_at_idx` (`created_at`),
  KEY `vr_kind_idx` (`voucher_kind`),
  KEY `vr_creation_group_idx` (`creation_group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `voucher_template_settings` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `setting_key` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `templates` json NOT NULL,
  `updated_by` bigint unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `vts_setting_key_idx` (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS=@fresh_old_fk;

DELIMITER ;;
CREATE PROCEDURE `archive_bill_details_daily`()
archive_daily: BEGIN
  DECLARE cutoff_date DATE;
  DECLARE hot_start DATE;
  DECLARE candidate_date DATE;
  DECLARE remaining_count BIGINT UNSIGNED DEFAULT 0;
  DECLARE processed_date_count INT DEFAULT 0;

  SET cutoff_date = DATE_SUB(CURDATE(), INTERVAL 60 DAY);
  SET hot_start = DATE_ADD(cutoff_date, INTERVAL 1 DAY);

  CALL archive_bill_details_day(cutoff_date);

  -- 只选择已经可以归档的历史日期；未认账 p_late 行不阻塞后续日期。
  late_date_loop: LOOP
    IF processed_date_count >= 31 THEN
      LEAVE late_date_loop;
    END IF;

    SELECT MIN(bd.partition_date)
      INTO candidate_date
    FROM bill_details bd
    WHERE bd.partition_date >= '1970-01-02'
      AND bd.partition_date < hot_start
      AND bd.match_result_id IS NOT NULL;

    IF candidate_date IS NULL THEN
      LEAVE late_date_loop;
    END IF;

    CALL archive_bill_details_day(candidate_date);

    SELECT COUNT(*)
      INTO remaining_count
    FROM bill_details bd
    WHERE bd.partition_date = candidate_date
      AND bd.match_result_id IS NOT NULL;

    -- 仍有可归档行说明任务被跳过或批次失败，留到下一次事件重试。
    IF remaining_count > 0 THEN
      LEAVE late_date_loop;
    END IF;

    SET processed_date_count = processed_date_count + 1;
  END LOOP;

  CALL roll_bill_details_hot_window();
END;;

CREATE PROCEDURE `archive_bill_details_daily_with_storage_request`()
BEGIN
  CALL archive_bill_details_daily();
  CALL sync_archived_match_result_statuses();
  CALL sync_archived_manual_order_work_items();

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
END;;

CREATE PROCEDURE `archive_bill_details_day`(IN target_date DATE)
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
      '`) bd WHERE bd.partition_date = ? ',
      'AND bd.match_result_id IS NOT NULL ',
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
END;;

CREATE PROCEDURE `ensure_bill_details_archive_month_table`(IN input_date DATE)
BEGIN
  DECLARE month_start DATE;
  DECLARE next_month_start DATE;
  DECLARE day_cursor DATE;
  DECLARE archive_table_name VARCHAR(64);
  DECLARE partition_sql LONGTEXT;
  DECLARE separator_text VARCHAR(2) DEFAULT '';
  DECLARE existing_table_count INT DEFAULT 0;

  IF input_date IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'archive month input date is required';
  END IF;

  SET month_start = STR_TO_DATE(DATE_FORMAT(input_date, '%Y-%m-01'), '%Y-%m-%d');
  SET next_month_start = DATE_ADD(month_start, INTERVAL 1 MONTH);
  SET archive_table_name = CONCAT('bill_details_archive_', DATE_FORMAT(month_start, '%Y%m'));

  SELECT COUNT(*)
    INTO existing_table_count
  FROM information_schema.tables
  WHERE table_schema = DATABASE()
    AND table_name = archive_table_name;

  IF existing_table_count = 0 THEN
    SET @create_archive_table_sql = CONCAT(
      'CREATE TABLE `',
      archive_table_name,
      '` LIKE bill_details'
    );
    PREPARE create_archive_table_stmt FROM @create_archive_table_sql;
    EXECUTE create_archive_table_stmt;
    DEALLOCATE PREPARE create_archive_table_stmt;

    SET @remove_archive_partition_sql = CONCAT(
      'ALTER TABLE `',
      archive_table_name,
      '` REMOVE PARTITIONING'
    );
    PREPARE remove_archive_partition_stmt FROM @remove_archive_partition_sql;
    EXECUTE remove_archive_partition_stmt;
    DEALLOCATE PREPARE remove_archive_partition_stmt;

    SET partition_sql = CONCAT(
      'ALTER TABLE `',
      archive_table_name,
      '` PARTITION BY RANGE COLUMNS(partition_date) (',
      'PARTITION p_before VALUES LESS THAN (''',
      DATE_FORMAT(month_start, '%Y-%m-%d'),
      ''')'
    );

    SET day_cursor = month_start;
    SET separator_text = ', ';
    WHILE day_cursor < next_month_start DO
      SET partition_sql = CONCAT(
        partition_sql,
        separator_text,
        'PARTITION p',
        DATE_FORMAT(day_cursor, '%Y%m%d'),
        ' VALUES LESS THAN (''',
        DATE_FORMAT(DATE_ADD(day_cursor, INTERVAL 1 DAY), '%Y-%m-%d'),
        ''')'
      );
      SET day_cursor = DATE_ADD(day_cursor, INTERVAL 1 DAY);
    END WHILE;

    SET partition_sql = CONCAT(
      partition_sql,
      ', PARTITION p_future VALUES LESS THAN (MAXVALUE))'
    );

    SET @archive_partition_sql = partition_sql;
    PREPARE archive_partition_stmt FROM @archive_partition_sql;
    EXECUTE archive_partition_stmt;
    DEALLOCATE PREPARE archive_partition_stmt;
  END IF;
END;;

CREATE PROCEDURE `ensure_bill_details_archive_tables_around`(IN anchor_date DATE)
BEGIN
  IF anchor_date IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'archive table anchor date is required';
  END IF;

  CALL ensure_bill_details_archive_month_table(DATE_SUB(anchor_date, INTERVAL 1 MONTH));
  CALL ensure_bill_details_archive_month_table(anchor_date);
  CALL ensure_bill_details_archive_month_table(DATE_ADD(anchor_date, INTERVAL 1 MONTH));
END;;

CREATE PROCEDURE `ensure_bill_details_next_month_partitions`()
BEGIN
  CALL ensure_bill_details_rolling_partitions();
END;;

CREATE PROCEDURE `ensure_bill_details_rolling_partitions`()
BEGIN
  DECLARE p_future_position INT DEFAULT 0;
  DECLARE p_future_lower_bound DATE;
  DECLARE target_end DATE;
  DECLARE day_cursor DATE;
  DECLARE partition_sql LONGTEXT;
  DECLARE separator_text VARCHAR(2) DEFAULT '';
  DECLARE days_to_create INT DEFAULT 0;
  DECLARE error_message VARCHAR(255);

  SELECT partition_ordinal_position
    INTO p_future_position
  FROM information_schema.partitions
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_details'
    AND partition_name = 'p_future'
    AND partition_description = 'MAXVALUE'
  LIMIT 1;

  IF p_future_position IS NULL OR p_future_position = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'bill_details partition p_future not found';
  END IF;

  SELECT STR_TO_DATE(REPLACE(partition_description, '''', ''), '%Y-%m-%d')
    INTO p_future_lower_bound
  FROM information_schema.partitions
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_details'
    AND partition_ordinal_position < p_future_position
    AND partition_description <> 'MAXVALUE'
  ORDER BY partition_ordinal_position DESC
  LIMIT 1;

  IF p_future_lower_bound IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'bill_details p_future lower bound cannot be determined';
  END IF;

  SET target_end = DATE_ADD(CURDATE(), INTERVAL 1 DAY);

  IF p_future_lower_bound >= target_end THEN
    SELECT
      p_future_lower_bound AS p_future_lower_bound,
      target_end AS rolling_partition_target_end,
      'skip: current day is already covered by an explicit partition' AS partition_maintenance_status;
  ELSE
    SET days_to_create = DATEDIFF(target_end, p_future_lower_bound);
    IF days_to_create > 400 THEN
      SET error_message = CONCAT(
        'bill_details p_future gap is too large: ',
        days_to_create,
        ' days'
      );
      SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = error_message;
    END IF;

    SET partition_sql = 'ALTER TABLE bill_details REORGANIZE PARTITION p_future INTO (';
    SET day_cursor = p_future_lower_bound;

    WHILE day_cursor < target_end DO
      SET partition_sql = CONCAT(
        partition_sql,
        separator_text,
        'PARTITION p',
        DATE_FORMAT(day_cursor, '%Y%m%d'),
        ' VALUES LESS THAN (''',
        DATE_FORMAT(DATE_ADD(day_cursor, INTERVAL 1 DAY), '%Y-%m-%d'),
        ''')'
      );
      SET separator_text = ', ';
      SET day_cursor = DATE_ADD(day_cursor, INTERVAL 1 DAY);
    END WHILE;

    SET partition_sql = CONCAT(
      partition_sql,
      separator_text,
      'PARTITION p_future VALUES LESS THAN (MAXVALUE))'
    );

    SET @bill_details_partition_sql = partition_sql;
    PREPARE bill_details_partition_stmt FROM @bill_details_partition_sql;
    EXECUTE bill_details_partition_stmt;
    DEALLOCATE PREPARE bill_details_partition_stmt;
  END IF;
END;;

CREATE PROCEDURE `roll_bill_details_hot_window`()
roll_window: BEGIN
  DECLARE cutoff_date DATE;
  DECLARE hot_start DATE;
  DECLARE late_partition_count INT DEFAULT 0;
  DECLARE expired_partition_count INT DEFAULT 0;
  DECLARE expired_partition_list LONGTEXT;
  DECLARE expired_partition_processing_count BIGINT UNSIGNED DEFAULT 0;

  SET cutoff_date = DATE_SUB(CURDATE(), INTERVAL 60 DAY);
  SET hot_start = DATE_ADD(cutoff_date, INTERVAL 1 DAY);
  SET SESSION group_concat_max_len = 1000000;

  SELECT COUNT(*)
    INTO late_partition_count
  FROM information_schema.partitions
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_details'
    AND partition_name = 'p_late';

  SELECT
    COUNT(*),
    GROUP_CONCAT(
      CONCAT('`', REPLACE(partition_name, '`', '``'), '`')
      ORDER BY partition_ordinal_position
      SEPARATOR ', '
    )
    INTO expired_partition_count, expired_partition_list
  FROM information_schema.partitions
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_details'
    AND partition_name REGEXP '^p[0-9]{8}$'
    AND partition_description <> 'MAXVALUE'
    AND STR_TO_DATE(REPLACE(partition_description, '''', ''), '%Y-%m-%d') <= hot_start;

  IF expired_partition_count = 0 OR late_partition_count = 0 THEN
    LEAVE roll_window;
  END IF;

  SET @expired_partition_processing_count = 0;
  SET @expired_partition_processing_sql = CONCAT(
    'SELECT (',
    'EXISTS(SELECT 1 FROM bill_details PARTITION (',
    expired_partition_list,
    ') bd INNER JOIN recognition_tasks rt ON rt.id = bd.task_id ',
    'WHERE rt.status = ''processing'' LIMIT 1) ',
    'OR EXISTS(SELECT 1 FROM bill_details PARTITION (',
    expired_partition_list,
    ') bd INNER JOIN detail_split_files dsf ON dsf.id = bd.detail_split_file_id ',
    'WHERE (dsf.upload_status = ''processing'' ',
    'OR dsf.recognition_phase IN (''finding_tasks'', ''recognizing'')) LIMIT 1)',
    ') INTO @expired_partition_processing_count'
  );
  PREPARE expired_partition_processing_stmt FROM @expired_partition_processing_sql;
  EXECUTE expired_partition_processing_stmt;
  DEALLOCATE PREPARE expired_partition_processing_stmt;
  SET expired_partition_processing_count =
    COALESCE(@expired_partition_processing_count, 0);

  -- 非空过期日分区只要没有任务执行中即可并入 p_late；未认账行继续留在热表。
  IF expired_partition_processing_count > 0 THEN
    LEAVE roll_window;
  END IF;

  SET @roll_partition_sql = CONCAT(
    'ALTER TABLE bill_details REORGANIZE PARTITION `p_late`, ',
    expired_partition_list,
    ' INTO (PARTITION p_late VALUES LESS THAN (''',
    DATE_FORMAT(hot_start, '%Y-%m-%d'),
    '''))'
  );
  PREPARE roll_partition_stmt FROM @roll_partition_sql;
  EXECUTE roll_partition_stmt;
  DEALLOCATE PREPARE roll_partition_stmt;
END;;

CREATE PROCEDURE `sync_archived_manual_order_work_items`()
sync_work_items: BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE run_id_value BIGINT UNSIGNED;
  DECLARE archive_date_value DATE;
  DECLARE archive_table_value VARCHAR(64);
  DECLARE archive_completed_at_value TIMESTAMP;
  DECLARE archive_table_count INT DEFAULT 0;
  DECLARE error_text VARCHAR(1000);

  DECLARE run_cursor CURSOR FOR
    SELECT id, archive_date, archive_table, completed_at
    FROM bill_detail_archive_runs
    WHERE status = 'completed'
      AND completed_at IS NOT NULL
      AND (
        manual_work_items_synced_at IS NULL
        OR manual_work_items_synced_at < completed_at
      )
    ORDER BY archive_date, id;

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  OPEN run_cursor;
  run_loop: LOOP
    FETCH run_cursor
      INTO run_id_value, archive_date_value, archive_table_value, archive_completed_at_value;
    IF done = 1 THEN
      LEAVE run_loop;
    END IF;

    IF archive_table_value IS NULL
       OR archive_table_value NOT REGEXP '^bill_details_archive_[0-9]{6}$' THEN
      SET error_text = CONCAT(
        'invalid bill detail archive table in run ',
        run_id_value,
        ': ',
        COALESCE(archive_table_value, 'NULL')
      );
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_text;
    END IF;

    SELECT COUNT(*)
      INTO archive_table_count
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = archive_table_value;

    IF archive_table_count <> 1 THEN
      SET error_text = CONCAT(
        'bill detail archive table is missing for run ',
        run_id_value,
        ': ',
        archive_table_value
      );
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_text;
    END IF;

    SET @manual_archive_date = archive_date_value;
    SET @manual_archive_table = archive_table_value;
    SET @sync_manual_work_items_sql = CONCAT(
      'UPDATE manual_order_work_items work_item ',
      'INNER JOIN `',
      REPLACE(archive_table_value, '`', '``'),
      '` bd ON bd.id = work_item.detail_id ',
      'AND bd.partition_date = work_item.partition_date ',
      'LEFT JOIN order_files ofl ON ofl.id = bd.order_file_id ',
      'LEFT JOIN recognition_tasks rt ON rt.id = bd.task_id ',
      'LEFT JOIN recognition_rules rr ',
      'ON rr.id = COALESCE(bd.rule_id, ofl.rule_id, rt.rule_id) ',
      'SET ',
      'work_item.task_id = bd.task_id, ',
      'work_item.original_task_id = bd.original_task_id, ',
      'work_item.order_file_id = bd.order_file_id, ',
      'work_item.rule_id = COALESCE(bd.rule_id, ofl.rule_id, rt.rule_id, 0), ',
      'work_item.summary_date = COALESCE(rt.bill_date, bd.partition_date), ',
      'work_item.partition_date = bd.partition_date, ',
      'work_item.bill_date = bd.bill_date, ',
      'work_item.upload_date = ofl.upload_date, ',
      'work_item.bill_no = bd.bill_no, ',
      'work_item.rule_name = COALESCE(rr.rule_name, ''''), ',
      'work_item.description = bd.description, ',
      'work_item.total_amount = bd.total_amount, ',
      'work_item.detail_package_type = COALESCE(ofl.detail_package_type, ''T+1''), ',
      'work_item.operation_status = bd.operation_status, ',
      'work_item.display_status = CASE ',
      'WHEN bd.operation_status = ''transferred'' AND bd.match_result_id IS NOT NULL ',
      'THEN ''transferred_recognized'' ',
      'WHEN bd.operation_status = ''transferred'' THEN ''transferred'' ',
      'ELSE ''ignored'' END, ',
      'work_item.match_result_id = bd.match_result_id, ',
      'work_item.operation_reason = bd.ignore_reason, ',
      'work_item.storage_location = ''archive'', ',
      'work_item.archive_table = ?, ',
      'work_item.updated_at = NOW() ',
      'WHERE work_item.storage_location = ''hot'' ',
      'AND bd.partition_date = ?'
    );
    PREPARE sync_manual_work_items_stmt FROM @sync_manual_work_items_sql;
    EXECUTE sync_manual_work_items_stmt USING @manual_archive_table, @manual_archive_date;
    DEALLOCATE PREPARE sync_manual_work_items_stmt;

    UPDATE bill_detail_archive_runs
    SET manual_work_items_synced_at = NOW()
    WHERE id = run_id_value
      AND completed_at = archive_completed_at_value;
  END LOOP;
  CLOSE run_cursor;
END;;

CREATE PROCEDURE `sync_archived_match_result_statuses`()
sync_statuses: BEGIN
  DECLARE done INT DEFAULT 0;
  DECLARE run_id_value BIGINT UNSIGNED;
  DECLARE archive_date_value DATE;
  DECLARE archive_table_value VARCHAR(64);
  DECLARE archive_completed_at_value TIMESTAMP;
  DECLARE archive_table_count INT DEFAULT 0;
  DECLARE error_text VARCHAR(1000);

  DECLARE run_cursor CURSOR FOR
    SELECT id, archive_date, archive_table, completed_at
    FROM bill_detail_archive_runs
    WHERE status = 'completed'
      AND completed_at IS NOT NULL
      AND (
        recognition_status_synced_at IS NULL
        OR recognition_status_synced_at < completed_at
      )
    ORDER BY archive_date, id;

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = 1;

  OPEN run_cursor;
  run_loop: LOOP
    FETCH run_cursor
      INTO run_id_value, archive_date_value, archive_table_value, archive_completed_at_value;
    IF done = 1 THEN
      LEAVE run_loop;
    END IF;

    IF archive_table_value IS NULL
       OR archive_table_value NOT REGEXP '^bill_details_archive_[0-9]{6}$' THEN
      SET error_text = CONCAT(
        'invalid bill detail archive table in run ',
        run_id_value,
        ': ',
        COALESCE(archive_table_value, 'NULL')
      );
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_text;
    END IF;

    SELECT COUNT(*)
      INTO archive_table_count
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = archive_table_value;

    IF archive_table_count <> 1 THEN
      SET error_text = CONCAT(
        'bill detail archive table is missing for run ',
        run_id_value,
        ': ',
        archive_table_value
      );
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_text;
    END IF;

    SET @sync_archive_date = archive_date_value;
    SET @sync_archived_match_results_sql = CONCAT(
      'UPDATE match_results mr ',
      'INNER JOIN (',
      'SELECT DISTINCT archived_detail.match_result_id ',
      'FROM `',
      REPLACE(archive_table_value, '`', '``'),
      '` archived_detail ',
      'WHERE archived_detail.partition_date = ? ',
      'AND archived_detail.match_result_id IS NOT NULL',
      ') archived_result ON archived_result.match_result_id = mr.id ',
      'SET mr.has_archived_details = 1'
    );
    PREPARE sync_archived_match_results_stmt FROM @sync_archived_match_results_sql;
    EXECUTE sync_archived_match_results_stmt USING @sync_archive_date;
    DEALLOCATE PREPARE sync_archived_match_results_stmt;

    UPDATE bill_detail_archive_runs
    SET recognition_status_synced_at = NOW()
    WHERE id = run_id_value
      AND completed_at = archive_completed_at_value;
  END LOOP;
  CLOSE run_cursor;

  SET @sync_archive_date = NULL;
  SET @sync_archived_match_results_sql = NULL;
END;;

DELIMITER ;

-- Start a rolling 60-day hot window relative to the installation date.
SET @fresh_partition_sql = CONCAT(
 'ALTER TABLE bill_details REORGANIZE PARTITION p_late,p_future INTO (PARTITION p_late VALUES LESS THAN (''',
 DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 59 DAY), '%Y-%m-%d'),
 '''), PARTITION p_future VALUES LESS THAN (MAXVALUE))'
);
PREPARE fresh_partition_stmt FROM @fresh_partition_sql;
EXECUTE fresh_partition_stmt;
DEALLOCATE PREPARE fresh_partition_stmt;
CALL ensure_bill_details_rolling_partitions();
