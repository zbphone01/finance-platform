-- v10.19: 入账结果新增捐赠来源、反馈类型和备注快照字段
ALTER TABLE match_results
  ADD COLUMN donation_source VARCHAR(50) NULL AFTER income_type,
  ADD COLUMN feedback_type VARCHAR(50) NULL AFTER bank_post_script,
  ADD COLUMN remark VARCHAR(500) NULL AFTER expense_fund_source;

UPDATE match_results
SET donation_source = '互联网募捐平台'
WHERE rule_item_id IS NOT NULL
  AND COALESCE(income_type, '') = '捐赠收入';
