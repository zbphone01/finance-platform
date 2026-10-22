-- v10.46: 同日汇总匹配改为同一到账日期、同一到账信息只使用一个认账任务。
-- 历史上已经只有一个任务的分组直接回填；存在多个任务的历史分组保持 NULL，
-- 后续新增流水或更新订单包时由应用在事务内归并，避免迁移阶段误合并不同规则的数据。

ALTER TABLE `recognition_tasks`
  ADD COLUMN `same_day_counterparty_id` BIGINT UNSIGNED NULL AFTER `rule_id`;

UPDATE `recognition_tasks` rt
INNER JOIN `recognition_rules` rr ON rr.id = rt.rule_id
INNER JOIN `counterparty_records` cr
  ON cr.alias = rr.matched_counterparty_alias
  AND cr.recognition_type = '明细认账'
  AND cr.detail_matching_mode = '同日汇总匹配'
INNER JOIN (
  SELECT rt2.bill_date, cr2.id AS counterparty_id
  FROM `recognition_tasks` rt2
  INNER JOIN `recognition_rules` rr2 ON rr2.id = rt2.rule_id
  INNER JOIN `counterparty_records` cr2
    ON cr2.alias = rr2.matched_counterparty_alias
    AND cr2.recognition_type = '明细认账'
    AND cr2.detail_matching_mode = '同日汇总匹配'
  GROUP BY rt2.bill_date, cr2.id
  HAVING COUNT(*) = 1
) singleton
  ON singleton.bill_date = rt.bill_date
  AND singleton.counterparty_id = cr.id
SET rt.same_day_counterparty_id = cr.id;

ALTER TABLE `recognition_tasks`
  ADD UNIQUE KEY `rt_same_day_counterparty_date_uq` (`bill_date`, `same_day_counterparty_id`);
