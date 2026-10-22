-- v10.51: 到账信息匹配条件增加可选到账银行。
-- 历史到账信息、匹配条件和未记录到账信息统一保持 NULL，表示不限制银行。

ALTER TABLE counterparty_records
  ADD COLUMN bank_name VARCHAR(50) NULL DEFAULT NULL AFTER detail_package_type;

ALTER TABLE counterparty_match_accounts
  ADD COLUMN bank_name VARCHAR(50) NULL DEFAULT NULL AFTER counterparty_record_id;

ALTER TABLE unrecorded_counterparties
  ADD COLUMN bank_name VARCHAR(50) NULL DEFAULT NULL AFTER id;
