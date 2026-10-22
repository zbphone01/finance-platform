import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { fundraisingPlatforms, projectNameHistories, projects } from "@db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { userHasPermission } from "./lib/permissions";

const levelLabels: Record<number, string> = {
  1: "项目",
  2: "NC项目名称",
  3: "平台项目名称",
};

function validateCode(level: number, code: string) {
  if (level === 1 && !/^\d+$/.test(code)) {
    throw new Error("项目编号必须是数字，如 01");
  }
  if (level === 2 && !/^PM\d{1,11}$/i.test(code)) {
    throw new Error("NC项目编号必须以 PM 开头加最多11位数字，如 PM0000001");
  }
  if (level === 3 && !/^PP\d{7}$/i.test(code)) {
    throw new Error("平台项目编号必须以 PP 开头加7位数字，如 PP0000001");
  }
}

export const projectRouter = createRouter({
  list: authedQuery
    .input(z.object({ level: z.number().optional(), parentCode: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const conditions = [eq(projects.isActive, 1 as any)];
      if (input?.level) conditions.push(eq(projects.level, input.level));
      if (input?.parentCode) conditions.push(eq(projects.parentCode, input.parentCode));
      return db
        .select()
        .from(projects)
        .where(conditions.length > 1 ? and(...conditions) : conditions[0])
        .orderBy(asc(projects.sortOrder), asc(projects.code));
    }),

  tree: authedQuery.query(async () => {
    const db = getDb();
    const all = await db
      .select({
        id: projects.id,
        code: projects.code,
        name: projects.name,
        parentCode: projects.parentCode,
        level: projects.level,
        platformId: projects.platformId,
        platformName: fundraisingPlatforms.name,
        sortOrder: projects.sortOrder,
        isActive: projects.isActive,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .leftJoin(fundraisingPlatforms, eq(projects.platformId, fundraisingPlatforms.platformId))
      .where(eq(projects.isActive, 1 as any))
      .orderBy(asc(projects.sortOrder), asc(projects.code));

    const childrenByParentCode = new Map<string, typeof all>();
    for (const item of all) {
      const key = item.parentCode || "__root__";
      const children = childrenByParentCode.get(key) || [];
      children.push(item);
      childrenByParentCode.set(key, children);
    }

    const buildTree = (parentCode: string | null): any[] => {
      return (childrenByParentCode.get(parentCode || "__root__") || [])
        .map((p) => ({
          ...p,
          children: buildTree(p.code),
        }));
    };

    return buildTree(null);
  }),

  create: authedQuery
    .input(z.object({
      code: z.string().min(1).max(50),
      name: z.string().min(1).max(500),
      parentCode: z.string().nullable(),
      level: z.number().min(1).max(3),
      platformId: z.string().max(20).nullable().optional(),
      sortOrder: z.number().default(0),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      validateCode(input.level, input.code);

      if (input.level > 1 && !input.parentCode) {
        throw new Error(`${levelLabels[input.level]}必须选择上级`);
      }
      if (input.level === 3 && !input.platformId) {
        throw new Error("平台项目名称必须选择公益平台");
      }

      if (input.parentCode) {
        const [parent] = await db.select().from(projects).where(eq(projects.code, input.parentCode));
        if (!parent) throw new Error(`上级项目 ${input.parentCode} 不存在`);
        if (parent.level !== input.level - 1) {
          throw new Error("项目层级关系错误");
        }
      }

      if (input.platformId) {
        const [platform] = await db
          .select()
          .from(fundraisingPlatforms)
          .where(eq(fundraisingPlatforms.platformId, input.platformId));
        if (!platform) throw new Error(`公益平台 ${input.platformId} 不存在`);
      }

      const existing = await db.select().from(projects).where(eq(projects.code, input.code));
      if (existing.length > 0) throw new Error(`项目编号 ${input.code} 已存在`);

      const result = await db.insert(projects).values({
        code: input.code,
        name: input.name,
        parentCode: input.parentCode,
        level: input.level,
        platformId: input.level === 3 ? input.platformId || null : null,
        sortOrder: input.sortOrder,
        isActive: 1,
      }).$returningId();

      const id = Number(result[0]?.id);
      if (input.level === 3) {
        await db.insert(projectNameHistories).values({
          projectId: id,
          code: input.code,
          platformId: input.platformId || null,
          name: input.name,
          effectiveDate: new Date(),
        });
      }

      return { id };
    }),

  update: authedQuery
    .input(z.object({
      id: z.number(),
      code: z.string().min(1).max(50).optional(),
      name: z.string().min(1).max(500).optional(),
      sortOrder: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [item] = await db.select().from(projects).where(eq(projects.id, input.id));
      if (!item) throw new Error("项目不存在");

      const updateData: any = { updatedAt: new Date() };
      if (input.code !== undefined && input.code !== item.code) {
        validateCode(item.level, input.code);
        const existing = await db.select().from(projects).where(eq(projects.code, input.code));
        if (existing.length > 0) throw new Error(`项目编号 ${input.code} 已存在`);
        updateData.code = input.code;
      }
      if (input.name !== undefined) updateData.name = input.name;
      if (input.sortOrder !== undefined) updateData.sortOrder = input.sortOrder;

      await db.update(projects).set(updateData).where(eq(projects.id, input.id));

      if ((item.level === 1 || item.level === 2) && input.code !== undefined && input.code !== item.code) {
        await db.update(projects).set({
          parentCode: input.code,
          updatedAt: new Date(),
        }).where(eq(projects.parentCode, item.code));
      }

      if (item.level === 3 && input.name !== undefined) {
        await db.insert(projectNameHistories).values({
          projectId: item.id,
          code: input.code || item.code,
          platformId: item.platformId,
          name: input.name,
          effectiveDate: new Date(),
        });
      }

      return { success: true };
    }),

  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "recognition_info_delete"))) throw new Error("权限不足");
      const db = getDb();
      const [proj] = await db.select().from(projects).where(eq(projects.id, input.id));
      if (proj) {
        const children = await db.select().from(projects).where(eq(projects.parentCode, proj.code));
        if (children.length > 0) throw new Error("该项目存在下级，不能删除");
      }
      await db.delete(projectNameHistories).where(eq(projectNameHistories.projectId, input.id));
      await db.delete(projects).where(eq(projects.id, input.id));
      return { success: true };
    }),

  histories: authedQuery
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select({
          id: projectNameHistories.id,
          projectId: projectNameHistories.projectId,
          code: projectNameHistories.code,
          platformId: projectNameHistories.platformId,
          platformName: fundraisingPlatforms.name,
          name: projectNameHistories.name,
          effectiveDate: projectNameHistories.effectiveDate,
          createdAt: projectNameHistories.createdAt,
        })
        .from(projectNameHistories)
        .leftJoin(fundraisingPlatforms, eq(projectNameHistories.platformId, fundraisingPlatforms.platformId))
        .where(eq(projectNameHistories.projectId, input.projectId))
        .orderBy(desc(projectNameHistories.createdAt));
    }),

  batchCreate: authedQuery
    .input(z.array(z.object({
      code: z.string().min(1).max(50),
      name: z.string().min(1).max(500),
      parentCode: z.string().nullable(),
      level: z.number().min(1).max(3),
      platformId: z.string().max(20).nullable().optional(),
      sortOrder: z.number().default(0),
    })))
    .mutation(async ({ input }) => {
      const db = getDb();
      if (input.length > 0) {
        await db.insert(projects).values(input.map((i) => ({
          code: i.code,
          name: i.name,
          parentCode: i.parentCode,
          level: i.level,
          platformId: i.level === 3 ? i.platformId || null : null,
          sortOrder: i.sortOrder,
          isActive: 1,
        })));
      }
      return { count: input.length };
    }),
});
