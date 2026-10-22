-- v10.44: 捐赠收入银行直捐恢复选填会员姓名，并增加所属项目中心快照
ALTER TABLE income_rule_splits
  ADD COLUMN project_center VARCHAR(255) NULL AFTER member_name;

ALTER TABLE match_results
  ADD COLUMN project_center VARCHAR(255) NULL AFTER member_name;
