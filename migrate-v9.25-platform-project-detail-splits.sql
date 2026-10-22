ALTER TABLE rule_item_splits
  ADD COLUMN platform_project_detail VARCHAR(500) NULL AFTER platform_project_name;

ALTER TABLE income_rule_splits
  ADD COLUMN platform_project_detail VARCHAR(500) NULL AFTER platform_project_name;

ALTER TABLE match_results
  ADD COLUMN platform_project_detail VARCHAR(500) NULL AFTER platform_project_name;
