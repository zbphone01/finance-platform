import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import { eq } from "drizzle-orm";
import { verifyPassword, hashPassword, createSession, deleteSession } from "./lib/auth";
import { consumeLoginIpAttempt, getClientIp, LOGIN_LOCK_FAILED_ATTEMPTS } from "./lib/loginSecurity";
import {
  createTwoFactorSetup,
  decryptTwoFactorSecret,
  encryptTwoFactorSecret,
  verifyTwoFactorCode,
} from "./lib/twoFactor";
import {
  consumeTwoFactorLoginTicket,
  createTwoFactorLoginTicket,
  getTwoFactorLoginTicket,
  recordTwoFactorLoginFailure,
} from "./lib/twoFactorLoginTickets";

function authUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
  };
}

async function setSessionCookie(userId: number, headers: Headers) {
  const token = await createSession(userId);
  const cookie = `session_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`;
  headers.append("Set-Cookie", cookie);
}

export const authRouter = createRouter({
  login: publicQuery
    .input(
      z.object({
        username: z.string().min(1, "用户名不能为空"),
        password: z.string().min(1, "密码不能为空"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ipCheck = consumeLoginIpAttempt(getClientIp(ctx.req));
      if (!ipCheck.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: `登录尝试过于频繁，请 ${ipCheck.retryAfterSeconds} 秒后再试`,
        });
      }

      const db = getDb();
      const user = await db.query.users.findFirst({
        where: eq(users.username, input.username),
      });

      if (!user || !user.isActive) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "用户名或密码错误" });
      }

      if (user.lockedAt) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "账号已锁定，请联系管理员解锁" });
      }

      const valid = await verifyPassword(input.password, user.passwordHash);
      if (!valid) {
        const failedAttempts = Number(user.loginFailedAttempts || 0) + 1;
        const lockedAt = failedAttempts >= LOGIN_LOCK_FAILED_ATTEMPTS ? new Date() : null;
        await db.update(users).set({
          loginFailedAttempts: failedAttempts,
          lockedAt,
          updatedAt: new Date(),
        }).where(eq(users.id, user.id));

        if (lockedAt) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "密码连续错误3次，账号已锁定，请联系管理员解锁" });
        }
        throw new TRPCError({ code: "UNAUTHORIZED", message: "用户名或密码错误" });
      }

      await db.update(users).set({
        loginFailedAttempts: 0,
        lockedAt: null,
        updatedAt: new Date(),
      }).where(eq(users.id, user.id));

      if (user.twoFactorEnabled && user.twoFactorSecret) {
        return {
          requiresTwoFactor: true as const,
          ticket: createTwoFactorLoginTicket(user.id),
        };
      }

      await setSessionCookie(user.id, ctx.resHeaders);

      return {
        requiresTwoFactor: false as const,
        user: authUser(user),
      };
    }),

  verifyTwoFactorLogin: publicQuery
    .input(
      z.object({
        ticket: z.string().min(1),
        code: z.string().min(6, "请输入验证码").max(12),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const ticket = getTwoFactorLoginTicket(input.ticket);
      if (!ticket) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "验证码登录已过期，请重新输入账号密码" });
      }

      const db = getDb();
      const user = await db.query.users.findFirst({
        where: eq(users.id, ticket.userId),
      });
      if (!user || !user.isActive) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "账号不可用" });
      }
      if (user.lockedAt) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "账号已锁定，请联系管理员解锁" });
      }
      if (!user.twoFactorEnabled || !user.twoFactorSecret) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "账号未启用验证器登录" });
      }

      const secret = decryptTwoFactorSecret(user.twoFactorSecret);
      if (!(await verifyTwoFactorCode(secret, input.code))) {
        const nextTicket = recordTwoFactorLoginFailure(input.ticket);
        if (!nextTicket) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "验证码错误次数过多，请重新输入账号密码" });
        }
        throw new TRPCError({ code: "UNAUTHORIZED", message: "验证码错误" });
      }

      consumeTwoFactorLoginTicket(input.ticket);
      await setSessionCookie(user.id, ctx.resHeaders);
      return { user: authUser(user) };
    }),

  logout: authedQuery.mutation(async ({ ctx }) => {
    const cookie = ctx.req.headers.get("cookie") || "";
    const tokenMatch = cookie.match(/session_token=([^;]+)/);
    if (tokenMatch) {
      await deleteSession(decodeURIComponent(tokenMatch[1]));
    }
    ctx.resHeaders.append("Set-Cookie", "session_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    return { success: true };
  }),

  changePassword: authedQuery
    .input(
      z.object({
        currentPassword: z.string().min(1, "请输入原密码"),
        newPassword: z.string().min(6, "新密码至少6位"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const user = await db.query.users.findFirst({
        where: eq(users.id, ctx.user.id),
      });
      if (!user || !user.isActive) throw new Error("当前账号不可用");

      const valid = await verifyPassword(input.currentPassword, user.passwordHash);
      if (!valid) throw new Error("原密码错误");

      await db.update(users).set({
        passwordHash: await hashPassword(input.newPassword),
        loginFailedAttempts: 0,
        updatedAt: new Date(),
      }).where(eq(users.id, ctx.user.id));

      return { success: true };
    }),

  twoFactorStatus: authedQuery.query(({ ctx }) => {
    return {
      enabled: Boolean(ctx.user.twoFactorEnabled),
      enabledAt: ctx.user.twoFactorEnabledAt,
    };
  }),

  startTwoFactorSetup: authedQuery.mutation(async ({ ctx }) => {
    return createTwoFactorSetup(ctx.user.username);
  }),

  enableTwoFactor: authedQuery
    .input(
      z.object({
        secret: z.string().min(10),
        code: z.string().min(6, "请输入验证码").max(12),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (!(await verifyTwoFactorCode(input.secret, input.code))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "验证码错误，请重新输入" });
      }

      await getDb().update(users).set({
        twoFactorSecret: encryptTwoFactorSecret(input.secret),
        twoFactorEnabled: true,
        twoFactorEnabledAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(users.id, ctx.user.id));

      return { success: true };
    }),

  me: publicQuery.query(async ({ ctx }) => {
    if (!ctx.user) {
      return null;
    }
    return authUser(ctx.user);
  }),
});
