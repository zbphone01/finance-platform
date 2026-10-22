-- v9.37: 明细认账支持 T+1 / 打包明细两种数据包类型

ALTER TABLE counterparty_records
  ADD COLUMN detail_package_type ENUM('T+1', '打包明细') NOT NULL DEFAULT 'T+1' AFTER recognition_type,
  ADD INDEX cr_detail_package_type_idx (detail_package_type);

ALTER TABLE order_files
  ADD COLUMN detail_package_type ENUM('T+1', '打包明细') NOT NULL DEFAULT 'T+1' AFTER rule_id,
  ADD COLUMN upload_date VARCHAR(20) NULL AFTER detail_package_type,
  ADD INDEX of_package_type_idx (detail_package_type),
  ADD INDEX of_upload_date_idx (upload_date);

UPDATE order_files
SET upload_date = DATE_FORMAT(created_at, '%Y-%m-%d')
WHERE upload_date IS NULL OR upload_date = '';
