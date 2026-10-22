-- v10.59: 新上传订单在预匹配时生成规则条件/收入退款汇总，首次认账直接读取小表。
-- 历史订单包默认保持无效状态并继续使用原明细查询，不在迁移阶段扫描 bill_details。

ALTER TABLE order_files
  ADD COLUMN recognition_summary_valid TINYINT(1) NOT NULL DEFAULT 0 AFTER pending_split_count;

CREATE TABLE order_file_recognition_summaries (
  order_file_id BIGINT UNSIGNED NOT NULL,
  rule_item_id BIGINT UNSIGNED NOT NULL,
  is_refund TINYINT(1) NOT NULL DEFAULT 0,
  detail_count INT NOT NULL DEFAULT 0,
  total_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT ofrs_pk PRIMARY KEY (order_file_id, rule_item_id, is_refund),
  CONSTRAINT ofrs_order_file_fk
    FOREIGN KEY (order_file_id) REFERENCES order_files(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
