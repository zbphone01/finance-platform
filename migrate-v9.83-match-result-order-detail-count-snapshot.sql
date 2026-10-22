ALTER TABLE `match_results`
  ADD COLUMN `order_detail_count_snapshot` int NOT NULL DEFAULT 0 AFTER `detail_count`;

UPDATE `match_results`
SET `order_detail_count_snapshot` = 0
WHERE `rule_item_id` IS NULL;

UPDATE `match_results` mr
JOIN (
  SELECT
    `task_id`,
    `rule_item_id`,
    COALESCE(`bank_flow_id`, 0) AS `bank_flow_id_key`,
    `entry_time`,
    MAX(COALESCE(`detail_count`, 0)) AS `group_detail_count`
  FROM `match_results`
  WHERE `rule_item_id` IS NOT NULL
  GROUP BY `task_id`, `rule_item_id`, COALESCE(`bank_flow_id`, 0), `entry_time`
) grouped_results ON grouped_results.`task_id` = mr.`task_id`
  AND grouped_results.`rule_item_id` = mr.`rule_item_id`
  AND grouped_results.`bank_flow_id_key` = COALESCE(mr.`bank_flow_id`, 0)
  AND grouped_results.`entry_time` = mr.`entry_time`
SET mr.`order_detail_count_snapshot` = grouped_results.`group_detail_count`
WHERE mr.`rule_item_id` IS NOT NULL;
