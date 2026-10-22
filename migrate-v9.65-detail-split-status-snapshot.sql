-- v9.65: 明细分账状态快照，避免列表实时汇总大表

ALTER TABLE detail_split_files
  ADD COLUMN pending_recognition_count INT NOT NULL DEFAULT 0 AFTER unmatched_count,
  ADD COLUMN recognized_count INT NOT NULL DEFAULT 0 AFTER pending_recognition_count;

UPDATE detail_split_files
SET pending_recognition_count = GREATEST(COALESCE(matched_count, 0), 0),
    recognized_count = 0
WHERE pending_recognition_count = 0
  AND recognized_count = 0;
