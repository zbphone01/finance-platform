-- v9.35: 预算编码 NC 项目支持追加关联 NC 项目
ALTER TABLE budget_codes
  ADD COLUMN associated_income_projects JSON NULL AFTER income_project;
