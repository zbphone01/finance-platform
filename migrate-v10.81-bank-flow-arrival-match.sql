-- v10.81: 银行流水上传时统一固化到账信息匹配；取消匹配后不再自动认账。

ALTER TABLE `bank_flows`
  ADD COLUMN `matched_counterparty_id` BIGINT UNSIGNED NULL AFTER `bank_account_id`,
  ADD COLUMN `arrival_match_status` ENUM('unmatched','matched','cancelled') NOT NULL DEFAULT 'unmatched' AFTER `matched_counterparty_id`;

-- 已有到账认账流水按当前规则关联回填。
UPDATE `bank_flows` bf
INNER JOIN `income_recognition_rules` irr ON irr.id = bf.income_rule_id
INNER JOIN `counterparty_records` cr ON cr.alias = irr.matched_counterparty_alias
SET
  bf.matched_counterparty_id = cr.id,
  bf.arrival_match_status = 'matched';

-- 已有同日汇总流水按任务固化的到账信息回填。
UPDATE `bank_flows` bf
INNER JOIN `recognition_tasks` rt ON rt.id = bf.task_id
INNER JOIN `counterparty_records` cr ON cr.id = rt.same_day_counterparty_id
SET
  bf.matched_counterparty_id = cr.id,
  bf.arrival_match_status = 'matched'
WHERE bf.matched_counterparty_id IS NULL;

-- 已绑定明细认账规则的任务按规则到账信息回填；无法可靠确定的历史流水保持未匹配。
UPDATE `bank_flows` bf
INNER JOIN `recognition_tasks` rt ON rt.id = bf.task_id
INNER JOIN `recognition_rules` rr ON rr.id = rt.rule_id
INNER JOIN `counterparty_records` cr
  ON cr.alias = rr.matched_counterparty_alias
  AND cr.recognition_type = '明细认账'
SET
  bf.matched_counterparty_id = cr.id,
  bf.arrival_match_status = 'matched'
WHERE bf.matched_counterparty_id IS NULL;
