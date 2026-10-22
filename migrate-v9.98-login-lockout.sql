ALTER TABLE users
  ADD COLUMN login_failed_attempts INT NOT NULL DEFAULT 0 AFTER is_active,
  ADD COLUMN locked_at TIMESTAMP NULL DEFAULT NULL AFTER login_failed_attempts;
