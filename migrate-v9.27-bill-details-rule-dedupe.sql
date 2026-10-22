ALTER TABLE bill_details
  ADD COLUMN rule_id BIGINT UNSIGNED NULL AFTER task_id;

UPDATE bill_details bd
INNER JOIN order_files ofile ON bd.order_file_id = ofile.id
SET bd.rule_id = ofile.rule_id
WHERE bd.rule_id IS NULL;

UPDATE bill_details bd
INNER JOIN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY rule_id, bill_date, bill_no
        ORDER BY id
      ) AS row_no
    FROM bill_details
    WHERE rule_id IS NOT NULL
      AND bill_no IS NOT NULL
      AND bill_no <> ''
  ) ranked
  WHERE ranked.row_no > 1
) duplicated ON bd.id = duplicated.id
SET bd.rule_id = NULL;

CREATE UNIQUE INDEX bd_rule_date_bill_no_uq
  ON bill_details (rule_id, bill_date, bill_no);
