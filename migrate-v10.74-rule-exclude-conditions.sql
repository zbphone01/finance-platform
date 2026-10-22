-- v10.74: 明细认账规则支持多组排除条件和“等于/包含”匹配方式。
-- 旧单条件字段继续保留，用于旧版本代码回退和兼容读取。

CREATE TABLE IF NOT EXISTS `recognition_rule_exclude_conditions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `rule_id` bigint unsigned NOT NULL,
  `field_name` varchar(100) NOT NULL,
  `match_type` enum('等于','包含') NOT NULL DEFAULT '等于',
  `keyword` varchar(500) NOT NULL,
  `sort_order` int NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `rrec_rule_idx` (`rule_id`),
  CONSTRAINT `rrec_rule_fk` FOREIGN KEY (`rule_id`)
    REFERENCES `recognition_rules` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `recognition_rule_exclude_conditions` (
  `rule_id`, `field_name`, `match_type`, `keyword`, `sort_order`
)
SELECT
  rr.`id`, rr.`exclude_order_field`, '等于', rr.`exclude_order_keyword`, 0
FROM `recognition_rules` rr
WHERE rr.`exclude_order_enabled` = 1
  AND NULLIF(TRIM(rr.`exclude_order_field`), '') IS NOT NULL
  AND NULLIF(TRIM(rr.`exclude_order_keyword`), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `recognition_rule_exclude_conditions` existing
    WHERE existing.`rule_id` = rr.`id`
  );
