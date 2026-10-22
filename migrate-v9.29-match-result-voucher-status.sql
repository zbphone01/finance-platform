ALTER TABLE match_results
  ADD COLUMN voucher_status ENUM('pending', 'created') NOT NULL DEFAULT 'pending' AFTER split_ratio;

CREATE INDEX mr_voucher_status_idx ON match_results (voucher_status);
