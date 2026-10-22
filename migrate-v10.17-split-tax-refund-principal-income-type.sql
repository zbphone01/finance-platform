-- v10.17: 收入类型“个税返还本金”拆分为“个税返还”和“本金”
ALTER TABLE rule_item_splits
  MODIFY COLUMN income_type ENUM(
    '捐赠收入',
    '会费收入',
    '政府补助',
    '个税返还本金',
    '个税返还',
    '本金',
    '投资收益',
    '利息',
    '其他收入',
    '其他'
  ) NULL;

ALTER TABLE income_rule_splits
  MODIFY COLUMN income_type ENUM(
    '捐赠收入',
    '会费收入',
    '政府补助',
    '个税返还本金',
    '个税返还',
    '本金',
    '投资收益',
    '利息',
    '其他收入',
    '其他'
  ) NULL;

UPDATE rule_item_splits
SET income_type = '个税返还'
WHERE income_type = '个税返还本金';

UPDATE income_rule_splits
SET income_type = '个税返还'
WHERE income_type = '个税返还本金';

ALTER TABLE rule_item_splits
  MODIFY COLUMN income_type ENUM(
    '捐赠收入',
    '会费收入',
    '政府补助',
    '个税返还',
    '本金',
    '投资收益',
    '利息',
    '其他收入',
    '其他'
  ) NULL;

ALTER TABLE income_rule_splits
  MODIFY COLUMN income_type ENUM(
    '捐赠收入',
    '会费收入',
    '政府补助',
    '个税返还',
    '本金',
    '投资收益',
    '利息',
    '其他收入',
    '其他'
  ) NULL;
