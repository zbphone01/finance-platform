ALTER TABLE users
  ADD COLUMN two_factor_secret VARCHAR(512) NULL DEFAULT NULL AFTER locked_at,
  ADD COLUMN two_factor_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER two_factor_secret,
  ADD COLUMN two_factor_enabled_at TIMESTAMP NULL DEFAULT NULL AFTER two_factor_enabled;
