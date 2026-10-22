import { getDefaultRolePermissions, type PermissionKey } from "@contracts/permissions";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";

export function usePermissions() {
  const { user } = useAuth();
  const permissionsQuery = trpc.permission.current.useQuery(undefined, { enabled: Boolean(user) });
  const permissions = permissionsQuery.data?.permissions || getDefaultRolePermissions(user?.role || "");

  return {
    permissions,
    hasPermission: (permissionKey: PermissionKey) => Boolean(permissions[permissionKey]),
    isLoading: permissionsQuery.isLoading,
  };
}
