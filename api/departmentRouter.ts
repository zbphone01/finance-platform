import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { departments } from "@db/schema";
import { eq, and, asc } from "drizzle-orm";
import { userHasPermission } from "./lib/permissions";

const presetDepartments = [
  { code: "00", name: "北京秘书处", parentCode: null, level: 1, sortOrder: 0 },
  { code: "01", name: "项目中心", parentCode: null, level: 1, sortOrder: 1 },
  { code: "02", name: "专项基金", parentCode: null, level: 1, sortOrder: 2 },
  { code: "0001", name: "项目组", parentCode: "00", level: 2, sortOrder: 0 },
  { code: "0002", name: "职能部门", parentCode: "00", level: 2, sortOrder: 1 },
  { code: "000101", name: "一亿颗梭梭", parentCode: "0001", level: 3, sortOrder: 0 },
  { code: "000201", name: "财务组", parentCode: "0002", level: 3, sortOrder: 0 },
  { code: "000202", name: "人事组", parentCode: "0002", level: 3, sortOrder: 1 },
];

export const departmentRouter = createRouter({
  // 列表（支持按层级筛选）
  list: authedQuery
    .input(z.object({ level: z.number().optional(), parentCode: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const conditions = [eq(departments.isActive, 1 as any)];
      if (input?.level) {
        conditions.push(eq(departments.level, input.level));
      }
      if (input?.parentCode) {
        conditions.push(eq(departments.parentCode, input.parentCode));
      }
      const items = await db.select().from(departments)
        .where(conditions.length > 1 ? and(...conditions) : conditions[0])
        .orderBy(asc(departments.sortOrder), asc(departments.code));
      return items;
    }),

  // 获取树形结构
  tree: authedQuery.query(async () => {
    const db = getDb();
    const all = await db.select().from(departments)
      .where(eq(departments.isActive, 1 as any))
      .orderBy(asc(departments.code));

    const childrenByParentCode = new Map<string, typeof all>();
    for (const item of all) {
      const key = item.parentCode || "__root__";
      const children = childrenByParentCode.get(key) || [];
      children.push(item);
      childrenByParentCode.set(key, children);
    }

    const buildTree = (parentCode: string | null): any[] => {
      return (childrenByParentCode.get(parentCode || "__root__") || [])
        .map((d) => ({
          ...d,
          children: d.level < 3 ? buildTree(d.code) : [],
        }));
    };

    return buildTree(null);
  }),

  // 创建
  create: authedQuery
    .input(z.object({
      code: z.string().min(1).max(20),
      name: z.string().min(1).max(200),
      parentCode: z.string().nullable(),
      level: z.number().min(1).max(3),
      sortOrder: z.number().default(0),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();

      // 校验编码格式
      const codeLen = input.code.length;
      if (input.level === 1 && codeLen !== 2) {
        throw new Error("一级部门编码必须为2位数字，如 00");
      }
      if (input.level === 2 && codeLen !== 4) {
        throw new Error("二级部门编码必须为4位数字，如 0001");
      }
      if (input.level === 3 && codeLen !== 6) {
        throw new Error("三级分组编码必须为6位数字，如 000101");
      }

      // 校验父级关系
      if (input.parentCode) {
        const parents = await db.select().from(departments)
          .where(eq(departments.code, input.parentCode));
        if (parents.length === 0) {
          throw new Error(`上级部门 ${input.parentCode} 不存在`);
        }
        const parent = parents[0];
        if (parent.level !== input.level - 1) {
          throw new Error("部门层级关系错误：上级部门层级不对");
        }
        // 校验编码前缀
        if (!input.code.startsWith(input.parentCode)) {
          throw new Error(`编码必须以父级编码 ${input.parentCode} 开头`);
        }
      }

      // 校验编码唯一性
      const existing = await db.select().from(departments)
        .where(eq(departments.code, input.code));
      if (existing.length > 0) {
        throw new Error(`部门编码 ${input.code} 已存在`);
      }

      const result = await db.insert(departments).values({
        code: input.code,
        name: input.name,
        parentCode: input.parentCode,
        level: input.level,
        sortOrder: input.sortOrder,
        isActive: 1,
      }).$returningId();

      return { id: Number(result[0]?.id) };
    }),

  // 更新
  update: authedQuery
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(200),
      sortOrder: z.number().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.update(departments).set({
        name: input.name,
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive ? 1 : 0 } : {}),
        updatedAt: new Date(),
      }).where(eq(departments.id, input.id));
      return { success: true };
    }),

  // 删除（软删除）
  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "recognition_info_delete"))) throw new Error("权限不足");
      const db = getDb();
      // 检查是否有下级
      const [dept] = await db.select().from(departments).where(eq(departments.id, input.id));
      if (dept) {
        const children = await db.select().from(departments)
          .where(eq(departments.parentCode, dept.code));
        if (children.length > 0) {
          throw new Error("该部门存在下级，不能删除");
        }
      }
      await db.delete(departments).where(eq(departments.id, input.id));
      return { success: true };
    }),

  // 获取单条
  getById: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const [dept] = await db.select().from(departments)
        .where(eq(departments.id, input.id));
      return dept || null;
    }),

  ensurePreset: authedQuery.mutation(async () => {
    const db = getDb();
    const existing = await db.select({ id: departments.id }).from(departments).limit(1);
    if (existing.length > 0) {
      return { initialized: false, count: 0 };
    }

    await db.insert(departments).values(presetDepartments.map((item) => ({
      ...item,
      isActive: 1,
    })));

    return { initialized: true, count: presetDepartments.length };
  }),
});
