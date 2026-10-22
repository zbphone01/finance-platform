-- v10.45: 明细认账支持多日汇总匹配、候选方案确认和跨日流水组合。

ALTER TABLE `counterparty_records`
  MODIFY COLUMN `detail_matching_mode` ENUM('单笔匹配','同日汇总匹配','多日汇总匹配')
  COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '单笔匹配';

CREATE TABLE IF NOT EXISTS `multi_day_match_groups` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `rule_id` BIGINT UNSIGNED NOT NULL,
  `status` ENUM('unmatched','pending_confirmation','matched') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unmatched',
  `anchor_task_id` BIGINT UNSIGNED NULL,
  `latest_bill_date` DATE NULL,
  `package_total` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `mdmg_rule_status_idx` (`rule_id`, `status`),
  KEY `mdmg_anchor_task_idx` (`anchor_task_id`),
  KEY `mdmg_latest_bill_date_idx` (`latest_bill_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `multi_day_match_group_flows` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `group_id` BIGINT UNSIGNED NOT NULL,
  `bank_flow_id` BIGINT UNSIGNED NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `mdmgf_bank_flow_uq` (`bank_flow_id`),
  UNIQUE KEY `mdmgf_group_flow_uq` (`group_id`, `bank_flow_id`),
  KEY `mdmgf_group_idx` (`group_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `order_files`
  ADD COLUMN `multi_day_match_group_id` BIGINT UNSIGNED NULL AFTER `upload_date`,
  ADD KEY `of_multi_day_match_group_idx` (`multi_day_match_group_id`);
