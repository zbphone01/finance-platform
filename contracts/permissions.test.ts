import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROLE_PERMISSIONS,
  ROLE_PERMISSION_GROUPS,
} from "./permissions";

describe("role permission groups", () => {
  it("exposes the requested permission groups and labels in order", () => {
    expect(ROLE_PERMISSION_GROUPS).toEqual([
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
    ]);
  });

  it("keeps current default access while splitting new permissions", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.operator).toMatchObject({
      bank_flow_delete: false,
      bank_flow_match_manage: false,
      recognition_result_edit: false,
      voucher_cancel: false,
      result_summary_menu_access: true,
      recognition_info_menu_access: true,
    });
    expect(DEFAULT_ROLE_PERMISSIONS.finance).toMatchObject({
      bank_flow_delete: false,
      bank_flow_match_manage: false,
      recognition_result_edit: true,
      voucher_cancel: true,
      result_summary_menu_access: true,
      recognition_info_menu_access: true,
    });
  });
});
