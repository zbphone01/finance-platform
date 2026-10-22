-- v10.83: counterparty_match_accounts 成为到账匹配条件唯一来源。

-- 仅为完全没有子表记录的历史到账信息补建第一组条件；已有子表记录的数据不覆盖。
INSERT INTO `counterparty_match_accounts` (
  `counterparty_record_id`, `bank_name`, `account_no`, `account_name`, `summary`,
  `purpose`, `post_script`, `is_active`, `sort_order`
)
SELECT
  cr.`id`, cr.`bank_name`, cr.`account_no`, cr.`account_name`, cr.`summary`,
  COALESCE(cr.`purpose`, ''), COALESCE(cr.`post_script`, ''), 1, 0
FROM `counterparty_records` cr
WHERE NOT EXISTS (
  SELECT 1
  FROM `counterparty_match_accounts` cma
  WHERE cma.`counterparty_record_id` = cr.`id`
);

-- 排序号在同一到账信息内唯一，保证第一组快照选择稳定。
SET @v1083_add_sort_unique = IF(
  EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'counterparty_match_accounts'
      AND index_name = 'cma_record_sort_uq'
  ),
  'SELECT 1',
  'ALTER TABLE `counterparty_match_accounts` ADD UNIQUE INDEX `cma_record_sort_uq` (`counterparty_record_id`, `sort_order`)'
);
PREPARE v1083_sort_stmt FROM @v1083_add_sort_unique;
EXECUTE v1083_sort_stmt;
DEALLOCATE PREPARE v1083_sort_stmt;

-- 子表生命周期跟随到账信息主记录。
SET @v1083_add_fk = IF(
  EXISTS(
    SELECT 1 FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'counterparty_match_accounts'
      AND constraint_name = 'cma_record_fk'
  ),
  'SELECT 1',
  'ALTER TABLE `counterparty_match_accounts` ADD CONSTRAINT `cma_record_fk` FOREIGN KEY (`counterparty_record_id`) REFERENCES `counterparty_records` (`id`) ON DELETE CASCADE'
);
PREPARE v1083_fk_stmt FROM @v1083_add_fk;
EXECUTE v1083_fk_stmt;
DEALLOCATE PREPARE v1083_fk_stmt;

-- 删除主表重复匹配条件及其旧索引；主表只保留到账业务元数据。
SET @v1083_drop_parent_match_fields = IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'counterparty_records'
      AND column_name = 'bank_name'
  ),
  'ALTER TABLE `counterparty_records` DROP INDEX `cr_account_no_idx`, DROP COLUMN `bank_name`, DROP COLUMN `account_no`, DROP COLUMN `account_name`, DROP COLUMN `summary`, DROP COLUMN `purpose`, DROP COLUMN `post_script`',
  'SELECT 1'
);
PREPARE v1083_parent_stmt FROM @v1083_drop_parent_match_fields;
EXECUTE v1083_parent_stmt;
DEALLOCATE PREPARE v1083_parent_stmt;
