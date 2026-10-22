ALTER TABLE rule_item_splits
  MODIFY COLUMN income_type ENUM(
    '捐赠收入',
    '会费收入',
    '政府补助',
    '个税返还本金',
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
    '投资收益',
    '利息',
    '其他收入',
    '其他'
  ) NULL;
