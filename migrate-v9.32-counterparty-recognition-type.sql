ALTER TABLE counterparty_records
  ADD COLUMN recognition_type ENUM('到账认账', '明细认账') NOT NULL DEFAULT '到账认账' AFTER alias,
  ADD INDEX cr_recognition_type_idx (recognition_type);
