-- v9.87: 到账信息新增凭证收入名称
ALTER TABLE counterparty_records
  ADD COLUMN voucher_income_name varchar(200) NULL COMMENT '凭证收入名称' AFTER voucher_summary_text;
