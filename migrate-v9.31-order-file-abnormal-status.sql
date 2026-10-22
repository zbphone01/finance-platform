ALTER TABLE order_files
  MODIFY COLUMN upload_status ENUM('processing','completed','failed','abnormal') NOT NULL DEFAULT 'completed';
