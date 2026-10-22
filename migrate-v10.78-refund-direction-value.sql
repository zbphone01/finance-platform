-- v10.78: 退款订单恢复为单个判断值，并新增共用判断字段的单个收支方向值。
-- 执行入口会先确认 refund_judge_values 仅含单元素数组；禁止绕过部署脚本直接执行。

UPDATE recognition_rules
SET refund_judge_value = NULLIF(
  TRIM(JSON_UNQUOTE(JSON_EXTRACT(refund_judge_values, '$[0]'))),
  ''
)
WHERE refund_judge_values IS NOT NULL
  AND JSON_TYPE(refund_judge_values) = 'ARRAY'
  AND JSON_LENGTH(refund_judge_values) = 1
  AND NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(refund_judge_values, '$[0]'))), '') IS NOT NULL;

ALTER TABLE recognition_rules
  ADD COLUMN refund_direction_judge_value VARCHAR(500) NULL AFTER refund_judge_value,
  DROP COLUMN refund_judge_values;
