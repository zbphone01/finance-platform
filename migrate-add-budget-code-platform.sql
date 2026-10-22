ALTER TABLE budget_codes
  ADD COLUMN platform_id varchar(20) NULL
  AFTER income_project;

ALTER TABLE budget_code_histories
  ADD COLUMN platform_id varchar(20) NULL
  AFTER income_project;
