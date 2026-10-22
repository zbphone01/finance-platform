import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { donationActivities } from "@db/schema";
import { eq, and, asc, isNull } from "drizzle-orm";
import { userHasPermission } from "./lib/permissions";

async function findDuplicateActivityName(
  db: any,
  name: string,
  parentCode: string | null,
  excludeId?: number,
) {
  const conditions = [
    eq(donationActivities.level, 2),
    eq(donationActivities.name, name),
    eq(donationActivities.isActive, 1 as any),
    parentCode ? eq(donationActivities.parentCode, parentCode) : isNull(donationActivities.parentCode),
  ];
  const duplicates = await db.select().from(donationActivities).where(and(...conditions));
  return duplicates.find((item: any) => Number(item.id) !== excludeId);
}

export const donationActivityRouter = createRouter({
  // 列表
  list: authedQuery
    .input(z.object({ level: z.number().optional(), parentCode: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const conditions = [eq(donationActivities.isActive, 1 as any)];
      if (input?.level) {
        conditions.push(eq(donationActivities.level, input.level));
      }
      if (input?.parentCode !== undefined) {
        if (input.parentCode === null) {
          conditions.push(isNull(donationActivities.parentCode));
        } else {
          conditions.push(eq(donationActivities.parentCode, input.parentCode));
        }
      }
      const items = await db.select().from(donationActivities)
        .where(conditions.length > 1 ? and(...conditions) : conditions[0])
        .orderBy(asc(donationActivities.sortOrder), asc(donationActivities.code));
      return items;
    }),

  // 树形结构
  tree: authedQuery.query(async () => {
    const db = getDb();
    const all = await db.select().from(donationActivities)
      .where(eq(donationActivities.isActive, 1 as any))
      .orderBy(asc(donationActivities.code));

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

  // 创建
  create: authedQuery
    .input(z.object({
      code: z.string().min(1).max(20),
      name: z.string().min(1).max(500),
      parentCode: z.string().nullable(),
      level: z.number().min(1).max(2),
      sortOrder: z.number().default(0),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();

      // 校验编码格式
      if (input.level === 1) {
        if (!/^\d$/.test(input.code)) {
          throw new Error("分类编号必须是1位数字，如 1、2、3");
        }
      }
      if (input.level === 2) {
        if (!/^[A-Za-z0-9]{3,6}$/.test(input.code)) {
          throw new Error("活动说明编号必须是3至6位数字或字母，如 001、A01");
        }
      }

      // 校验父级
      if (input.parentCode) {
        const parents = await db.select().from(donationActivities)
          .where(eq(donationActivities.code, input.parentCode));
        if (parents.length === 0) {
          throw new Error(`上级分类 ${input.parentCode} 不存在`);
        }
      }

      // 校验编码唯一性
      const existing = await db.select().from(donationActivities)
        .where(eq(donationActivities.code, input.code));
      if (existing.length > 0) {
        throw new Error(`编号 ${input.code} 已存在`);
      }
      if (input.level === 2) {
        const duplicateName = await findDuplicateActivityName(db, input.name, input.parentCode);
        if (duplicateName) {
          throw new Error(`活动说明“${input.name}”已存在`);
        }
      }

      const result = await db.insert(donationActivities).values({
        code: input.code,
        name: input.name,
        parentCode: input.parentCode,
        level: input.level,
        isLeaf: input.level === 2 ? 1 : 0,
        sortOrder: input.sortOrder,
        isActive: 1,
      }).$returningId();

      return { id: Number(result[0]?.id) };
    }),

  // 更新
  update: authedQuery
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(500).optional(),
      sortOrder: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [item] = await db.select().from(donationActivities).where(eq(donationActivities.id, input.id));
      if (!item) {
        throw new Error("捐赠活动不存在");
      }
      if (input.name !== undefined && item.level === 2) {
        const duplicateName = await findDuplicateActivityName(db, input.name, item.parentCode, input.id);
        if (duplicateName) {
          throw new Error(`活动说明“${input.name}”已存在`);
        }
      }
      const updateData: any = { updatedAt: new Date() };
      if (input.name !== undefined) updateData.name = input.name;
      if (input.sortOrder !== undefined) updateData.sortOrder = input.sortOrder;
      await db.update(donationActivities).set(updateData).where(eq(donationActivities.id, input.id));
      return { success: true };
    }),

  // 删除
  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "recognition_info_delete"))) throw new Error("权限不足");
      const db = getDb();
      const [item] = await db.select().from(donationActivities).where(eq(donationActivities.id, input.id));
      if (item) {
        const children = await db.select().from(donationActivities)
          .where(eq(donationActivities.parentCode, item.code));
        if (children.length > 0) {
          throw new Error("该分类存在下级活动说明，不能删除");
        }
      }
      await db.delete(donationActivities).where(eq(donationActivities.id, input.id));
      return { success: true };
    }),

  // 批量创建（预设数据）
  batchCreate: authedQuery
    .input(z.array(z.object({
      code: z.string().min(1).max(20),
      name: z.string().min(1).max(500),
      parentCode: z.string().nullable(),
      level: z.number().min(1).max(2),
      sortOrder: z.number().default(0),
    })))
    .mutation(async ({ input }) => {
      const db = getDb();
      if (input.length > 0) {
        await db.insert(donationActivities).values(input.map(i => ({
          code: i.code,
          name: i.name,
          parentCode: i.parentCode,
          level: i.level,
          isLeaf: i.level === 2 ? 1 : 0,
          sortOrder: i.sortOrder,
          isActive: 1,
        })));
      }
      return { count: input.length };
    }),

  // CSV导入
  importCsv: authedQuery
    .input(z.array(z.object({
      categoryCode: z.string(),
      categoryName: z.string(),
      activityCode: z.string(),
      activityName: z.string(),
    })))
    .mutation(async ({ input }) => {
      const db = getDb();
      if (input.length === 0) {
        throw new Error("CSV中没有可导入内容");
      }

      const categories = new Map<string, { code: string; name: string; rowNumber: number; sortOrder: number }>();
      const activities: Array<{
        categoryCode: string;
        code: string;
        name: string;
        rowNumber: number;
        sortOrder: number;
      }> = [];
      const activityCodes = new Map<string, number>();
      const activityNamesByCategory = new Map<string, number>();

      input.forEach((rawRow, index) => {
        const rowNumber = index + 2;
        const categoryCode = rawRow.categoryCode.trim();
        const categoryName = rawRow.categoryName.trim();
        const activityCode = rawRow.activityCode.trim();
        const activityName = rawRow.activityName.trim();
        const hasCategory = Boolean(categoryCode || categoryName);
        const hasActivity = Boolean(activityCode || activityName);

        if (!hasCategory && !hasActivity) return;
        if (hasCategory) {
          if (!categoryCode) throw new Error(`第${rowNumber}行分类编号不能为空`);
          if (!categoryName) throw new Error(`第${rowNumber}行分类不能为空`);
          if (!/^\d$/.test(categoryCode)) throw new Error(`第${rowNumber}行分类编号必须是1位数字`);

          const existingCategory = categories.get(categoryCode);
          if (existingCategory && existingCategory.name !== categoryName) {
            throw new Error(`第${rowNumber}行分类编号 ${categoryCode} 与第${existingCategory.rowNumber}行分类名称不一致`);
          }
          if (!existingCategory) {
            categories.set(categoryCode, {
              code: categoryCode,
              name: categoryName,
              rowNumber,
              sortOrder: categories.size,
            });
          }
        }

        if (!hasActivity) return;
        if (!activityCode) throw new Error(`第${rowNumber}行活动说明编号不能为空`);
        if (!activityName) throw new Error(`第${rowNumber}行活动说明不能为空`);
        if (!/^[A-Za-z0-9]{3,6}$/.test(activityCode)) throw new Error(`第${rowNumber}行活动说明编号必须是3至6位数字或字母`);

        const duplicatedCodeRow = activityCodes.get(activityCode);
        if (duplicatedCodeRow) {
          throw new Error(`第${rowNumber}行活动说明编号 ${activityCode} 与第${duplicatedCodeRow}行重复`);
        }
        activityCodes.set(activityCode, rowNumber);

        const nameKey = `${categoryCode}\u0000${activityName}`;
        const duplicatedNameRow = activityNamesByCategory.get(nameKey);
        if (duplicatedNameRow) {
          throw new Error(`第${rowNumber}行活动说明“${activityName}”与第${duplicatedNameRow}行重复`);
        }
        activityNamesByCategory.set(nameKey, rowNumber);

        activities.push({
          categoryCode,
          code: activityCode,
          name: activityName,
          rowNumber,
          sortOrder: activities.filter((item) => item.categoryCode === categoryCode).length,
        });
      });

      const existingItems = await db.select().from(donationActivities);
      const existingByCode = new Map(existingItems.map((item: any) => [item.code, item]));
      const activeActivityByParentAndName = new Map<string, any>();
      existingItems.forEach((item: any) => {
        if (item.level === 2 && item.isActive === 1) {
          activeActivityByParentAndName.set(`${item.parentCode || ""}\u0000${item.name}`, item);
        }
      });

      for (const category of categories.values()) {
        const existing = existingByCode.get(category.code);
        if (existing && existing.level !== 1) {
          throw new Error(`第${category.rowNumber}行分类编号 ${category.code} 已被活动说明占用`);
        }
      }

      for (const activity of activities) {
        const existing = existingByCode.get(activity.code);
        if (existing && existing.level !== 2) {
          throw new Error(`第${activity.rowNumber}行活动说明编号 ${activity.code} 已被分类占用`);
        }
        const duplicateName = activeActivityByParentAndName.get(`${activity.categoryCode}\u0000${activity.name}`);
        if (duplicateName && duplicateName.code !== activity.code) {
          throw new Error(`第${activity.rowNumber}行活动说明“${activity.name}”已存在`);
        }
      }

      let inserted = 0;
      let updated = 0;
      await db.transaction(async (tx: any) => {
        for (const category of categories.values()) {
          const existing = existingByCode.get(category.code);
          if (existing) {
            updated += 1;
            await tx.update(donationActivities).set({
              name: category.name,
              parentCode: null,
              level: 1,
              isLeaf: 0,
              sortOrder: category.sortOrder,
              isActive: 1,
              updatedAt: new Date(),
            }).where(eq(donationActivities.id, existing.id));
          } else {
            inserted += 1;
            await tx.insert(donationActivities).values({
              code: category.code,
              name: category.name,
              parentCode: null,
              level: 1,
              isLeaf: 0,
              sortOrder: category.sortOrder,
              isActive: 1,
            });
          }
        }

        for (const activity of activities) {
          const existing = existingByCode.get(activity.code);
          if (existing) {
            updated += 1;
            await tx.update(donationActivities).set({
              name: activity.name,
              parentCode: activity.categoryCode || null,
              level: 2,
              isLeaf: 1,
              sortOrder: activity.sortOrder,
              isActive: 1,
              updatedAt: new Date(),
            }).where(eq(donationActivities.id, existing.id));
          } else {
            inserted += 1;
            await tx.insert(donationActivities).values({
              code: activity.code,
              name: activity.name,
              parentCode: activity.categoryCode || null,
              level: 2,
              isLeaf: 1,
              sortOrder: activity.sortOrder,
              isActive: 1,
            });
          }
        }
      });

      return {
        categories: categories.size,
        activities: activities.length,
        inserted,
        updated,
      };
    }),
});
