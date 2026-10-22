-- v10.21: 手动认账会费收入新增缴纳年限，用于凭证模板变量
ALTER TABLE match_results
  ADD COLUMN membership_payment_years INT NULL AFTER member_name;
