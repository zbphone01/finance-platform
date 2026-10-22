-- v10.15: 凭证明细行保存浮层快照
ALTER TABLE voucher_result_lines
  ADD COLUMN line_type varchar(50) NOT NULL DEFAULT 'overview' AFTER line_no,
  ADD COLUMN explanation_json json NULL AFTER credit_amount;
