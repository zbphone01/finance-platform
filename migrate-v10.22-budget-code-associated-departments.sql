-- v10.22: 预算编码部门支持关联收入部门，用于按收入部门筛选预算编码
ALTER TABLE budget_codes
  ADD COLUMN associated_departments JSON NULL AFTER associated_income_projects;
