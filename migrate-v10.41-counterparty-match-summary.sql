-- v10.41: 到账信息匹配条件增加摘要关键字。
-- 历史到账信息、匹配条件和未记录到账信息的摘要统一保持为空，不从银行流水回填。

ALTER TABLE counterparty_records
  ADD COLUMN summary VARCHAR(500) NOT NULL DEFAULT '' AFTER account_name;

ALTER TABLE counterparty_match_accounts
  ADD COLUMN summary VARCHAR(500) NOT NULL DEFAULT '' AFTER account_name;

ALTER TABLE unrecorded_counterparties
  ADD COLUMN summary VARCHAR(500) NOT NULL DEFAULT '' AFTER account_name;
