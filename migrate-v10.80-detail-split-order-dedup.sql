-- v10.80: 明细分账增加子订单号字段快照和跨分账包持久滤重。
-- 历史分账包缺少可靠的子订单号快照，不自动回填滤重键；本迁移只对新上传生效。

ALTER TABLE `recognition_rules`
  ADD COLUMN `detail_split_order_no_field` varchar(100) NOT NULL DEFAULT '子订单编号'
    AFTER `detail_split_match_field`;

ALTER TABLE `detail_split_files`
  ADD COLUMN `order_no_field` varchar(100) NULL
    AFTER `recognition_keyword_field`,
  ADD COLUMN `duplicate_count` int NOT NULL DEFAULT 0
    AFTER `recognized_count`;

CREATE TABLE `detail_split_order_dedup_keys` (
  `rule_id` bigint unsigned NOT NULL,
  `normalized_order_no` varchar(191) NOT NULL,
  `detail_split_file_id` bigint unsigned NOT NULL,
  `source_line_number` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`rule_id`, `normalized_order_no`),
  KEY `dsodk_file_idx` (`detail_split_file_id`),
  CONSTRAINT `dsodk_rule_fk` FOREIGN KEY (`rule_id`)
    REFERENCES `recognition_rules` (`id`) ON DELETE CASCADE,
  CONSTRAINT `dsodk_file_fk` FOREIGN KEY (`detail_split_file_id`)
    REFERENCES `detail_split_files` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
