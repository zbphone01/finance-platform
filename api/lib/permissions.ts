import { eq } from "drizzle-orm";
import { rolePermissions } from "@db/schema";
import { getDb } from "../queries/connection";
import {
  getDefaultRolePermissions,
  ROLE_PERMISSION_KEYS,
  type PermissionKey,
  type RolePermissionMap,
} from "@contracts/permissions";

type PermissionUser = {
  id: number;
  role: string;
};

function isMissingPermissionTableError(error: unknown) {
  const err = error as { code?: string; errno?: number; message?: string };
  return err?.code === "ER_NO_SUCH_TABLE" || err?.errno === 1146 || String(err?.message || "").includes("role_permissions");
}

export async function getPermissionsForRole(role: string): Promise<RolePermissionMap> {
  const permissions = getDefaultRolePermissions(role);
  if (role === "admin") return permissions;
  if (role !== "operator" && role !== "finance") return permissions;

  try {
    const rows = await getDb()
      .select({
        permissionKey: rolePermissions.permissionKey,
        allowed: rolePermissions.allowed,
      })
      .from(rolePermissions)
      .where(eq(rolePermissions.role, role));

    const configuredKeys = new Set<PermissionKey>();
    for (const row of rows) {
      if (ROLE_PERMISSION_KEYS.includes(row.permissionKey as PermissionKey)) {
        const permissionKey = row.permissionKey as PermissionKey;
        permissions[permissionKey] = Boolean(row.allowed);
        configuredKeys.add(permissionKey);
      }
    }

    if (!configuredKeys.has("bank_flow_delete") && configuredKeys.has("recognition_task_delete")) {
      permissions.bank_flow_delete = permissions.recognition_task_delete;
    }
    if (!configuredKeys.has("voucher_cancel") && configuredKeys.has("voucher_create")) {
      permissions.voucher_cancel = permissions.voucher_create;
    }
  } catch (error) {
    if (!isMissingPermissionTableError(error)) throw error;
  }

  return permissions;
}

export async function userHasPermission(user: PermissionUser, permissionKey: PermissionKey) {
  if (user.role === "admin") return true;
  const permissions = await getPermissionsForRole(user.role);
  return Boolean(permissions[permissionKey]);
}
