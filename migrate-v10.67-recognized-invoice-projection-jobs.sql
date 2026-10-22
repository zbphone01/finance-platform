-- v10.67: 认账完成后由票据系统低优先级构建一行一订单的已认账窄表投影。
-- 旧 invoice_order_index_jobs / invoice_order_identifiers 本迁移不删除，保留回滚能力。

CREATE TABLE IF NOT EXISTS `invoice_recognized_projection_jobs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `order_file_id` bigint unsigned NOT NULL,
  `rule_id` bigint unsigned NULL,
  `field_snapshot` json NOT NULL,
  `generation` bigint unsigned NOT NULL DEFAULT 0,
  `processing_generation` bigint unsigned NOT NULL DEFAULT 0,
  `status` enum(
    'waiting_recognition',
    'queued',
    'running',
    'retry_wait',
    'succeeded',
    'failed'
  ) NOT NULL DEFAULT 'waiting_recognition',
  `cursor_partition_date` date NULL,
  `cursor_detail_id` bigint unsigned NOT NULL DEFAULT 0,
  `projected_detail_count` bigint unsigned NOT NULL DEFAULT 0,
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
  UNIQUE KEY `riopj_order_file_uq` (`order_file_id`),
  KEY `riopj_status_available_idx` (`status`, `available_at`, `id`),
  KEY `riopj_lease_idx` (`status`, `lease_expires_at`),
  CONSTRAINT `riopj_order_file_fk`
    FOREIGN KEY (`order_file_id`) REFERENCES `order_files` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 已部署 v10.66 的环境优先复用上传时字段快照，并把历史文件排入一次投影重建。
INSERT INTO `invoice_recognized_projection_jobs` (
  `order_file_id`,
  `rule_id`,
  `field_snapshot`,
  `generation`,
  `status`,
  `available_at`
)
SELECT
  old_job.order_file_id,
  old_job.rule_id,
  old_job.field_snapshot,
  1,
  'queued',
  NOW()
FROM `invoice_order_index_jobs` old_job
INNER JOIN `order_files` order_file ON order_file.id = old_job.order_file_id
WHERE order_file.upload_status = 'completed'
  AND order_file.entry_count > 0
ON DUPLICATE KEY UPDATE
  `order_file_id` = VALUES(`order_file_id`);
