import { z } from "zod";
import { and, count, desc, eq, like } from "drizzle-orm";
import { invoiceOnlyOrderFiles, invoiceOnlyRules } from "@db/schema";
import { authedQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { userHasPermission } from "./lib/permissions";

const ruleFields = z.object({
  ruleName: z.string().trim().min(1, "规则名称不能为空").max(200),
  dateField: z.string().trim().max(100),
  timeField: z.string().trim().min(1, "时间字段不能为空").max(100),
  incomeField: z.string().trim().min(1, "收入字段不能为空").max(100),
  orderNoField: z.string().trim().min(1, "订单号字段不能为空").max(100),
  invoiceOtherOrderNo1Field: z.string().trim().max(100).nullable().optional(),
  invoiceOtherOrderNo2Field: z.string().trim().max(100).nullable().optional(),
  descriptionField: z.string().trim().min(1, "订单描述字段不能为空").max(100),
});

type RuleFields = z.infer<typeof ruleFields>;

function cleanOptional(value?: string | null) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeRuleFields(input: RuleFields) {
  const normalized = {
    ruleName: input.ruleName.trim(),
    dateField: input.dateField.trim(),
    timeField: input.timeField.trim(),
    incomeField: input.incomeField.trim(),
    orderNoField: input.orderNoField.trim(),
    invoiceOtherOrderNo1Field: cleanOptional(input.invoiceOtherOrderNo1Field),
    invoiceOtherOrderNo2Field: cleanOptional(input.invoiceOtherOrderNo2Field),
    descriptionField: input.descriptionField.trim(),
  };
  if (normalized.dateField && normalized.dateField === normalized.timeField) {
    throw new Error("日期字段和时间字段不能相同");
  }
  const identifierFields = [
    normalized.orderNoField,
    normalized.invoiceOtherOrderNo1Field,
    normalized.invoiceOtherOrderNo2Field,
  ].filter((value): value is string => Boolean(value));
  if (new Set(identifierFields).size !== identifierFields.length) {
    throw new Error("订单号、其他单号1和其他单号2不能选择同一字段");
  }
  return normalized;
}

async function assertUniqueRuleName(ruleName: string, exceptId?: number) {
  const db = getDb();
  const rows = await db
    .select({ id: invoiceOnlyRules.id })
    .from(invoiceOnlyRules)
    .where(eq(invoiceOnlyRules.ruleName, ruleName));
  if (rows.some((row) => Number(row.id) !== Number(exceptId || 0))) {
    throw new Error("不认账明细规则名称已存在");
  }
}

export const invoiceOnlyRuleRouter = createRouter({
  list: authedQuery
    .input(z.object({
      search: z.string().trim().optional(),
      activeOnly: z.boolean().optional().default(false),
      all: z.boolean().optional().default(false),
      page: z.number().int().min(1).optional().default(1),
      pageSize: z.number().int().min(1).max(100).optional().default(20),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const conditions = [];
      if (input?.search) conditions.push(like(invoiceOnlyRules.ruleName, `%${input.search}%`));
      if (input?.activeOnly) conditions.push(eq(invoiceOnlyRules.isActive, true));
      const where = conditions.length ? and(...conditions) : undefined;
      const page = input?.page || 1;
      const pageSize = input?.pageSize || 20;
      const all = input?.all === true;
      const [items, totals] = await Promise.all([
        db.query.invoiceOnlyRules.findMany({
          where,
          with: { creator: true },
          orderBy: desc(invoiceOnlyRules.createdAt),
          limit: all ? undefined : pageSize,
          offset: all ? undefined : (page - 1) * pageSize,
        }),
        db.select({ count: count() }).from(invoiceOnlyRules).where(where),
      ]);
      const total = Number(totals[0]?.count || 0);
      return { items, total, page: all ? 1 : page, pageSize: all ? total : pageSize };
    }),

  stats: authedQuery.query(async () => {
    const db = getDb();
    const [totalRows, activeRows] = await Promise.all([
      db.select({ count: count() }).from(invoiceOnlyRules),
      db.select({ count: count() }).from(invoiceOnlyRules).where(eq(invoiceOnlyRules.isActive, true)),
    ]);
    return {
      total: Number(totalRows[0]?.count || 0),
      active: Number(activeRows[0]?.count || 0),
    };
  }),

  create: authedQuery
    .input(ruleFields)
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const normalized = normalizeRuleFields(input);
      await assertUniqueRuleName(normalized.ruleName);
      const [result] = await db.insert(invoiceOnlyRules).values({
        ...normalized,
        creatorId: Number(ctx.user.id),
        isActive: true,
      });
      return { id: Number(result.insertId) };
    }),

  update: authedQuery
    .input(ruleFields.extend({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const normalized = normalizeRuleFields(input);
      const [existing] = await db
        .select({ id: invoiceOnlyRules.id })
        .from(invoiceOnlyRules)
        .where(eq(invoiceOnlyRules.id, input.id));
      if (!existing) throw new Error("不认账明细规则不存在");
      await assertUniqueRuleName(normalized.ruleName, input.id);
      await db.update(invoiceOnlyRules)
        .set({ ...normalized, updatedAt: new Date() })
        .where(eq(invoiceOnlyRules.id, input.id));
      return { success: true };
    }),

  toggleActive: authedQuery
    .input(z.object({ id: z.number().int().positive(), isActive: z.boolean() }))
    .mutation(async ({ input }) => {
      await getDb().update(invoiceOnlyRules)
        .set({ isActive: input.isActive, updatedAt: new Date() })
        .where(eq(invoiceOnlyRules.id, input.id));
      return { success: true };
    }),

  delete: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "recognition_rule_delete"))) throw new Error("权限不足");
      const db = getDb();
      const [used] = await db
        .select({ id: invoiceOnlyOrderFiles.id })
        .from(invoiceOnlyOrderFiles)
        .where(eq(invoiceOnlyOrderFiles.ruleId, input.id))
        .limit(1);
      if (used) throw new Error("该规则已有上传订单明细，不能删除，可以停用");
      await db.delete(invoiceOnlyRules).where(eq(invoiceOnlyRules.id, input.id));
      return { success: true };
    }),
});
