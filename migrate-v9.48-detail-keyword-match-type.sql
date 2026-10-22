ALTER TABLE rule_items
  ADD COLUMN keyword_match_type ENUM('等于', '包含') NOT NULL DEFAULT '等于' AFTER detail_keyword;
