-- v10.47: Store uploaded/manual bank accounts and associate bank flows without duplicating account numbers.

CREATE TABLE bank_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  bank_name VARCHAR(50) NOT NULL,
  account_no VARCHAR(100) NOT NULL,
  account_alias VARCHAR(200) NOT NULL DEFAULT '',
  source_type ENUM('upload', 'manual') NOT NULL DEFAULT 'manual',
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ba_bank_account_uq (bank_name, account_no)
);

ALTER TABLE bank_flows
  ADD COLUMN bank_account_id BIGINT UNSIGNED NULL AFTER bank_name;
