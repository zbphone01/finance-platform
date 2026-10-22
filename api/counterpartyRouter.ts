import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { counterpartyMatchAccounts, counterpartyRecords, bankFlows, incomeRecognitionRules, recognitionRules, unrecordedCounterparties, voucherReceiptChannels } from "@db/schema";
import { eq, and, count, desc, inArray, asc, sql } from "drizzle-orm";

import { runDailyDedup } from "./lib/counterpartySync";
import { userHasPermission } from "./lib/permissions";

const counterpartyRecognitionTypeValues = ["到账认账", "明细认账"] as const;
const detailPackageTypeValues = ["T+1", "打包明细"] as const;
const detailMatchingModeValues = ["单笔匹配", "同日汇总匹配", "多日汇总匹配"] as const;
const arrivalRegionValues = ["北京市", "外省市", "港澳台", "境外", "内部客商"] as const;
const bankNameValues = ["广发银行", "工商银行", "中国银行"] as const;

const matchAccountInput = z.object({
  bankName: z.enum(bankNameValues).nullable().optional(),
  accountNo: z.string().max(100, "对方账号最长100字"),
  accountName: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  purpose: z.string().nullable().optional(),
  postScript: z.string().nullable().optional(),
}).refine(
  (item) => [item.bankName, item.accountNo, item.accountName, item.summary, item.purpose, item.postScript]
    .some((value) => String(value || "").trim()),
  { message: "每组匹配条件至少填写银行、对方账号、对方户名、摘要、用途或附言中的一项" },
);

const voucherReceiptChannelInput = z.object({
  channelCode: z.string().trim().min(1, "收款渠道编号不能为空").max(100, "收款渠道编号最长100字"),
  channelName: z.string().trim().min(1, "收款渠道名称不能为空").max(200, "收款渠道名称最长200字"),
});

type MatchAccountLike = {
  bankName?: string | null;
  accountNo: string;
  accountName?: string | null;
  summary?: string | null;
  purpose?: string | null;
  postScript?: string | null;
};

function cleanMatcher(item: MatchAccountLike, sortOrder = 0) {
  return {
    bankName: item.bankName?.trim() || null,
    accountNo: item.accountNo.trim(),
    accountName: item.accountName?.trim() || "",
    summary: item.summary?.trim() || "",
    purpose: item.purpose?.trim() || "",
    postScript: item.postScript?.trim() || "",
    sortOrder,
  };
}

function hasMatcherCondition(item: ReturnType<typeof cleanMatcher>) {
  return [item.bankName, item.accountNo, item.accountName, item.summary, item.purpose, item.postScript]
    .some((value) => Boolean(value));
}

function dedupeMatchers(items: MatchAccountLike[]) {
  const seen = new Set<string>();
  const result: ReturnType<typeof cleanMatcher>[] = [];
  for (const item of items) {
    const cleaned = cleanMatcher(item, result.length);
    if (!hasMatcherCondition(cleaned)) continue;
    const key = `${cleaned.bankName || ""}|${cleaned.accountNo}|${cleaned.accountName}|${cleaned.summary}|${cleaned.purpose}|${cleaned.postScript}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

async function replaceMatchAccounts(db: any, recordId: number, matchAccounts: ReturnType<typeof cleanMatcher>[]) {
  await db.delete(counterpartyMatchAccounts).where(eq(counterpartyMatchAccounts.counterpartyRecordId, recordId));
  if (matchAccounts.length === 0) return;
  await db.insert(counterpartyMatchAccounts).values(matchAccounts.map((item) => ({
    counterpartyRecordId: recordId,
    bankName: item.bankName,
    accountNo: item.accountNo,
    accountName: item.accountName,
    summary: item.summary,
    purpose: item.purpose,
    postScript: item.postScript,
    sortOrder: item.sortOrder,
    isActive: 1,
  })));
}

async function validateVoucherReceiptChannelCode(db: any, value?: string | null) {
  const channelCode = String(value || "").trim();
  if (!channelCode) return null;
  const rows = await db.select({ id: voucherReceiptChannels.id })
    .from(voucherReceiptChannels)
    .where(eq(voucherReceiptChannels.channelCode, channelCode));
  if (rows.length === 0) throw new Error("凭证收款渠道不存在，请重新选择");
  return channelCode;
}

export const counterpartyRouter = createRouter({
  // 已记录列表
  listRecorded: authedQuery
    .input(
      z.object({
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(500).default(100),
        recognitionType: z.enum(counterpartyRecognitionTypeValues).optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const page = input?.page || 1;
      const pageSize = input?.pageSize || 100;
      const offset = (page - 1) * pageSize;
      const whereClause = input?.recognitionType
        ? eq(counterpartyRecords.recognitionType, input.recognitionType)
        : undefined;

      const [baseItems, totalResult] = await Promise.all([
        db.select().from(counterpartyRecords)
          .where(whereClause)
          .orderBy(desc(counterpartyRecords.createdAt))
          .limit(pageSize).offset(offset),
        db.select({ count: count() }).from(counterpartyRecords).where(whereClause),
      ]);

      const ids = baseItems.map((item) => Number(item.id));
      const matchRows = ids.length > 0
        ? await db.select().from(counterpartyMatchAccounts)
          .where(inArray(counterpartyMatchAccounts.counterpartyRecordId, ids))
          .orderBy(counterpartyMatchAccounts.sortOrder, counterpartyMatchAccounts.id)
        : [];
      const matchAccountsByRecordId = new Map<number, typeof matchRows>();
      for (const row of matchRows) {
        const key = Number(row.counterpartyRecordId);
        const list = matchAccountsByRecordId.get(key) || [];
        list.push(row);
        matchAccountsByRecordId.set(key, list);
      }

      return {
        items: baseItems.map((item) => ({
          ...item,
          matchAccounts: matchAccountsByRecordId.get(Number(item.id)) || [],
          voucherIncomeName: item.voucherIncomeName || "",
        })),
        total: totalResult[0]?.count || 0,
      };
    }),

  // 未记录列表：直接读取静态表 unrecorded_counterparties
  listUnrecorded: authedQuery
    .input(
      z.object({
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(500).default(100),
      }).optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const page = input?.page || 1;
      const pageSize = input?.pageSize || 100;
      const offset = (page - 1) * pageSize;

      const [items, totalResult] = await Promise.all([
        db.select().from(unrecordedCounterparties)
          .orderBy(desc(unrecordedCounterparties.lastSeenAt))
          .limit(pageSize).offset(offset),
        db.select({ count: count() }).from(unrecordedCounterparties),
      ]);

      return {
        items,
        total: Number(totalResult[0]?.count || 0),
      };
    }),

  // 记录操作：将对方信息记入已记录列表
  record: authedQuery
    .input(
      z.object({
        alias: z.string().min(1, "到账别称不能为空").max(200, "到账别称最长200字"),
        matchAccounts: z.array(matchAccountInput).min(1, "至少需要一组有效匹配条件"),
        detailMatchingMode: z.enum(detailMatchingModeValues).default("单笔匹配"),
        arrivalRegion: z.enum(arrivalRegionValues).nullable().optional(),
        recognitionType: z.enum(counterpartyRecognitionTypeValues).default("到账认账"),
        detailPackageType: z.enum(detailPackageTypeValues).default("T+1"),
        voucherIncomeName: z.string().max(100, "凭证收款渠道编号最长100字").nullable().optional(),
        unrecordedId: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const matchAccounts = dedupeMatchers(input.matchAccounts);
      if (matchAccounts.length === 0) throw new Error("至少需要一组有效匹配条件");
      const primary = matchAccounts[0];

      // 检查到账别称是否已存在
      const aliasExists = await db.select().from(counterpartyRecords)
        .where(eq(counterpartyRecords.alias, input.alias.trim()));
      if (aliasExists.length > 0) {
        throw new Error("到账别称已存在，请更换其他名称");
      }
      const voucherReceiptChannelCode = await validateVoucherReceiptChannelCode(db, input.voucherIncomeName);
      const detailPackageType = input.recognitionType === "明细认账" && input.detailMatchingMode === "多日汇总匹配"
        ? "打包明细"
        : input.recognitionType === "明细认账" ? input.detailPackageType : "T+1";

      await db.transaction(async (tx) => {
        const inserted = await tx.insert(counterpartyRecords).values({
          alias: input.alias.trim(),
          detailMatchingMode: input.recognitionType === "明细认账" ? input.detailMatchingMode : "单笔匹配",
          arrivalRegion: input.arrivalRegion || null,
          recognitionType: input.recognitionType,
          detailPackageType,
          voucherIncomeName: voucherReceiptChannelCode,
        }).$returningId();
        const recordId = Number(inserted[0]?.id);
        if (!recordId) throw new Error("创建到账信息失败");
        await replaceMatchAccounts(tx, recordId, matchAccounts);

        // 从静态未记录表中删除对应条目
        if (input.unrecordedId) {
          await tx.delete(unrecordedCounterparties).where(eq(unrecordedCounterparties.id, input.unrecordedId));
        } else {
          await tx.delete(unrecordedCounterparties).where(and(
            sql`${unrecordedCounterparties.bankName} <=> ${primary.bankName}`,
            eq(unrecordedCounterparties.accountNo, primary.accountNo),
            eq(unrecordedCounterparties.accountName, primary.accountName),
            eq(unrecordedCounterparties.summary, primary.summary),
            eq(unrecordedCounterparties.purpose, primary.purpose),
            eq(unrecordedCounterparties.postScript, primary.postScript),
          ));
        }
      });

      return { success: true };
    }),

  // 编辑已记录条目
  update: authedQuery
    .input(
      z.object({
        id: z.number(),
        alias: z.string().min(1, "到账别称不能为空").max(200, "到账别称最长200字"),
        recognitionType: z.enum(counterpartyRecognitionTypeValues),
        detailMatchingMode: z.enum(detailMatchingModeValues).default("单笔匹配"),
        arrivalRegion: z.enum(arrivalRegionValues).nullable().optional(),
        detailPackageType: z.enum(detailPackageTypeValues).default("T+1"),
        matchAccounts: z.array(matchAccountInput).min(1, "至少需要一组有效匹配条件"),
        voucherIncomeName: z.string().max(100, "凭证收款渠道编号最长100字").nullable().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const alias = input.alias.trim();
      const [current] = await db.select().from(counterpartyRecords)
        .where(eq(counterpartyRecords.id, input.id));
      if (!current) throw new Error("记录不存在");

      const matchAccounts = dedupeMatchers(input.matchAccounts);
      if (matchAccounts.length === 0) throw new Error("至少需要一组有效匹配条件");
      const primary = matchAccounts[0];

      const aliasExists = await db.select().from(counterpartyRecords)
        .where(eq(counterpartyRecords.alias, alias));
      if (aliasExists.some((item) => item.id !== input.id)) {
        throw new Error("到账别称已存在，请更换其他名称");
      }

      const linkedRules = await db.select({ id: recognitionRules.id }).from(recognitionRules)
        .where(eq(recognitionRules.matchedCounterpartyAlias, current.alias));
      const linkedIncomeRules = await db.select({ id: incomeRecognitionRules.id }).from(incomeRecognitionRules)
        .where(eq(incomeRecognitionRules.matchedCounterpartyAlias, current.alias));
      if (linkedRules.length > 0 && input.recognitionType !== "明细认账") {
        throw new Error("该到账信息已被明细认账规则使用，不能修改为到账认账");
      }
      if (linkedIncomeRules.length > 0 && input.recognitionType !== "到账认账") {
        throw new Error("该到账信息已被到账认账规则使用，不能修改为明细认账");
      }
      const voucherReceiptChannelCode = await validateVoucherReceiptChannelCode(db, input.voucherIncomeName);
      const detailPackageType = input.recognitionType === "明细认账" && input.detailMatchingMode === "多日汇总匹配"
        ? "打包明细"
        : input.recognitionType === "明细认账" ? input.detailPackageType : "T+1";

      await db.transaction(async (tx) => {
        await tx.update(counterpartyRecords).set({
          alias,
          detailMatchingMode: input.recognitionType === "明细认账" ? input.detailMatchingMode : "单笔匹配",
          arrivalRegion: input.arrivalRegion || null,
          recognitionType: input.recognitionType,
          detailPackageType,
          voucherIncomeName: voucherReceiptChannelCode,
        }).where(eq(counterpartyRecords.id, input.id));
        await replaceMatchAccounts(tx, input.id, matchAccounts);

        if (alias !== current.alias && linkedRules.length > 0) {
          await tx.update(recognitionRules).set({
            matchedCounterpartyAlias: alias,
            updatedAt: new Date(),
          }).where(eq(recognitionRules.matchedCounterpartyAlias, current.alias));
        }
        if (linkedIncomeRules.length > 0) {
          await tx.update(incomeRecognitionRules).set({
            matchedCounterpartyAlias: alias,
            accountName: primary.accountName || null,
            purpose: primary.purpose || null,
            postScript: primary.postScript || null,
            updatedAt: new Date(),
          }).where(eq(incomeRecognitionRules.matchedCounterpartyAlias, current.alias));
        }
      });

      return { success: true };
    }),

  // 批量记录：一次性记录多条
  batchRecord: authedQuery
    .input(
      z.array(z.object({
        alias: z.string().min(1, "到账别称不能为空").max(200),
        matchAccounts: z.array(matchAccountInput).min(1, "至少需要一组有效匹配条件"),
        detailMatchingMode: z.enum(detailMatchingModeValues).default("单笔匹配"),
        arrivalRegion: z.enum(arrivalRegionValues).nullable().optional(),
        recognitionType: z.enum(counterpartyRecognitionTypeValues).default("到账认账"),
        detailPackageType: z.enum(detailPackageTypeValues).default("T+1"),
      }))
    )
    .mutation(async ({ input }) => {
      const db = getDb();

      await db.transaction(async (tx) => {
      for (const item of input) {
        // 检查到账别称是否已存在
        const aliasExists = await tx.select().from(counterpartyRecords)
          .where(eq(counterpartyRecords.alias, item.alias));
        if (aliasExists.length > 0) {
          continue; // 跳过，不报错
        }

        const matchAccounts = dedupeMatchers(item.matchAccounts);
        if (matchAccounts.length === 0) throw new Error("至少需要一组有效匹配条件");
        const primary = matchAccounts[0];
        const inserted = await tx.insert(counterpartyRecords).values({
          alias: item.alias,
          detailMatchingMode: item.recognitionType === "明细认账" ? item.detailMatchingMode : "单笔匹配",
          arrivalRegion: item.arrivalRegion || null,
          recognitionType: item.recognitionType,
          detailPackageType: item.recognitionType === "明细认账" && item.detailMatchingMode === "多日汇总匹配"
            ? "打包明细"
            : item.recognitionType === "明细认账" ? item.detailPackageType : "T+1",
        }).$returningId();
        const recordId = Number(inserted[0]?.id);
        if (recordId) await replaceMatchAccounts(tx, recordId, matchAccounts);

        // 从静态未记录表中删除对应条目
        await tx.delete(unrecordedCounterparties).where(and(
          sql`${unrecordedCounterparties.bankName} <=> ${primary.bankName}`,
          eq(unrecordedCounterparties.accountNo, primary.accountNo),
          eq(unrecordedCounterparties.accountName, primary.accountName),
          eq(unrecordedCounterparties.summary, primary.summary),
          eq(unrecordedCounterparties.purpose, primary.purpose),
          eq(unrecordedCounterparties.postScript, primary.postScript),
        ));
      }
      });

      return { success: true, count: input.length };
    }),

  // 删除已记录条目
  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "arrival_info_delete"))) throw new Error("权限不足");
      const db = getDb();
      await db.delete(counterpartyMatchAccounts).where(eq(counterpartyMatchAccounts.counterpartyRecordId, input.id));
      await db.delete(counterpartyRecords).where(eq(counterpartyRecords.id, input.id));
      return { success: true };
    }),

  // 定时滤重：扫描 bank_flows 补充新未记录条目，清理已记录的条目，合并重复
  dailyDedup: authedQuery
    .mutation(async () => {
      const result = await runDailyDedup();
      return { success: true, ...result };
    }),

  // 凭证收款渠道：列表
  listVoucherReceiptChannels: authedQuery
    .query(async ({ ctx }) => {
      const canReadVoucherReceiptChannels =
        await userHasPermission(ctx.user, "financial_voucher_info_menu_access")
        || await userHasPermission(ctx.user, "recognition_result_edit");
      if (!canReadVoucherReceiptChannels) throw new Error("权限不足");
      const db = getDb();
      const items = await db.select().from(voucherReceiptChannels)
        .orderBy(
          asc(sql<number>`CAST(SUBSTRING_INDEX(${voucherReceiptChannels.channelCode}, '.', 1) AS UNSIGNED)`),
          asc(sql<number>`CAST(SUBSTRING_INDEX(${voucherReceiptChannels.channelCode}, '.', -1) AS UNSIGNED)`),
          asc(voucherReceiptChannels.channelCode),
        );
      return { items, total: items.length };
    }),

  // 凭证收款渠道：新增
  createVoucherReceiptChannel: authedQuery
    .input(voucherReceiptChannelInput)
    .mutation(async ({ input, ctx }) => {
      if (!(await userHasPermission(ctx.user, "financial_voucher_info_menu_access"))) throw new Error("权限不足");
      const db = getDb();
      const channelCode = input.channelCode.trim();
      const channelName = input.channelName.trim();
      const exists = await db.select({ id: voucherReceiptChannels.id }).from(voucherReceiptChannels)
        .where(eq(voucherReceiptChannels.channelCode, channelCode));
      if (exists.length > 0) throw new Error("收款渠道编号已存在");

      await db.insert(voucherReceiptChannels).values({ channelCode, channelName });
      return { success: true };
    }),

  // 凭证收款渠道：编辑
  updateVoucherReceiptChannel: authedQuery
    .input(voucherReceiptChannelInput.extend({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (!(await userHasPermission(ctx.user, "financial_voucher_info_menu_access"))) throw new Error("权限不足");
      const db = getDb();
      const channelCode = input.channelCode.trim();
      const channelName = input.channelName.trim();
      const [current] = await db.select().from(voucherReceiptChannels)
        .where(eq(voucherReceiptChannels.id, input.id));
      if (!current) throw new Error("收款渠道不存在");

      const exists = await db.select({ id: voucherReceiptChannels.id }).from(voucherReceiptChannels)
        .where(eq(voucherReceiptChannels.channelCode, channelCode));
      if (exists.some((item) => Number(item.id) !== input.id)) throw new Error("收款渠道编号已存在");

      await db.update(voucherReceiptChannels).set({ channelCode, channelName })
        .where(eq(voucherReceiptChannels.id, input.id));
      return { success: true };
    }),

  // 凭证收款渠道：删除
  deleteVoucherReceiptChannel: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (!(await userHasPermission(ctx.user, "financial_voucher_info_menu_access"))) throw new Error("权限不足");
      const db = getDb();
      await db.delete(voucherReceiptChannels).where(eq(voucherReceiptChannels.id, input.id));
      return { success: true };
    }),

  // 统计
  stats: authedQuery.query(async () => {
    const db = getDb();
    const [recorded, unrecorded, totalFlows] = await Promise.all([
      db.select({ count: count() }).from(counterpartyRecords),
      db.select({ count: count() }).from(unrecordedCounterparties),
      db.select({ count: count() }).from(bankFlows),
    ]);
    return {
      recordedCount: recorded[0]?.count || 0,
      unrecordedCount: unrecorded[0]?.count || 0,
      totalFlowCount: totalFlows[0]?.count || 0,
    };
  }),
});
