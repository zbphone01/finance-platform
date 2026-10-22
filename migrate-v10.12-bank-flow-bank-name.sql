-- v10.12: Add bank source name for bank flow uploads.

ALTER TABLE bank_flows
  ADD COLUMN bank_name VARCHAR(50) NOT NULL DEFAULT '广发银行' AFTER task_id;

UPDATE bank_flows
SET bank_name = '广发银行'
WHERE bank_name IS NULL OR bank_name = '';
