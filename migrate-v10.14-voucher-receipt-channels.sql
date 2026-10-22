-- v10.14: 新增凭证收款渠道维护表
CREATE TABLE IF NOT EXISTS voucher_receipt_channels (
  id bigint unsigned NOT NULL AUTO_INCREMENT,
  channel_code varchar(100) NOT NULL COMMENT '收款渠道编号',
  channel_name varchar(200) NOT NULL COMMENT '收款渠道名称',
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY vrc_channel_code_idx (channel_code),
  KEY vrc_channel_name_idx (channel_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='凭证收款渠道';
