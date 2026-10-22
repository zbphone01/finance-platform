-- v10.32: 非模板收入类型支持录入外部凭证 ID，同一银行流水可关联多张凭证
ALTER TABLE `voucher_results`
  ADD COLUMN `voucher_kind` enum('generated','manual') NOT NULL DEFAULT 'generated' AFTER `reference_text`,
  ADD COLUMN `voucher_key` varchar(100) NOT NULL DEFAULT 'generated' AFTER `voucher_kind`,
  ADD COLUMN `voucher_id_text` varchar(200) NULL AFTER `voucher_key`,
  ADD COLUMN `income_type` varchar(100) NULL AFTER `voucher_id_text`,
  ADD COLUMN `voucher_amount` decimal(18,2) NULL AFTER `income_type`,
  ADD COLUMN `creation_group_id` varchar(64) NULL AFTER `voucher_amount`,
  ADD UNIQUE KEY `vr_source_key_uq` (`source_flow_id`, `voucher_key`),
  ADD KEY `vr_kind_idx` (`voucher_kind`),
  ADD KEY `vr_creation_group_idx` (`creation_group_id`);

ALTER TABLE `voucher_result_flows`
  DROP INDEX `vrf_flow_unique_idx`,
  ADD UNIQUE KEY `vrf_result_flow_unique_idx` (`voucher_result_id`, `bank_flow_id`);
