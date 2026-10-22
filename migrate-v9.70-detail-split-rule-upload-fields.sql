-- v9.70: 明细分账包上传字段改为在明细认账规则中维护

ALTER TABLE recognition_rules
  ADD COLUMN detail_split_recognition_keyword_field VARCHAR(100) NOT NULL DEFAULT '商品标题' AFTER multi_split_match_field,
  ADD COLUMN detail_split_income_field VARCHAR(100) NOT NULL DEFAULT '买家实付金额' AFTER detail_split_recognition_keyword_field,
  ADD COLUMN detail_split_match_field VARCHAR(100) NOT NULL DEFAULT '主订单编号' AFTER detail_split_income_field;
