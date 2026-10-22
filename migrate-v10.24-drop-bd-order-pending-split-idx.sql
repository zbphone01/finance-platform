-- v10.24: 删除被 bd_order_rec_item_idx 左前缀覆盖的订单包待拆分索引

DROP INDEX bd_order_pending_split_idx ON bill_details;
