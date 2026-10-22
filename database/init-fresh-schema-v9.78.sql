
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
DROP TABLE IF EXISTS `bank_flows`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bank_flows` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `task_id` bigint unsigned NOT NULL,
  `bank_name` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '广发银行',
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
  KEY `bf_recognition_status_idx` (`recognition_status`),
  KEY `bf_task_id_idx` (`task_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `bill_details`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bill_details` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `task_id` bigint unsigned NOT NULL,
  `rule_id` bigint unsigned DEFAULT NULL,
  `order_file_id` bigint unsigned DEFAULT NULL,
  `detail_split_file_id` bigint unsigned DEFAULT NULL,
  `split_source_detail_id` bigint unsigned DEFAULT NULL,
  `bill_no` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bill_date` date NOT NULL,
  `description` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(18,2) NOT NULL,
  `quantity` int DEFAULT '1',
  `unit_price` decimal(18,2) DEFAULT NULL,
  `tax_amount` decimal(18,2) DEFAULT '0.00',
  `total_amount` decimal(18,2) NOT NULL,
  `refund_amount_snapshot` decimal(18,2) NOT NULL DEFAULT '0.00',
  `counterparty` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `category` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `matched_account_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `match_status` enum('unmatched','matched','pending_split','ignored','manual_ignored') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unmatched',
  `match_result_id` bigint unsigned DEFAULT NULL,
  `operation_status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `original_task_id` bigint unsigned DEFAULT NULL,
  `rule_item_id` bigint unsigned DEFAULT NULL,
  `ignore_reason` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `raw_data` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  UNIQUE KEY `bd_rule_date_bill_no_uq` (`rule_id`,`bill_date`,`bill_no`),
  KEY `bd_task_idx` (`task_id`),
  KEY `bd_order_file_idx` (`order_file_id`),
  KEY `bd_desc_idx` (`description`),
  KEY `bd_amount_idx` (`amount`),
  KEY `bd_status_idx` (`match_status`),
  KEY `bd_match_result_idx` (`match_result_id`),
  KEY `bd_bill_date_idx` (`bill_date`),
  KEY `bd_account_idx` (`matched_account_name`),
  KEY `bd_task_status_idx` (`task_id`,`match_status`),
  KEY `bd_operation_status_idx` (`operation_status`),
  KEY `bd_original_task_idx` (`original_task_id`),
  KEY `bd_detail_split_file_idx` (`detail_split_file_id`),
  KEY `bd_split_source_detail_idx` (`split_source_detail_id`),
  KEY `bd_rule_detail_split_status_idx` (`rule_id`,`detail_split_file_id`,`match_status`,`match_result_id`),
  KEY `bd_order_pending_split_idx` (`order_file_id`,`match_status`,`match_result_id`),
  KEY `bd_order_rec_item_idx` (`order_file_id`,`match_status`,`match_result_id`,`rule_item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `budget_code_histories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `budget_code_histories` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `budget_code_id` bigint unsigned NOT NULL,
  `code` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `effective_date` timestamp NOT NULL DEFAULT (now()),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `income_project` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `platform_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `bch_budget_idx` (`budget_code_id`),
  KEY `bch_created_idx` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `budget_codes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
  `platform_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `budget_parent_idx` (`parent_id`),
  KEY `budget_level_idx` (`level`),
  KEY `budget_leaf_idx` (`is_leaf`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `counterparty_match_accounts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `counterparty_match_accounts` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `counterparty_record_id` bigint unsigned NOT NULL,
  `account_no` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `account_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `purpose` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `post_script` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `is_active` int NOT NULL DEFAULT '1',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `cma_record_idx` (`counterparty_record_id`),
  KEY `cma_account_idx` (`account_no`),
  KEY `cma_active_idx` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `counterparty_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `counterparty_records` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `account_no` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `account_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `purpose` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `post_script` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `alias` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `detail_matching_mode` enum('单笔匹配','同日汇总匹配') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '单笔匹配',
  `arrival_region` enum('北京市','外省市','港澳台','境外','内部客商') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recognition_type` enum('到账认账','明细认账') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '到账认账',
  `detail_package_type` enum('T+1','打包明细') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'T+1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `cr_account_no_idx` (`account_no`),
  KEY `cr_alias_idx` (`alias`),
  KEY `cr_recognition_type_idx` (`recognition_type`),
  KEY `cr_detail_package_type_idx` (`detail_package_type`),
  KEY `cr_detail_matching_mode_idx` (`detail_matching_mode`),
  KEY `cr_arrival_region_idx` (`arrival_region`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `departments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `detail_split_files`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `detail_split_files` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `order_file_id` bigint unsigned DEFAULT NULL,
  `task_id` bigint unsigned DEFAULT NULL,
  `rule_id` bigint unsigned NOT NULL,
  `file_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `match_field` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `income_field` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `recognition_keyword_field` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `raw_columns` text COLLATE utf8mb4_unicode_ci,
  `upload_status` enum('processing','completed','failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'completed',
  `entry_count` int NOT NULL DEFAULT '0',
  `processed_count` int NOT NULL DEFAULT '0',
  `matched_count` int NOT NULL DEFAULT '0',
  `unmatched_count` int NOT NULL DEFAULT '0',
  `pending_recognition_count` int NOT NULL DEFAULT '0',
  `recognized_count` int NOT NULL DEFAULT '0',
  `failed_reason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `uploader_id` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `dsf_order_file_idx` (`order_file_id`),
  KEY `dsf_task_idx` (`task_id`),
  KEY `dsf_rule_idx` (`rule_id`),
  KEY `dsf_upload_status_idx` (`upload_status`),
  KEY `dsf_created_at_idx` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `donation_activities`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `fundraising_platforms`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fundraising_platforms` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `platform_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  UNIQUE KEY `fundraising_platforms_platform_id_unique` (`platform_id`),
  KEY `fp_platform_id_idx` (`platform_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `income_recognition_rules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
  `matched_counterparty_alias` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recognition_type` enum('银行直捐','渠道捐赠') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '渠道捐赠',
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `income_rule_splits`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `income_rule_splits` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `income_rule_id` bigint unsigned NOT NULL,
  `split_form` enum('百分比','认账时填写') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '百分比',
  `split_ratio` decimal(5,2) NOT NULL DEFAULT '100.00',
  `income_type` enum('捐赠收入','会费收入','政府补助','其他') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `income_attr` enum('非限定性收入','限定性收入') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `income_dept` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `budget_code` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `income_project` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `management_fee_ratio` decimal(5,2) DEFAULT '0.00',
  `expense_fund_source` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `platform_project_name` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `platform_project_detail` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `feedback_type` enum('反馈','重点反馈') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `member_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `region` enum('北京市','外省市','港澳台','境外','内部客商') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_anonymous` int NOT NULL DEFAULT '0',
  `management_fee_type` enum('比例','金额') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '比例',
  `management_fee_value` decimal(18,2) DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `irs_rule_idx` (`income_rule_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `match_results`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `match_results` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `task_id` bigint unsigned NOT NULL,
  `rule_item_id` bigint unsigned DEFAULT NULL,
  `income_type` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `income_attr` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `income_dept` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `budget_code` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `income_project` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `management_fee_ratio` decimal(5,2) DEFAULT '0.00',
  `management_fee_amount` decimal(18,2) DEFAULT '0.00',
  `expense_fund_source` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `total_amount` decimal(18,2) NOT NULL,
  `split_amount` decimal(18,2) NOT NULL,
  `split_ratio` decimal(5,2) DEFAULT '100.00',
  `voucher_status` enum('pending','created') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `detail_count` int NOT NULL DEFAULT '0',
  `entry_time` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `income_rule_id` bigint unsigned DEFAULT NULL,
  `bank_flow_id` bigint unsigned DEFAULT NULL,
  `platform_project_name` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `platform_project_display_name` varchar(700) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `platform_project_detail` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_reference_no` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_transaction_time` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_income` decimal(18,2) DEFAULT NULL,
  `bank_counterparty_account` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_counterparty_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_counterparty_bank` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_summary` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_purpose` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bank_post_script` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `member_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `region` enum('北京市','外省市','港澳台','境外','内部客商') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_anonymous` int NOT NULL DEFAULT '0',
  `management_fee_type` enum('比例','金额') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '比例',
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
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `order_files`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `order_files` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `task_id` bigint unsigned NOT NULL,
  `file_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `rule_id` bigint unsigned DEFAULT NULL,
  `detail_package_type` enum('T+1','打包明细') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'T+1',
  `upload_date` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `matched_account_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `entry_count` int NOT NULL DEFAULT '0',
  `processed_count` int NOT NULL DEFAULT '0',
  `order_total_amount` decimal(18,2) NOT NULL DEFAULT '0.00',
  `refund_amount` decimal(18,2) NOT NULL DEFAULT '0.00',
  `matched_count` int NOT NULL DEFAULT '0',
  `unmatched_count` int NOT NULL DEFAULT '0',
  `pending_split_count` int NOT NULL DEFAULT '0',
  `failed_reason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `uploader_id` bigint unsigned NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `income_purpose` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `income_post_script` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `raw_columns` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `upload_status` enum('processing','completed','failed','abnormal') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'completed',
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `of_task_idx` (`task_id`),
  KEY `of_account_idx` (`matched_account_name`),
  KEY `of_rule_idx` (`rule_id`),
  KEY `of_upload_status_idx` (`upload_status`),
  KEY `of_task_rule_created_idx` (`task_id`,`rule_id`,`created_at`),
  KEY `of_package_type_idx` (`detail_package_type`),
  KEY `of_upload_date_idx` (`upload_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `project_details`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `project_details` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `project_id` bigint unsigned NOT NULL,
  `code` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `detail_info` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `pd_project_idx` (`project_id`),
  KEY `pd_code_idx` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `project_name_histories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `project_name_histories` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `project_id` bigint unsigned NOT NULL,
  `code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `platform_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `effective_date` timestamp NOT NULL DEFAULT (now()),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `pnh_project_idx` (`project_id`),
  KEY `pnh_created_idx` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `projects`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
  `platform_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `proj_code_idx` (`code`),
  KEY `proj_parent_idx` (`parent_code`),
  KEY `proj_level_idx` (`level`),
  KEY `proj_platform_idx` (`platform_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `recognition_date_summaries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `recognition_date_summaries` (
  `bill_date` date NOT NULL,
  `primary_task_id` bigint unsigned NOT NULL,
  `status` enum('pending_recognition','processing','large_variance','partial_matched','completed','failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending_recognition',
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
  `variance_rule_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`bill_date`),
  KEY `rds_status_idx` (`status`),
  KEY `rds_updated_at_idx` (`updated_at`),
  KEY `rds_primary_task_idx` (`primary_task_id`),
  KEY `rds_status_bill_date_idx` (`status`,`bill_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `recognition_rules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `recognition_rules` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `rule_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `matched_counterparty_alias` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `creator_id` bigint unsigned NOT NULL,
  `enabled_at` timestamp NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `date_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '时间',
  `income_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '金额',
  `order_no_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '订单号',
  `condition_recognition_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `exclude_order_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `exclude_order_field` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `exclude_order_keyword` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `refund_order_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `refund_judge_field` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `refund_judge_value` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `refund_direction_judge_value` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `refund_amount_field` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `detail_split_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `multi_split_keyword_field` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `multi_split_keyword` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `multi_split_match_field` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `detail_split_recognition_keyword_field` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '商品标题',
  `detail_split_income_field` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '买家实付金额',
  `detail_split_match_field` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '主订单编号',
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `rr_creator_idx` (`creator_id`),
  KEY `rr_active_idx` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `recognition_tasks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `recognition_tasks` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `rule_id` bigint unsigned NOT NULL,
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
  KEY `rt_rule_idx` (`rule_id`),
  KEY `rt_status_idx` (`status`),
  KEY `rt_date_idx` (`bill_date`),
  KEY `rt_creator_idx` (`creator_id`),
  KEY `rt_date_rule_idx` (`bill_date`,`rule_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `rule_item_splits`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `rule_item_splits` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `rule_item_id` bigint unsigned NOT NULL,
  `split_ratio` decimal(5,2) NOT NULL DEFAULT '100.00',
  `income_type` enum('捐赠收入','会费收入','政府补助','其他') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `income_attr` enum('非限定性收入','限定性收入') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `income_dept` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `budget_code` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `income_project` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `management_fee_ratio` decimal(5,2) DEFAULT '0.00',
  `expense_fund_source` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `platform_project_name` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `platform_project_detail` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `ris_rule_item_idx` (`rule_item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `rule_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `rule_items` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `rule_id` bigint unsigned NOT NULL,
  `keyword_field` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '商品名称',
  `detail_keyword` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `keyword_match_type` enum('等于','包含') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '等于',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  KEY `ri_rule_idx` (`rule_id`),
  KEY `ri_keyword_idx` (`detail_keyword`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `rule_update_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `rule_update_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `operator_id` bigint unsigned NOT NULL,
  `operator_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
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
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
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
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `unrecorded_counterparties`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `unrecorded_counterparties` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `account_no` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `account_name` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
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
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `role` enum('admin','operator') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'operator',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `id` (`id`),
  UNIQUE KEY `users_username_unique` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;
