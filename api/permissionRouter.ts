import { z } from "zod";
import { createRouter, adminQuery, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { rolePermissions } from "@db/schema";
import {
  ROLE_PERMISSION_KEYS,
  ROLE_PERMISSION_GROUPS,
  ROLE_PERMISSION_ROLES,
  ROLE_PERMISSION_ROLE_LABELS,
  type PermissionRole,
} from "@contracts/permissions";
import { getPermissionsForRole } from "./lib/permissions";

const roleSchema = z.enum(ROLE_PERMISSION_ROLES);
const permissionKeySchema = z.enum(ROLE_PERMISSION_KEYS);

export const permissionRouter = createRouter({
  current: authedQuery.query(async ({ ctx }) => {
    return {
      role: ctx.user.role,
      permissions: await getPermissionsForRole(ctx.user.role),
    };
  }),

  list: adminQuery.query(async () => {
    const matrix = {} as Record<PermissionRole, Awaited<ReturnType<typeof getPermissionsForRole>>>;
    for (const role of ROLE_PERMISSION_ROLES) {
      matrix[role] = await getPermissionsForRole(role);
    }

    return {
      roles: ROLE_PERMISSION_ROLES.map((role) => ({
        role,
        label: ROLE_PERMISSION_ROLE_LABELS[role],
      })),
      groups: ROLE_PERMISSION_GROUPS,
      matrix,
    };
  }),

  update: adminQuery
    .input(
      z.object({
        role: roleSchema,
        permissionKey: permissionKeySchema,
        allowed: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const values = {
        role: input.role,
        permissionKey: input.permissionKey,
        allowed: input.allowed,
        updatedBy: Number(ctx.user.id),
        updatedAt: new Date(),
      };

      await getDb()
        .insert(rolePermissions)
        .values(values)
        .onDuplicateKeyUpdate({
          set: {
            allowed: values.allowed,
            updatedBy: values.updatedBy,
            updatedAt: values.updatedAt,
          },
        });

      return { success: true };
    }),
});
