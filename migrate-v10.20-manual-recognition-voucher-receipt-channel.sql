-- v10.20: 手动认账入账结果保存制单收款渠道编号
ALTER TABLE match_results
  ADD COLUMN voucher_receipt_channel_code VARCHAR(100) NULL AFTER remark;
