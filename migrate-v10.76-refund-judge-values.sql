-- v10.76: 明细认账规则的退款订单判断字段支持最多 3 个精确匹配值。
-- 旧 refund_judge_value 保留第一项兼容快照，供旧版本代码回退读取。

ALTER TABLE recognition_rules
  ADD COLUMN refund_judge_values JSON NULL AFTER refund_judge_value;

UPDATE recognition_rules
SET refund_judge_values = JSON_ARRAY(refund_judge_value)
WHERE NULLIF(TRIM(refund_judge_value), '') IS NOT NULL
  AND refund_judge_values IS NULL;
