-- v10.01: Optimize voucher summary flow list status/date filtering.
ALTER TABLE bank_flows
  ADD INDEX bf_status_time_id_idx (recognition_status, transaction_time, id);
