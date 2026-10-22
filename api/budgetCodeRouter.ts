import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { budgetCodes, budgetCodeHistories, fundraisingPlatforms } from "@db/schema";
import { and, asc, desc, eq, isNull, like, or } from "drizzle-orm";
import { userHasPermission } from "./lib/permissions";

function validateSegment(value: string, label: string) {
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`${label}必须为数字`);
  }
}

function joinCode(parentCode: string, segment: string) {
  return `${parentCode}.${segment.trim()}`;
}

function normalizeAssociatedIncomeProjects(values: string[] | undefined, primaryProject: string | null) {
  const primary = primaryProject?.trim() || "";
  const normalized = (values || []).map((value) => value.trim()).filter(Boolean);
  const uniqueValues = new Set(normalized);
  if (uniqueValues.size !== normalized.length) {
    throw new Error("关联NC项目不能重复，请检查");
  }
  return normalized.filter((value) => value !== primary);
}

function normalizeAssociatedDepartments(values: string[] | undefined, primaryDepartment: string | null) {
  const primary = primaryDepartment?.trim() || "";
  const normalized = (values || []).map((value) => value.trim()).filter(Boolean);
  const uniqueValues = new Set(normalized);
  if (uniqueValues.size !== normalized.length) {
    throw new Error("关联部门不能重复，请检查");
  }
  return normalized.filter((value) => value !== primary);
}

function buildBudgetTree(items: any[]) {
  const childrenByParentId = new Map<string, typeof items>();
  for (const item of items) {
    const key = item.parentId ? String(item.parentId) : "__root__";
    const children = childrenByParentId.get(key) || [];
    children.push(item);
    childrenByParentId.set(key, children);
  }

  const buildTree = (parentId: number | null): any[] =>
    (childrenByParentId.get(parentId ? String(parentId) : "__root__") || [])
      .map((item) => ({
        ...item,
        children: item.isLeaf ? [] : buildTree(item.id),
      }));

  return buildTree(null);
}

function budgetCodeSearchTree(items: any[], platforms: typeof fundraisingPlatforms.$inferSelect[], keyword: string) {
  const text = keyword.trim().toLowerCase();
  const platformNameMap = new Map(platforms.map((platform) => [
    platform.platformId,
    `${platform.platformId}_${platform.name}`,
  ]));
  const tree = buildBudgetTree(items);

  const filterTree = (nodes: any[]): any[] =>
    nodes
      .map((node) => {
        const children = filterTree(node.children || []);
        const platformName = node.platformId ? platformNameMap.get(node.platformId) || node.platformId : "";
        const fullCode = node.level === 3 ? `${node.code}-${node.name}` : `${node.code}_${node.name}`;
        const associatedProjects = Array.isArray(node.associatedIncomeProjects)
          ? node.associatedIncomeProjects.join(" ")
          : "";
        const associatedDepartments = Array.isArray(node.associatedDepartments)
          ? node.associatedDepartments.join(" ")
          : "";
        const selfText = `${node.code || ""} ${node.name} ${node.incomeProject || ""} ${associatedProjects} ${associatedDepartments} ${fullCode} ${platformName}`.toLowerCase();
        return selfText.includes(text) || children.length > 0 ? { ...node, children } : null;
      })
      .filter(Boolean);

  return filterTree(tree);
}

async function ensurePlatform(platformId?: string | null) {
  const normalized = platformId?.trim() || null;
  if (!normalized) return null;
  const db = getDb();
  const [platform] = await db
    .select()
    .from(fundraisingPlatforms)
    .where(eq(fundraisingPlatforms.platformId, normalized));
  if (!platform) throw new Error(`公益平台 ${normalized} 不存在`);
  return normalized;
}

async function updateDescendantPrefixes(oldPrefix: string, newPrefix: string) {
  const db = getDb();
  const descendants = await db
    .select()
    .from(budgetCodes)
    .where(like(budgetCodes.code, `${oldPrefix}.%`));

  for (const item of descendants) {
    if (!item.code) continue;
    const nextCode = item.code.replace(oldPrefix, newPrefix);
    await db
      .update(budgetCodes)
      .set({ code: nextCode, updatedAt: new Date() })
      .where(eq(budgetCodes.id, item.id));
  }
}

export const budgetCodeRouter = createRouter({
  tree: authedQuery.query(async () => {
    const db = getDb();
    const all = await db
      .select()
      .from(budgetCodes)
      .where(eq(budgetCodes.isActive, 1 as any))
      .orderBy(asc(budgetCodes.level), asc(budgetCodes.sortOrder), asc(budgetCodes.code));

    return buildBudgetTree(all);
  }),

  roots: authedQuery.query(async () => {
    const db = getDb();
    const roots = await db
      .select()
      .from(budgetCodes)
      .where(and(eq(budgetCodes.isActive, 1 as any), isNull(budgetCodes.parentId)))
      .orderBy(asc(budgetCodes.sortOrder), asc(budgetCodes.code));

    return roots.map((item) => ({ ...item, children: [] }));
  }),

  children: authedQuery
    .input(z.object({ parentId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const items = await db
        .select()
        .from(budgetCodes)
        .where(and(eq(budgetCodes.isActive, 1 as any), eq(budgetCodes.parentId, input.parentId)))
        .orderBy(asc(budgetCodes.sortOrder), asc(budgetCodes.code));

      return items.map((item) => ({ ...item, children: [] }));
    }),

  search: authedQuery
    .input(z.object({ keyword: z.string().trim().min(1).max(200) }))
    .query(async ({ input }) => {
      const db = getDb();
      const [all, platforms] = await Promise.all([
        db
          .select()
          .from(budgetCodes)
          .where(eq(budgetCodes.isActive, 1 as any))
          .orderBy(asc(budgetCodes.level), asc(budgetCodes.sortOrder), asc(budgetCodes.code)),
        db.select().from(fundraisingPlatforms),
      ]);

      return budgetCodeSearchTree(all, platforms, input.keyword);
    }),

  list: authedQuery
    .input(z.object({ level: z.number().optional(), parentId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const conditions = [eq(budgetCodes.isActive, 1 as any)];
      if (input?.level) conditions.push(eq(budgetCodes.level, input.level));
      if (input?.parentId !== undefined) conditions.push(eq(budgetCodes.parentId, input.parentId));
      return db
        .select()
        .from(budgetCodes)
        .where(conditions.length > 1 ? and(...conditions) : conditions[0])
        .orderBy(asc(budgetCodes.sortOrder), asc(budgetCodes.code));
    }),

  createCategory: authedQuery
    .input(z.object({
      name: z.string().min(1).max(500),
      code: z.string().min(1).max(100),
      incomeProject: z.string().max(200).optional(),
      associatedIncomeProjects: z.array(z.string().min(1).max(200)).optional(),
      associatedDepartments: z.array(z.string().min(1).max(200)).optional(),
      parentId: z.number().nullable(),
      level: z.number().min(1).max(2),
      sortOrder: z.number().default(0),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const segment = input.code.trim();
      validateSegment(segment, input.level === 1 ? "部门编号n1" : "NC项目编号n2");

      let finalCode = segment;
      let finalIncomeProject: string | null = null;
      if (input.level === 2) {
        if (!input.parentId) throw new Error("NC项目必须选择上级部门");
        const [parent] = await db.select().from(budgetCodes).where(eq(budgetCodes.id, input.parentId));
        if (!parent || parent.level !== 1) throw new Error("上级部门不存在");
        finalCode = joinCode(parent.code || "", segment);
        finalIncomeProject = input.incomeProject || input.name;
      } else if (input.parentId) {
        throw new Error("部门必须为根级");
      }
      const associatedDepartments = input.level === 1
        ? normalizeAssociatedDepartments(input.associatedDepartments, input.name)
        : null;

      const existing = await db.select().from(budgetCodes).where(eq(budgetCodes.code, finalCode));
      if (existing.length > 0) throw new Error(`编号 ${finalCode} 已存在`);

      const result = await db.insert(budgetCodes).values({
        code: finalCode,
        name: input.name.trim(),
        incomeProject: finalIncomeProject,
        associatedIncomeProjects: null,
        associatedDepartments,
        parentId: input.parentId,
        level: input.level,
        isLeaf: 0,
        sortOrder: input.sortOrder,
        isActive: 1,
      }).$returningId();

      return { id: Number(result[0]?.id) };
    }),

  createLeaf: authedQuery
    .input(z.object({
      code: z.string().max(100).optional(),
      name: z.string().min(1).max(500),
      platformId: z.string().max(20).nullable().optional(),
      parentId: z.number(),
      sortOrder: z.number().default(0),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const segment = input.code?.trim() || "";
      if (segment) validateSegment(segment, "渠道编号n3");

      const [parent] = await db.select().from(budgetCodes).where(eq(budgetCodes.id, input.parentId));
      if (!parent || parent.level !== 2) throw new Error("渠道必须添加在NC项目下");
      const existingChildren = await db.select().from(budgetCodes).where(eq(budgetCodes.parentId, input.parentId));
      const hasInheritedChannel = existingChildren.some((child) => child.isLeaf && child.code === parent.code);
      if (!segment && existingChildren.length > 0) throw new Error("该NC项目下已存在渠道，不能新增继承NC项目编号的渠道");
      if (segment && hasInheritedChannel) throw new Error("该NC项目已存在继承NC项目编号的渠道，不能再添加渠道");
      const finalCode = segment ? joinCode(parent.code || "", segment) : parent.code || "";

      const existing = await db.select().from(budgetCodes).where(eq(budgetCodes.code, finalCode));
      if (existing.some((row) => row.id !== parent.id)) throw new Error(`预算编码 ${finalCode} 已存在`);
      const platformId = await ensurePlatform(input.platformId);

      const result = await db.insert(budgetCodes).values({
        code: finalCode,
        name: input.name.trim(),
        incomeProject: parent.incomeProject || parent.name,
        associatedIncomeProjects: parent.associatedIncomeProjects || null,
        platformId,
        parentId: input.parentId,
        level: 3,
        isLeaf: 1,
        sortOrder: input.sortOrder,
        isActive: 1,
      }).$returningId();

      const newId = Number(result[0]?.id);
      await db.insert(budgetCodeHistories).values({
        budgetCodeId: newId,
        code: finalCode,
        name: input.name.trim(),
        incomeProject: parent.incomeProject || parent.name,
        platformId,
        effectiveDate: new Date(),
      });

      return { id: newId };
    }),

  updateCategory: authedQuery
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(500),
      code: z.string().min(1).max(100),
      incomeProject: z.string().max(200).optional(),
      associatedIncomeProjects: z.array(z.string().min(1).max(200)).optional(),
      associatedDepartments: z.array(z.string().min(1).max(200)).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [item] = await db.select().from(budgetCodes).where(eq(budgetCodes.id, input.id));
      if (!item) throw new Error("节点不存在");
      if (item.isLeaf) throw new Error("渠道请使用渠道编辑");

      const segment = input.code.trim();
      validateSegment(segment, item.level === 1 ? "部门编号n1" : "NC项目编号n2");

      let finalCode = segment;
      let finalIncomeProject: string | null = null;
      if (item.level === 2) {
        if (!item.parentId) throw new Error("NC项目缺少上级部门");
        const [parent] = await db.select().from(budgetCodes).where(eq(budgetCodes.id, item.parentId));
        if (!parent) throw new Error("上级部门不存在");
        finalCode = joinCode(parent.code || "", segment);
        finalIncomeProject = input.incomeProject || input.name;
      }
      const associatedIncomeProjects = item.level === 2
        ? normalizeAssociatedIncomeProjects(input.associatedIncomeProjects, finalIncomeProject)
        : null;
      const associatedDepartments = item.level === 1
        ? normalizeAssociatedDepartments(input.associatedDepartments, input.name)
        : null;

      if (finalCode !== item.code) {
        const existing = await db.select().from(budgetCodes).where(eq(budgetCodes.code, finalCode));
        if (existing.some((row) => row.id !== input.id)) throw new Error(`编号 ${finalCode} 已存在`);
      }

      await db.update(budgetCodes).set({
        code: finalCode,
        name: input.name.trim(),
        incomeProject: finalIncomeProject,
        associatedIncomeProjects,
        associatedDepartments,
        updatedAt: new Date(),
      }).where(eq(budgetCodes.id, input.id));

      if (item.code && finalCode !== item.code) {
        if (item.level === 2) {
          await db.update(budgetCodes).set({
            code: finalCode,
            updatedAt: new Date(),
          }).where(and(
            eq(budgetCodes.parentId, input.id),
            eq(budgetCodes.code, item.code),
          ));
        }
        await updateDescendantPrefixes(item.code, finalCode);
      }
      if (item.level === 2) {
        await db.update(budgetCodes).set({
          incomeProject: finalIncomeProject,
          associatedIncomeProjects,
          updatedAt: new Date(),
        }).where(eq(budgetCodes.parentId, input.id));
      }

      return { success: true };
    }),

  updateLeaf: authedQuery
    .input(z.object({
      id: z.number(),
      code: z.string().max(100).optional(),
      name: z.string().min(1).max(500),
      platformId: z.string().max(20).nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [item] = await db.select().from(budgetCodes).where(eq(budgetCodes.id, input.id));
      if (!item) throw new Error("渠道不存在");
      if (!item.isLeaf) throw new Error("只能修改渠道");
      if (!item.parentId) throw new Error("渠道缺少上级NC项目");

      const [parent] = await db.select().from(budgetCodes).where(eq(budgetCodes.id, item.parentId));
      if (!parent) throw new Error("上级NC项目不存在");

      const segment = input.code?.trim() || "";
      if (segment) validateSegment(segment, "渠道编号n3");
      const siblings = await db
        .select()
        .from(budgetCodes)
        .where(eq(budgetCodes.parentId, item.parentId));
      const otherChannels = siblings.filter((child) => child.id !== input.id);
      const hasOtherInheritedChannel = otherChannels.some((child) => child.isLeaf && child.code === parent.code);
      if (!segment && otherChannels.length > 0) throw new Error("该NC项目下已存在其他渠道，不能改为继承NC项目编号");
      if (segment && hasOtherInheritedChannel) throw new Error("该NC项目已存在继承NC项目编号的渠道，不能再添加渠道");
      const finalCode = segment ? joinCode(parent.code || "", segment) : parent.code || "";

      if (finalCode !== item.code) {
        const existing = await db.select().from(budgetCodes).where(eq(budgetCodes.code, finalCode));
        if (existing.some((row) => row.id !== input.id && row.id !== parent.id)) throw new Error(`预算编码 ${finalCode} 已存在`);
      }
      const platformId = await ensurePlatform(input.platformId);

      await db.insert(budgetCodeHistories).values({
        budgetCodeId: input.id,
        code: item.code || "",
        name: item.name,
        incomeProject: item.incomeProject || null,
        platformId: item.platformId || null,
        effectiveDate: new Date(),
      });

      await db.update(budgetCodes).set({
        code: finalCode,
        name: input.name.trim(),
        incomeProject: parent.incomeProject || parent.name,
        associatedIncomeProjects: parent.associatedIncomeProjects || null,
        platformId,
        updatedAt: new Date(),
      }).where(eq(budgetCodes.id, input.id));

      return { success: true };
    }),

  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "recognition_info_delete"))) throw new Error("权限不足");
      const db = getDb();
      const [item] = await db.select().from(budgetCodes).where(eq(budgetCodes.id, input.id));
      if (!item) return { success: true };

      const children = await db.select().from(budgetCodes).where(eq(budgetCodes.parentId, input.id));
      if (children.length > 0) throw new Error("该节点存在下级，不能删除");

      await db.delete(budgetCodes).where(eq(budgetCodes.id, input.id));
      await db.delete(budgetCodeHistories).where(eq(budgetCodeHistories.budgetCodeId, input.id));
      return { success: true };
    }),

  histories: authedQuery
    .input(z.object({ budgetCodeId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db.select().from(budgetCodeHistories)
        .where(eq(budgetCodeHistories.budgetCodeId, input.budgetCodeId))
        .orderBy(desc(budgetCodeHistories.createdAt));
    }),

  matchPlatforms: authedQuery.mutation(async () => {
    const db = getDb();
    const channels = await db
      .select()
      .from(budgetCodes)
      .where(and(
        eq(budgetCodes.isActive, 1 as any),
        eq(budgetCodes.level, 3),
        eq(budgetCodes.isLeaf, 1),
        or(isNull(budgetCodes.platformId), eq(budgetCodes.platformId, "")),
      ));
    const platforms = await db.select().from(fundraisingPlatforms);
    const platformByName = new Map(platforms.map((platform) => [platform.name, platform.platformId]));

    let matched = 0;
    let skippedUnmatched = 0;

    for (const channel of channels) {
      const platformId = platformByName.get(channel.name);
      if (!platformId) {
        skippedUnmatched++;
        continue;
      }

      await db.insert(budgetCodeHistories).values({
        budgetCodeId: channel.id,
        code: channel.code || "",
        name: channel.name,
        incomeProject: channel.incomeProject || null,
        platformId: channel.platformId || null,
        effectiveDate: new Date(),
      });
      await db.update(budgetCodes).set({
        platformId,
        updatedAt: new Date(),
      }).where(eq(budgetCodes.id, channel.id));
      matched++;
    }

    return {
      total: channels.length,
      matched,
      skippedUnmatched,
    };
  }),

  clearAll: authedQuery.mutation(async () => {
    const db = getDb();
    await db.delete(budgetCodeHistories);
    await db.delete(budgetCodes);
    return { success: true };
  }),
});
