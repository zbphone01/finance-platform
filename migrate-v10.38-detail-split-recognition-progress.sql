-- v10.38: 明细分账包增加后台认账阶段和任务进度快照。
-- 仅增加轻量状态字段，不扫描或重算 bill_details。

ALTER TABLE detail_split_files
  ADD COLUMN recognition_phase ENUM('idle', 'finding_tasks', 'recognizing', 'completed', 'failed') NOT NULL DEFAULT 'idle' AFTER recognized_count,
  ADD COLUMN recognition_task_total INT NOT NULL DEFAULT 0 AFTER recognition_phase,
  ADD COLUMN recognition_task_completed INT NOT NULL DEFAULT 0 AFTER recognition_task_total,
  ADD COLUMN recognition_failed_reason VARCHAR(500) NULL AFTER recognition_task_completed;
