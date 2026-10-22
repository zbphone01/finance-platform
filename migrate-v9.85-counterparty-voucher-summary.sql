-- v9.85: 将制单摘要内容并入到账信息，移除独立制单摘要表
ALTER TABLE counterparty_records
  ADD COLUMN voucher_summary_text VARCHAR(500) NULL AFTER post_script;

DROP TABLE IF EXISTS voucher_summaries;
