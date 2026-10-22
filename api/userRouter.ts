import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import { eq, desc, like, and, count } from "drizzle-orm";
import { hashPassword } from "./lib/auth";
import { userHasPermission } from "./lib/permissions";

async function assertCanAccessAccountManagement(user: { id: number; role: string }) {
  if (!(await userHasPermission(user, "account_management_menu_access"))) {
    throw new Error("权限不足");
  }
}

function assertAdmin(user: { role: string }) {
  if (user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "仅管理员可以执行此操作" });
  }
}

export const userRouter = createRouter({
  list: authedQuery
    .input(
      z.object({
        search: z.string().optional(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(20),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      await assertCanAccessAccountManagement(ctx.user);
      const db = getDb();
      const conditions = [];
      if (input?.search) {
        conditions.push(
          and(
            like(users.username, `%${input.search}%`),
            like(users.name, `%${input.search}%`),
          ),
        );
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const items = await db.query.users.findMany({
        where: whereClause,
        orderBy: desc(users.createdAt),
        limit: input?.pageSize || 20,
        offset: ((input?.page || 1) - 1) * (input?.pageSize || 20),
      });

      const countResult = await db
        .select({ count: count() })
        .from(users)
        .where(whereClause);

      return {
        items: items.map((u) => ({ ...u, passwordHash: undefined, twoFactorSecret: undefined })),
        total: Number(countResult[0]?.count || 0),
        page: input?.page || 1,
        pageSize: input?.pageSize || 20,
      };
    }),

  create: authedQuery
    .input(
      z.object({
        username: z.string().min(3).max(50),
        password: z.string().min(6),
        name: z.string().min(1).max(100),
        role: z.enum(["admin", "operator", "finance"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCanAccessAccountManagement(ctx.user);
      const db = getDb();

      const existing = await db.query.users.findFirst({
        where: eq(users.username, input.username),
      });
      if (existing) {
        throw new Error("用户名已存在");
      }

      const hash = await hashPassword(input.password);
      const userResult = await db
        .insert(users)
        .values({
          username: input.username,
          passwordHash: hash,
          name: input.name,
          role: input.role,
          isActive: true,
        })
        .$returningId();
      const id = Number(userResult[0]?.id);
      if (!id) throw new Error("创建用户失败");

      return { id };
    }),

  update: authedQuery
    .input(
      z.object({
        id: z.number(),
        name: z.string().optional(),
        role: z.enum(["admin", "operator", "finance"]).optional(),
        isActive: z.boolean().optional(),
        password: z.string().min(6).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertCanAccessAccountManagement(ctx.user);
      const db = getDb();
      const updates: any = {};
      if (input.id === ctx.user.id && input.isActive === false) {
        throw new Error("不能停用当前登录账号");
      }
      if (input.id === ctx.user.id && input.role && input.role !== ctx.user.role) {
        throw new Error("不能修改当前登录账号的角色");
      }
      if (input.name !== undefined) updates.name = input.name;
      if (input.role !== undefined) updates.role = input.role;
      if (input.isActive !== undefined) updates.isActive = input.isActive;
      if (input.password) {
        updates.passwordHash = await hashPassword(input.password);
        updates.loginFailedAttempts = 0;
      }
      updates.updatedAt = new Date();

      await db.update(users).set(updates).where(eq(users.id, input.id));
      return { success: true };
    }),

  unlock: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanAccessAccountManagement(ctx.user);
      assertAdmin(ctx.user);
      const db = getDb();
      await db.update(users).set({
        loginFailedAttempts: 0,
        lockedAt: null,
        updatedAt: new Date(),
      }).where(eq(users.id, input.id));
      return { success: true };
    }),

  resetTwoFactor: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanAccessAccountManagement(ctx.user);
      assertAdmin(ctx.user);
      const db = getDb();
      await db.update(users).set({
        twoFactorSecret: null,
        twoFactorEnabled: false,
        twoFactorEnabledAt: null,
        updatedAt: new Date(),
      }).where(eq(users.id, input.id));
      return { success: true };
    }),

  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertCanAccessAccountManagement(ctx.user);
      if (input.id === ctx.user.id) {
        throw new Error("不能删除当前登录账号");
      }
      const db = getDb();
      await db.delete(users).where(eq(users.id, input.id));
      return { success: true };
    }),
});
