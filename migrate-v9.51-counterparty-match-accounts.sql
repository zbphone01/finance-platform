CREATE TABLE IF NOT EXISTS counterparty_match_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  counterparty_record_id BIGINT UNSIGNED NOT NULL,
  account_no VARCHAR(100) NOT NULL,
  account_name VARCHAR(200) NOT NULL DEFAULT '',
  purpose VARCHAR(500) NOT NULL DEFAULT '',
  post_script VARCHAR(500) NOT NULL DEFAULT '',
  is_active INT NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY cma_record_idx (counterparty_record_id),
  KEY cma_account_idx (account_no),
  KEY cma_active_idx (is_active)
);

INSERT INTO counterparty_match_accounts (
  counterparty_record_id,
  account_no,
  account_name,
  purpose,
  post_script,
  is_active,
  sort_order,
  created_at,
  updated_at
)
SELECT
  cr.id,
  cr.account_no,
  COALESCE(cr.account_name, ''),
  COALESCE(cr.purpose, ''),
  COALESCE(cr.post_script, ''),
  1,
  0,
  NOW(),
  NOW()
FROM counterparty_records cr
WHERE NOT EXISTS (
  SELECT 1
  FROM counterparty_match_accounts cma
  WHERE cma.counterparty_record_id = cr.id
);
