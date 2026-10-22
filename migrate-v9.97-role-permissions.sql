-- v9.97: 角色权限配置
CREATE TABLE IF NOT EXISTS role_permissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  role ENUM('operator','finance') NOT NULL,
  permission_key VARCHAR(100) NOT NULL,
  allowed TINYINT(1) NOT NULL DEFAULT 0,
  updated_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY rp_role_permission_idx (role, permission_key),
  KEY rp_role_idx (role),
  KEY rp_permission_idx (permission_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO role_permissions (role, permission_key, allowed)
VALUES
  ('operator', 'account_management_menu_access', 0),
  ('operator', 'financial_voucher_info_menu_access', 1),
  ('operator', 'recognition_task_delete', 0),
  ('operator', 'order_detail_package_delete', 0),
  ('operator', 'detail_split_delete', 0),
  ('operator', 'recognition_rule_delete', 0),
  ('operator', 'arrival_info_delete', 0),
  ('operator', 'recognition_info_delete', 0),
  ('operator', 'manual_recognition_cancel', 0),
  ('operator', 'voucher_create', 0),
  ('finance', 'account_management_menu_access', 0),
  ('finance', 'financial_voucher_info_menu_access', 1),
  ('finance', 'recognition_task_delete', 0),
  ('finance', 'order_detail_package_delete', 0),
  ('finance', 'detail_split_delete', 0),
  ('finance', 'recognition_rule_delete', 0),
  ('finance', 'arrival_info_delete', 0),
  ('finance', 'recognition_info_delete', 0),
  ('finance', 'manual_recognition_cancel', 0),
  ('finance', 'voucher_create', 1)
ON DUPLICATE KEY UPDATE permission_key = VALUES(permission_key);
