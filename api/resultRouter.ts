import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { matchResults, recognitionTasks, voucherReceiptChannels, voucherResultLines } from "@db/schema";
import { eq, desc, and, gte, lte, sql, count, inArray } from "drizzle-orm";
import { userHasPermission } from "./lib/permissions";
import { normalizeProjectCenters } from "./lib/projectCenter";
import {
  buildRecognitionResultAttributeUpdate,
  recognitionResultAttributesInput,
} from "./lib/recognitionResultAttributes";

const resultIncomeTypeValues = [
  "捐赠收入",
  "会费收入",
  "政府补助",
  "个税返还",
  "本金",
  "投资收益",
  "利息",
  "其他收入",
  "其他",
  "订单退款",
] as const;

async function getDateTaskIdsByTaskId(taskId: number) {
  const db = getDb();
  const [task] = await db
    .select({ billDate: recognitionTasks.billDate })
    .from(recognitionTasks)
    .where(eq(recognitionTasks.id, taskId));
  if (!task) return [];
  const rows = await db
    .select({ id: recognitionTasks.id })
    .from(recognitionTasks)
    .where(eq(recognitionTasks.billDate, task.billDate));
  return rows.map((row) => row.id);
}

const resultFilterSchema = z.object({
  taskId: z.number().optional(),
  budgetCode: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  incomeType: z.enum(resultIncomeTypeValues).optional(),
});

type ResultFilterInput = z.infer<typeof resultFilterSchema>;
const resultSummarySchema = z.object({
  year: z.string().regex(/^\d{4}$/),
  incomeDept: z.string().optional(),
  dimension: z.enum(["budgetCode", "expenseFundSource"]),
});

async function buildResultWhereClause(input?: ResultFilterInput) {
  const conditions = [];

  if (input?.taskId) {
    const taskIds = await getDateTaskIdsByTaskId(input.taskId);
    if (taskIds.length === 0) return { whereClause: undefined, empty: true };
    conditions.push(inArray(matchResults.taskId, taskIds));
  }
  if (input?.budgetCode) {
    conditions.push(sql`${matchResults.budgetCode} LIKE ${`%${input.budgetCode}%`}`);
  }
  if (input?.startDate) {
    conditions.push(gte(matchResults.entryTime, input.startDate));
  }
  if (input?.endDate) {
    conditions.push(lte(matchResults.entryTime, input.endDate));
  }
  if (input?.incomeType) {
    conditions.push(eq(matchResults.incomeType, input.incomeType));
  }

  return {
    whereClause: conditions.length > 0 ? and(...conditions) : undefined,
    empty: false,
  };
}

function buildSnapshotBankFlow(item: typeof matchResults.$inferSelect) {
  if (
    !item.bankFlowId &&
    !item.bankReferenceNo &&
    !item.bankTransactionTime &&
    !item.bankIncome &&
    !item.bankCounterpartyAccount &&
    !item.bankCounterpartyName &&
    !item.bankCounterpartyBank &&
    !item.bankSummary &&
    !item.bankPurpose &&
    !item.bankPostScript
  ) {
    return null;
  }

  return {
    id: item.bankFlowId,
    referenceNo: item.bankReferenceNo,
    transactionTime: item.bankTransactionTime,
    income: item.bankIncome,
    counterpartyAccount: item.bankCounterpartyAccount,
    counterpartyName: item.bankCounterpartyName,
    counterpartyBank: item.bankCounterpartyBank,
    summary: item.bankSummary,
    purpose: item.bankPurpose,
    postScript: item.bankPostScript,
  };
}

const updateResultLockStatusProcedure = authedQuery
  .input(z.object({
    id: z.number(),
    locked: z.boolean(),
  }))
  .mutation(async ({ ctx, input }) => {
    if (!(await userHasPermission(ctx.user, "voucher_create"))) throw new Error("权限不足");
    const db = getDb();
    if (!input.locked) {
      const [voucherLine] = await db
        .select({ id: voucherResultLines.id })
        .from(voucherResultLines)
        .where(eq(voucherResultLines.matchResultId, input.id))
        .limit(1);
      if (voucherLine) throw new Error("该入账明细已生成凭证，无法取消锁定");
    }
    await db
      .update(matchResults)
      .set({ voucherStatus: input.locked ? "created" : "pending" })
      .where(eq(matchResults.id, input.id));
    return { success: true };
  });

const getRecognitionAttributeEditProcedure = authedQuery
  .input(z.object({
    id: z.number().int().positive(),
  }))
  .query(async ({ ctx, input }) => {
    if (!(await userHasPermission(ctx.user, "recognition_result_edit"))) throw new Error("权限不足");
    const db = getDb();
    const [result] = await db
      .select()
      .from(matchResults)
      .where(eq(matchResults.id, input.id));
    if (!result) throw new Error("入账结果不存在或已删除");

    const [voucherLine] = await db
      .select({ id: voucherResultLines.id })
      .from(voucherResultLines)
      .where(eq(voucherResultLines.matchResultId, input.id))
      .limit(1);

    return {
      ...result,
      hasVoucherLine: Boolean(voucherLine),
      bankFlow: buildSnapshotBankFlow(result),
    };
  });

const updateRecognitionAttributesProcedure = authedQuery
  .input(recognitionResultAttributesInput.extend({
    id: z.number().int().positive(),
  }))
  .mutation(async ({ ctx, input }) => {
    if (!(await userHasPermission(ctx.user, "recognition_result_edit"))) throw new Error("权限不足");
    const db = getDb();

    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM match_results WHERE id = ${input.id} FOR UPDATE`);
      const [result] = await tx
        .select()
        .from(matchResults)
        .where(eq(matchResults.id, input.id));
      if (!result) throw new Error("入账结果不存在或已删除");

      const [voucherLine] = await tx
        .select({ id: voucherResultLines.id })
        .from(voucherResultLines)
        .where(eq(voucherResultLines.matchResultId, input.id))
        .limit(1);
      if (voucherLine) throw new Error("该入账结果已生成凭证，请先取消凭证后再修改");
      if (result.voucherStatus === "created") {
        throw new Error("该入账结果已锁定，请先取消锁定后再修改");
      }

      const normalizedProjectCenters = await normalizeProjectCenters(tx, [input]);
      const voucherReceiptChannelCode = String(input.voucherReceiptChannelCode || "").trim();
      if (voucherReceiptChannelCode) {
        const [channel] = await tx
          .select({ id: voucherReceiptChannels.id })
          .from(voucherReceiptChannels)
          .where(eq(voucherReceiptChannels.channelCode, voucherReceiptChannelCode));
        if (!channel) throw new Error("收款渠道不存在或已删除");
      }

      const update = buildRecognitionResultAttributeUpdate({
        attributes: input,
        splitAmount: result.splitAmount,
        normalizedProjectCenter: normalizedProjectCenters[0],
        normalizedVoucherReceiptChannelCode: voucherReceiptChannelCode || null,
        bankCounterpartyName: result.bankCounterpartyName,
      });
      await tx
        .update(matchResults)
        .set(update)
        .where(and(
          eq(matchResults.id, input.id),
          eq(matchResults.voucherStatus, "pending"),
        ));

      return { success: true };
    });
  });

const lockDayResultsProcedure = authedQuery
  .input(z.object({
    entryTime: z.string().min(1),
  }))
  .mutation(async ({ ctx, input }) => {
    if (!(await userHasPermission(ctx.user, "voucher_create"))) throw new Error("权限不足");
    const db = getDb();
    const unlockedWhereClause = and(
      eq(matchResults.entryTime, input.entryTime),
      eq(matchResults.voucherStatus, "pending"),
    );
    const [unlockedResult] = await db
      .select({ count: count() })
      .from(matchResults)
      .where(unlockedWhereClause);
    const unlockedCount = Number(unlockedResult?.count || 0);

    if (unlockedCount > 0) {
      await db
        .update(matchResults)
        .set({ voucherStatus: "created" })
        .where(unlockedWhereClause);
    }

    return { updatedCount: unlockedCount };
  });

const unlockDayResultsProcedure = authedQuery
  .input(z.object({
    entryTime: z.string().min(1),
  }))
  .mutation(async ({ ctx, input }) => {
    if (!(await userHasPermission(ctx.user, "voucher_create"))) throw new Error("权限不足");
    const db = getDb();
    const lockedWhereClause = and(
      eq(matchResults.entryTime, input.entryTime),
      eq(matchResults.voucherStatus, "created"),
    );
    const [lockedResult] = await db
      .select({ count: count() })
      .from(matchResults)
      .where(lockedWhereClause);
    const lockedCount = Number(lockedResult?.count || 0);

    if (lockedCount > 0) {
      await db
        .update(matchResults)
        .set({ voucherStatus: "pending" })
        .where(lockedWhereClause);
    }

    return { updatedCount: lockedCount };
  });

export const resultRouter = createRouter({
  summary: authedQuery
    .input(resultSummarySchema)
    .query(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "result_summary_menu_access"))) throw new Error("权限不足");
      const db = getDb();
      const startDate = `${input.year}-01-01`;
      const endDate = `${input.year}-12-31`;
      const conditions = [
        gte(matchResults.entryTime, startDate),
        lte(matchResults.entryTime, endDate),
      ];
      if (input.incomeDept) {
        conditions.push(eq(matchResults.incomeDept, input.incomeDept));
      }

      const dimensionColumn = input.dimension === "budgetCode"
        ? matchResults.budgetCode
        : matchResults.expenseFundSource;
      const dimensionExpr = sql<string>`COALESCE(NULLIF(${dimensionColumn}, ''), '未填写')`;

      const items = await db
        .select({
          dimensionValue: dimensionExpr,
          resultCount: count(),
          totalAmount: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
          projectFundAmount: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2)) - CAST(${matchResults.managementFeeAmount} AS DECIMAL(18,2))), 0.00)`,
          managementFeeAmount: sql<string>`COALESCE(SUM(CAST(${matchResults.managementFeeAmount} AS DECIMAL(18,2))), 0.00)`,
        })
        .from(matchResults)
        .where(and(...conditions))
        .groupBy(dimensionExpr)
        .orderBy(sql`SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))) DESC`);

      const [total] = await db
        .select({
          resultCount: count(),
          totalAmount: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
          projectFundAmount: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2)) - CAST(${matchResults.managementFeeAmount} AS DECIMAL(18,2))), 0.00)`,
          managementFeeAmount: sql<string>`COALESCE(SUM(CAST(${matchResults.managementFeeAmount} AS DECIMAL(18,2))), 0.00)`,
        })
        .from(matchResults)
        .where(and(...conditions));

      return {
        items: items.map((item) => ({
          dimensionValue: item.dimensionValue,
          resultCount: Number(item.resultCount || 0),
          totalAmount: Number(item.totalAmount || 0),
          projectFundAmount: Number(item.projectFundAmount || 0),
          managementFeeAmount: Number(item.managementFeeAmount || 0),
        })),
        total: {
          resultCount: Number(total?.resultCount || 0),
          totalAmount: Number(total?.totalAmount || 0),
          projectFundAmount: Number(total?.projectFundAmount || 0),
          managementFeeAmount: Number(total?.managementFeeAmount || 0),
        },
      };
    }),

  dayGroups: authedQuery
    .input(resultFilterSchema.extend({
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(20),
    }).optional())
    .query(async ({ input }) => {
      const db = getDb();
      const { whereClause, empty } = await buildResultWhereClause(input);
      const page = input?.page || 1;
      const pageSize = input?.pageSize || 20;

      if (empty) {
        return { items: [], total: 0, page, pageSize };
      }

      const items = await db
        .select({
          entryTime: matchResults.entryTime,
          totalAmount: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
          totalCount: count(),
          createdCount: sql<number>`SUM(CASE WHEN ${matchResults.voucherStatus} = 'created' THEN 1 ELSE 0 END)`,
          pendingCount: sql<number>`SUM(CASE WHEN ${matchResults.voucherStatus} = 'pending' THEN 1 ELSE 0 END)`,
        })
        .from(matchResults)
        .where(whereClause)
        .groupBy(matchResults.entryTime)
        .orderBy(desc(matchResults.entryTime))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const totalResult = await db
        .select({ count: sql<number>`COUNT(DISTINCT ${matchResults.entryTime})` })
        .from(matchResults)
        .where(whereClause);

      return {
        items: items.map((item) => ({
          ...item,
          totalAmount: Number(item.totalAmount || 0),
          totalCount: Number(item.totalCount || 0),
          createdCount: Number(item.createdCount || 0),
          pendingCount: Number(item.pendingCount || 0),
        })),
        total: Number(totalResult[0]?.count || 0),
        page,
        pageSize,
      };
    }),

  list: authedQuery
    .input(
      resultFilterSchema.extend({
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(20,
        ),
      }).optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const { whereClause, empty } = await buildResultWhereClause(input);
      if (empty) {
        return { items: [], total: 0, page: input?.page || 1, pageSize: input?.pageSize || 20 };
      }

      const items = await db.query.matchResults.findMany({
        where: whereClause,
        orderBy: desc(matchResults.entryTime),
        limit: input?.pageSize || 20,
        offset: ((input?.page || 1) - 1) * (input?.pageSize || 20),
      });
      const itemIds = items.map((item) => Number(item.id)).filter(Boolean);
      const voucherLineRows = itemIds.length > 0
        ? await db
          .select({ matchResultId: voucherResultLines.matchResultId })
          .from(voucherResultLines)
          .where(inArray(voucherResultLines.matchResultId, itemIds))
        : [];
      const voucherLineResultIds = new Set(voucherLineRows.map((row) => Number(row.matchResultId || 0)).filter(Boolean));

      const itemsWithFlows = items.map((item) => {
        return {
          ...item,
          hasVoucherLine: voucherLineResultIds.has(Number(item.id)),
          platformProjectDisplayName: item.platformProjectDisplayName || item.platformProjectName,
          bankFlow: buildSnapshotBankFlow(item),
        };
      });

      const countResult = await db
        .select({ count: count() })
        .from(matchResults)
        .where(whereClause);

      return {
        items: itemsWithFlows,
        total: Number(countResult[0]?.count || 0),
        page: input?.page || 1,
        pageSize: input?.pageSize || 20,
      };
    }),

  updateResultLockStatus: updateResultLockStatusProcedure,
  getRecognitionAttributeEdit: getRecognitionAttributeEditProcedure,
  updateRecognitionAttributes: updateRecognitionAttributesProcedure,
  updateVoucherStatus: authedQuery
    .input(z.object({
      id: z.number(),
      voucherStatus: z.enum(["pending", "created"]),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "voucher_create"))) throw new Error("权限不足");
      const db = getDb();
      await db
        .update(matchResults)
        .set({ voucherStatus: input.voucherStatus })
        .where(eq(matchResults.id, input.id));
      return { success: true };
    }),

  lockDayResults: lockDayResultsProcedure,
  unlockDayResults: unlockDayResultsProcedure,
  createDayVouchers: lockDayResultsProcedure,
  cancelDayVouchers: unlockDayResultsProcedure,

  stats: authedQuery.query(async () => {
    const db = getDb();
    const today = new Date().toISOString().split("T")[0];
    const [result] = await db
      .select({
        totalAmount: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
        todayAmount: sql<string>`COALESCE(SUM(CASE WHEN ${matchResults.entryTime} = ${today} THEN CAST(${matchResults.splitAmount} AS DECIMAL(18,2)) ELSE 0 END), 0.00)`,
        totalCount: count(),
      })
      .from(matchResults);

    return {
      totalAmount: Number(result?.totalAmount || 0),
      todayAmount: Number(result?.todayAmount || 0),
      totalCount: Number(result?.totalCount || 0),
    };
  }),
});
