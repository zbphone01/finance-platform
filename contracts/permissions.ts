export const ROLE_PERMISSION_ROLES = ["operator", "finance"] as const;

export type PermissionRole = (typeof ROLE_PERMISSION_ROLES)[number];

export const ROLE_PERMISSION_ROLE_LABELS: Record<PermissionRole, string> = {
  operator: "运营人员",
  finance: "财务人员",
};

export const ROLE_PERMISSION_KEYS = [
  "account_management_menu_access",
  "financial_voucher_info_menu_access",
  "result_summary_menu_access",
  "recognition_info_menu_access",
  "recognition_task_delete",
  "bank_flow_delete",
  "bank_flow_match_manage",
  "order_detail_package_delete",
  "detail_split_delete",
  "recognition_rule_delete",
  "arrival_info_delete",
  "recognition_info_delete",
  "manual_recognition_cancel",
  "recognition_result_edit",
  "voucher_create",
  "voucher_cancel",
] as const;

export type PermissionKey = (typeof ROLE_PERMISSION_KEYS)[number];

export type PermissionGroup = {
  label: string;
  permissions: Array<{ key: PermissionKey; label: string }>;
};

export const ROLE_PERMISSION_GROUPS: PermissionGroup[] = [
  {
    label: "删除权限",
    permissions: [
      { key: "recognition_task_delete", label: "删除认账任务" },
      { key: "bank_flow_delete", label: "删除银行到账" },
      { key: "order_detail_package_delete", label: "删除订单明细包" },
      { key: "detail_split_delete", label: "删除明细分账包" },
      { key: "arrival_info_delete", label: "删除已记录到账信息" },
    ],
  },
  {
    label: "操作权限",
    permissions: [
      { key: "manual_recognition_cancel", label: "取消认账" },
      { key: "bank_flow_match_manage", label: "管理银行到账匹配" },
      { key: "recognition_result_edit", label: "修改认账" },
      { key: "voucher_create", label: "制单" },
      { key: "voucher_cancel", label: "取消制单" },
    ],
  },
  {
    label: "菜单访问权限",
    permissions: [
      { key: "result_summary_menu_access", label: "入账汇总" },
      { key: "recognition_info_menu_access", label: "认账信息设置" },
      { key: "financial_voucher_info_menu_access", label: "财务凭证信息" },
      { key: "account_management_menu_access", label: "管理员功能" },
    ],
  },
];

export type RolePermissionMap = Record<PermissionKey, boolean>;

export const DEFAULT_ROLE_PERMISSIONS: Record<PermissionRole, RolePermissionMap> = {
  operator: {
    account_management_menu_access: false,
    financial_voucher_info_menu_access: true,
    result_summary_menu_access: true,
    recognition_info_menu_access: true,
    recognition_task_delete: false,
    bank_flow_delete: false,
    bank_flow_match_manage: false,
    order_detail_package_delete: false,
    detail_split_delete: false,
    recognition_rule_delete: false,
    arrival_info_delete: false,
    recognition_info_delete: false,
    manual_recognition_cancel: false,
    recognition_result_edit: false,
    voucher_create: false,
    voucher_cancel: false,
  },
  finance: {
    account_management_menu_access: false,
    financial_voucher_info_menu_access: true,
    result_summary_menu_access: true,
    recognition_info_menu_access: true,
    recognition_task_delete: false,
    bank_flow_delete: false,
    bank_flow_match_manage: false,
    order_detail_package_delete: false,
    detail_split_delete: false,
    recognition_rule_delete: false,
    arrival_info_delete: false,
    recognition_info_delete: false,
    manual_recognition_cancel: false,
    recognition_result_edit: true,
    voucher_create: true,
    voucher_cancel: true,
  },
};

export function getDefaultRolePermissions(role: string): RolePermissionMap {
  if (role === "operator" || role === "finance") {
    return { ...DEFAULT_ROLE_PERMISSIONS[role] };
  }
  return ROLE_PERMISSION_KEYS.reduce((acc, key) => {
    acc[key] = true;
    return acc;
  }, {} as RolePermissionMap);
}
