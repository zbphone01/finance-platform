-- v10.00: 银行流水认账状态字段改名并支持部分认账、异常
ALTER TABLE bank_flows
  CHANGE COLUMN income_recognized recognition_status
    ENUM('unrecognized','partial_matched','recognized','large_variance')
    NOT NULL DEFAULT 'unrecognized';

ALTER TABLE bank_flows
  DROP INDEX bf_inc_rec_idx,
  ADD INDEX bf_recognition_status_idx (recognition_status);
