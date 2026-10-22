ALTER TABLE counterparty_records
  ADD COLUMN detail_matching_mode ENUM('单笔匹配', '同日汇总匹配') NOT NULL DEFAULT '单笔匹配' AFTER alias,
  ADD COLUMN arrival_region ENUM('北京市', '外省市', '港澳台', '境外', '内部客商') NULL AFTER detail_matching_mode;

CREATE INDEX cr_detail_matching_mode_idx ON counterparty_records (detail_matching_mode);
CREATE INDEX cr_arrival_region_idx ON counterparty_records (arrival_region);
