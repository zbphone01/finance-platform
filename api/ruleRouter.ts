import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  counterpartyRecords,
  recognitionRuleExcludeConditions,
  recognitionRules,
  ruleItems,
  ruleItemSplits,
} from "@db/schema";
import { eq, desc, like, and, count } from "drizzle-orm";
import { userHasPermission } from "./lib/permissions";

const incomeTypeValues = ["捐赠收入", "会费收入", "政府补助", "个税返还", "本金", "投资收益", "利息", "其他收入", "其他"] as const;
const fixedDetailIncomeType = "捐赠收入" as const;
const keywordMatchTypeValues = ["等于", "包含"] as const;
const packageRecognitionKeywordField = "__整包认账__";
const packageRecognitionKeyword = "__整包认账__";

const optionalTrimmedString = z.string().trim().optional().nullable();
const defaultDetailSplitRecognitionKeywordField = "商品标题";
const defaultDetailSplitIncomeField = "买家实付金额";
const defaultDetailSplitMatchField = "主订单编号";
const defaultDetailSplitOrderNoField = "子订单编号";

function normalizeManagementFeeRatio(value?: string | null) {
  const parsed = parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : "0";
}

function normalizeSplitRatio(value?: string | null) {
  const parsed = parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : "0";
}

function normalizeKeyword(value?: string | null) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

const detailRuleSplitSchema = z.object({
  splitRatio: z.string().min(1, "分账比例不能为空"),
  incomeType: z.enum(incomeTypeValues).optional().default("捐赠收入"),
  incomeAttr: z.enum(["非限定性收入", "限定性收入"]),
  incomeDept: z.string().min(1, "收入部门不能为空"),
  budgetCode: z.string().min(1, "预算编码不能为空"),
  incomeProject: z.string().min(1, "NC项目名称不能为空"),
  platformProjectName: z.string().min(1, "平台项目名称不能为空"),
  platformProjectDetail: z.string().min(1, "平台项目详情不能为空"),
  managementFeeRatio: z.string().min(1, "管理费比例不能为空"),
  expenseFundSource: z.string().min(1, "支出资金来源不能为空"),
  sortOrder: z.number().optional().default(0),
});

const detailRuleItemSchema = z.object({
  keywordField: z.string().min(1, "关键字字段不能为空"),
  detailKeyword: z.string().min(1, "关键字不能为空"),
  keywordMatchType: z.enum(keywordMatchTypeValues).default("等于"),
  splits: z.array(detailRuleSplitSchema).min(1, "每个条件至少需要一条分账设置"),
});

const excludeOrderConditionSchema = z.object({
  field: z.string().trim().min(1, "识别字段不能为空"),
  matchType: z.enum(keywordMatchTypeValues).default("等于"),
  keyword: z.string().trim().min(1, "字段关键字不能为空"),
});

const detailRuleImportSchema = z.object({
  ruleName: z.string().min(1, "规则名称不能为空"),
  matchedCounterpartyAlias: z.string().min(1, "匹配到账信息不能为空"),
  dateField: z.string().trim().optional().default("时间"),
  incomeField: z.string().min(1).default("金额"),
  orderNoField: z.string().trim().optional().default("订单号"),
  invoiceOtherOrderNo1Field: optionalTrimmedString,
  invoiceOtherOrderNo2Field: optionalTrimmedString,
  conditionRecognitionEnabled: z.boolean().optional().default(true),
  excludeOrderEnabled: z.boolean().optional().default(false),
  excludeConditions: z.array(excludeOrderConditionSchema).optional().default([]),
  excludeOrderField: optionalTrimmedString,
  excludeOrderKeyword: optionalTrimmedString,
  refundOrderEnabled: z.boolean().optional().default(false),
  refundJudgeField: optionalTrimmedString,
  refundJudgeValue: optionalTrimmedString,
  refundDirectionJudgeValue: optionalTrimmedString,
  refundAmountField: optionalTrimmedString,
  detailSplitEnabled: z.boolean().optional(),
  multiSplitKeywordField: optionalTrimmedString,
  multiSplitKeyword: optionalTrimmedString,
  multiSplitMatchField: optionalTrimmedString,
  detailSplitRecognitionKeywordField: z.string().trim().optional().default(defaultDetailSplitRecognitionKeywordField),
  detailSplitIncomeField: z.string().trim().optional().default(defaultDetailSplitIncomeField),
  detailSplitMatchField: z.string().trim().optional().default(defaultDetailSplitMatchField),
  detailSplitOrderNoField: z.string().trim().optional().default(defaultDetailSplitOrderNoField),
  enabledAt: z.coerce.date().optional(),
  isActive: z.boolean().optional().default(true),
  items: z.array(detailRuleItemSchema).min(1, "至少需要一条规则条件"),
});

const detailRuleItemsSchema = z.array(detailRuleItemSchema).min(1, "至少需要一条规则条件");

function validateDetailRuleItems(
  items: Array<{ keywordField: string; detailKeyword: string; splits: Array<{ splitRatio: string }> }>,
  conditionRecognitionEnabled = true,
) {
  const keywordMap = new Map<string, number[]>();

  if (conditionRecognitionEnabled) {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const field = normalizeKeyword(item.keywordField);
      const keyword = normalizeKeyword(item.detailKeyword);
      if (!field || !keyword) continue;
      const key = `${field}|${keyword}`;
      keywordMap.set(key, [...(keywordMap.get(key) || []), i + 1]);
    }
    for (const indexes of keywordMap.values()) {
      if (indexes.length > 1) {
        throw new Error(`条件${indexes.join("、")}的认账关键字字段和关键字相同，不能保存`);
      }
    }
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const totalRatio = item.splits.reduce(
      (sum, s) => sum + Number(normalizeSplitRatio(s.splitRatio)),
      0,
    );
    if (totalRatio !== 100) {
      throw new Error(`条件${i + 1}的分账比例总和必须等于100%，当前为${totalRatio}%`);
    }
  }
}

function normalizeDetailRuleItemsForMode(
  items: z.infer<typeof detailRuleItemsSchema>,
  conditionRecognitionEnabled = true,
) {
  if (conditionRecognitionEnabled) return items;
  const first = items[0];
  return [{
    keywordField: packageRecognitionKeywordField,
    detailKeyword: packageRecognitionKeyword,
    keywordMatchType: "等于" as const,
    splits: first?.splits || [],
  }];
}

function normalizeOptionalText(value?: string | null) {
  const text = String(value ?? "").trim();
  return text || null;
}

function validateMultiSplitConfig(input: {
  detailSplitEnabled?: boolean | null;
  multiSplitKeywordField?: string | null;
  multiSplitKeyword?: string | null;
  multiSplitMatchField?: string | null;
  detailSplitRecognitionKeywordField?: string | null;
  detailSplitIncomeField?: string | null;
  detailSplitMatchField?: string | null;
  detailSplitOrderNoField?: string | null;
}) {
  const values = [
    normalizeOptionalText(input.multiSplitKeywordField),
    normalizeOptionalText(input.multiSplitKeyword),
    normalizeOptionalText(input.multiSplitMatchField),
  ];
  const packageValues = [
    normalizeOptionalText(input.detailSplitRecognitionKeywordField),
    normalizeOptionalText(input.detailSplitIncomeField),
    normalizeOptionalText(input.detailSplitMatchField),
    normalizeOptionalText(input.detailSplitOrderNoField),
  ];
  if (input.detailSplitEnabled && values.some((value) => !value)) {
    throw new Error("开启明细分账后，明细分账判断字段、判断关键字和明细匹配字段均为必填");
  }
  if (input.detailSplitEnabled && packageValues.some((value) => !value)) {
    throw new Error("开启明细分账后，分账包设置中的子订单号字段、认账条件字段、收入字段和明细匹配字段均为必填");
  }
  if (!input.detailSplitEnabled && values.some(Boolean)) {
    throw new Error("请先开启明细分账，再填写明细分账判断字段、判断关键字和明细匹配字段");
  }
}

function normalizeExcludeOrderConditions(input: {
  excludeOrderEnabled?: boolean | null;
  excludeConditions?: Array<{
    field?: string | null;
    matchType?: "等于" | "包含" | null;
    keyword?: string | null;
  }> | null;
  excludeOrderField?: string | null;
  excludeOrderKeyword?: string | null;
}) {
  if (!input.excludeOrderEnabled) return [];
  const configured = (input.excludeConditions || []).map((condition) => ({
    field: normalizeOptionalText(condition.field),
    matchType: condition.matchType === "包含" ? "包含" as const : "等于" as const,
    keyword: normalizeOptionalText(condition.keyword),
  }));
  if (configured.length > 0) return configured;

  const legacyField = normalizeOptionalText(input.excludeOrderField);
  const legacyKeyword = normalizeOptionalText(input.excludeOrderKeyword);
  return legacyField || legacyKeyword
    ? [{ field: legacyField, matchType: "等于" as const, keyword: legacyKeyword }]
    : [];
}

function validateExcludeOrderConfig(input: Parameters<typeof normalizeExcludeOrderConditions>[0]) {
  const conditions = normalizeExcludeOrderConditions(input);
  const hasLegacyValue = Boolean(
    normalizeOptionalText(input.excludeOrderField)
    || normalizeOptionalText(input.excludeOrderKeyword),
  );
  if (input.excludeOrderEnabled && conditions.length === 0) {
    throw new Error("开启排除订单后，至少需要一组排除条件");
  }
  if (input.excludeOrderEnabled && conditions.some((condition) => !condition.field || !condition.keyword)) {
    throw new Error("开启排除订单后，每组条件的识别字段和字段关键字均为必填");
  }
  if (!input.excludeOrderEnabled && ((input.excludeConditions || []).length > 0 || hasLegacyValue)) {
    throw new Error("请先开启排除订单，再填写排除条件");
  }
  return conditions as Array<{ field: string; matchType: "等于" | "包含"; keyword: string }>;
}

async function replaceExcludeOrderConditions(
  db: ReturnType<typeof getDb>,
  ruleId: number,
  conditions: Array<{ field: string; matchType: "等于" | "包含"; keyword: string }>,
) {
  await db.delete(recognitionRuleExcludeConditions)
    .where(eq(recognitionRuleExcludeConditions.ruleId, ruleId));
  if (conditions.length === 0) return;
  await db.insert(recognitionRuleExcludeConditions).values(
    conditions.map((condition, index) => ({
      ruleId,
      fieldName: condition.field,
      matchType: condition.matchType,
      keyword: condition.keyword,
      sortOrder: index,
    })),
  );
}

function validateRefundOrderConfig(input: {
  refundOrderEnabled?: boolean | null;
  refundJudgeField?: string | null;
  refundJudgeValue?: string | null;
  refundDirectionJudgeValue?: string | null;
  refundAmountField?: string | null;
}) {
  const judgeField = normalizeOptionalText(input.refundJudgeField);
  const judgeValue = normalizeOptionalText(input.refundJudgeValue);
  const directionJudgeValue = normalizeOptionalText(input.refundDirectionJudgeValue);
  const amountField = normalizeOptionalText(input.refundAmountField);
  if (input.refundOrderEnabled && (!judgeField || !judgeValue || !amountField)) {
    throw new Error("开启退款订单后，判断字段、退款订单字段值和退款金额字段均为必填");
  }
  if (input.refundOrderEnabled && directionJudgeValue && directionJudgeValue === judgeValue) {
    throw new Error("退款订单字段值和收支方向字段值不能相同");
  }
  if (!input.refundOrderEnabled && (judgeField || judgeValue || directionJudgeValue || amountField)) {
    throw new Error("请先开启退款订单，再填写判断字段、退款订单字段值、收支方向字段值和退款金额字段");
  }
  return { judgeValue, directionJudgeValue };
}

async function validateRuleNameUnique(db: ReturnType<typeof getDb>, ruleName: string, excludeId?: number) {
  const existing = await db.select({ id: recognitionRules.id }).from(recognitionRules).where(eq(recognitionRules.ruleName, ruleName.trim()));
  if (existing.some((rule) => rule.id !== excludeId)) {
    throw new Error("规则名称已存在，请更换其他名称");
  }
}

async function validateDetailCounterpartyAlias(db: ReturnType<typeof getDb>, alias: string) {
  const [record] = await db.select({ id: counterpartyRecords.id }).from(counterpartyRecords).where(and(
    eq(counterpartyRecords.alias, alias.trim()),
    eq(counterpartyRecords.recognitionType, "明细认账"),
  ));
  if (!record) {
    throw new Error("匹配到账信息必须选择认账类型为明细认账的到账别称");
  }
}

async function normalizeDateFieldForCounterparty(db: ReturnType<typeof getDb>, alias: string, dateField?: string | null) {
  const [record] = await db.select({ detailPackageType: counterpartyRecords.detailPackageType })
    .from(counterpartyRecords)
    .where(and(
      eq(counterpartyRecords.alias, alias.trim()),
      eq(counterpartyRecords.recognitionType, "明细认账"),
    ));
  const normalized = String(dateField ?? "").trim();
  if (record?.detailPackageType === "打包明细") return normalized;
  return normalized || "时间";
}

async function normalizeOrderNoFieldForCounterparty(db: ReturnType<typeof getDb>, alias: string, orderNoField?: string | null) {
  const [record] = await db.select({ detailPackageType: counterpartyRecords.detailPackageType })
    .from(counterpartyRecords)
    .where(and(
      eq(counterpartyRecords.alias, alias.trim()),
      eq(counterpartyRecords.recognitionType, "明细认账"),
    ));
  const normalized = String(orderNoField ?? "").trim();
  if (record?.detailPackageType === "打包明细") return normalized;
  return normalized || "订单号";
}

async function insertDetailRule(db: ReturnType<typeof getDb>, userId: number, input: z.infer<typeof detailRuleImportSchema>) {
  await validateRuleNameUnique(db, input.ruleName);
  await validateDetailCounterpartyAlias(db, input.matchedCounterpartyAlias);
  const normalizedDateField = await normalizeDateFieldForCounterparty(db, input.matchedCounterpartyAlias, input.dateField);
  const normalizedOrderNoField = await normalizeOrderNoFieldForCounterparty(db, input.matchedCounterpartyAlias, input.orderNoField);
  const normalizedItems = normalizeDetailRuleItemsForMode(input.items, input.conditionRecognitionEnabled);
  validateDetailRuleItems(normalizedItems, input.conditionRecognitionEnabled);
  const normalizedExcludeConditions = validateExcludeOrderConfig(input);
  const firstExcludeCondition = normalizedExcludeConditions[0];
  const normalizedRefundConfig = validateRefundOrderConfig(input);
  validateMultiSplitConfig(input);

  const ruleResult = await db
    .insert(recognitionRules)
    .values({
      ruleName: input.ruleName,
      matchedCounterpartyAlias: input.matchedCounterpartyAlias,
      dateField: normalizedDateField,
      incomeField: input.incomeField,
      orderNoField: normalizedOrderNoField,
      invoiceOtherOrderNo1Field: normalizeOptionalText(input.invoiceOtherOrderNo1Field),
      invoiceOtherOrderNo2Field: normalizeOptionalText(input.invoiceOtherOrderNo2Field),
      conditionRecognitionEnabled: input.conditionRecognitionEnabled,
      excludeOrderEnabled: Boolean(input.excludeOrderEnabled),
      excludeOrderField: firstExcludeCondition?.field || null,
      excludeOrderKeyword: firstExcludeCondition?.keyword || null,
      refundOrderEnabled: Boolean(input.refundOrderEnabled),
      refundJudgeField: input.refundOrderEnabled ? normalizeOptionalText(input.refundJudgeField) : null,
      refundJudgeValue: input.refundOrderEnabled ? normalizedRefundConfig.judgeValue || null : null,
      refundDirectionJudgeValue: input.refundOrderEnabled ? normalizedRefundConfig.directionJudgeValue || null : null,
      refundAmountField: input.refundOrderEnabled ? normalizeOptionalText(input.refundAmountField) : null,
      detailSplitEnabled: Boolean(input.conditionRecognitionEnabled && input.detailSplitEnabled),
      multiSplitKeywordField: input.conditionRecognitionEnabled && input.detailSplitEnabled ? normalizeOptionalText(input.multiSplitKeywordField) : null,
      multiSplitKeyword: input.conditionRecognitionEnabled && input.detailSplitEnabled ? normalizeOptionalText(input.multiSplitKeyword) : null,
      multiSplitMatchField: input.conditionRecognitionEnabled && input.detailSplitEnabled ? normalizeOptionalText(input.multiSplitMatchField) : null,
      detailSplitRecognitionKeywordField: normalizeOptionalText(input.detailSplitRecognitionKeywordField) || defaultDetailSplitRecognitionKeywordField,
      detailSplitIncomeField: normalizeOptionalText(input.detailSplitIncomeField) || defaultDetailSplitIncomeField,
      detailSplitMatchField: normalizeOptionalText(input.detailSplitMatchField) || defaultDetailSplitMatchField,
      detailSplitOrderNoField: normalizeOptionalText(input.detailSplitOrderNoField) || defaultDetailSplitOrderNoField,
      creatorId: userId,
      enabledAt: input.enabledAt || new Date(),
      isActive: input.isActive,
    })
    .$returningId();
  const id = Number(ruleResult[0]?.id);
  if (!id) throw new Error("创建规则失败，无法获取规则ID");

  await replaceExcludeOrderConditions(db, id, normalizedExcludeConditions);

  for (let i = 0; i < normalizedItems.length; i++) {
    const item = normalizedItems[i];
    const itemResult = await db
      .insert(ruleItems)
      .values({
        ruleId: id,
        keywordField: item.keywordField,
        detailKeyword: item.detailKeyword,
        keywordMatchType: item.keywordMatchType || "等于",
        sortOrder: i,
      })
      .$returningId();
    const itemId = Number(itemResult[0]?.id);
    if (!itemId) throw new Error(`创建规则条件${i + 1}失败，无法获取条件ID`);

    await db.insert(ruleItemSplits).values(
      item.splits.map((split, j) => ({
        ruleItemId: itemId,
        splitRatio: normalizeSplitRatio(split.splitRatio),
        incomeType: fixedDetailIncomeType,
        incomeAttr: split.incomeAttr,
        incomeDept: split.incomeDept,
        budgetCode: split.budgetCode,
        incomeProject: split.incomeProject,
        platformProjectName: split.platformProjectName,
        platformProjectDetail: split.platformProjectDetail,
        managementFeeRatio: normalizeManagementFeeRatio(split.managementFeeRatio),
        expenseFundSource: split.expenseFundSource,
        sortOrder: j,
      })),
    );
  }

  return id;
}

async function replaceDetailRuleItems(
  db: ReturnType<typeof getDb>,
  ruleId: number,
  items: z.infer<typeof detailRuleItemsSchema>,
) {
  validateDetailRuleItems(items);

  const oldItems = await db.select({ id: ruleItems.id }).from(ruleItems).where(eq(ruleItems.ruleId, ruleId));
  for (const oldItem of oldItems) {
    await db.delete(ruleItemSplits).where(eq(ruleItemSplits.ruleItemId, oldItem.id));
  }
  await db.delete(ruleItems).where(eq(ruleItems.ruleId, ruleId));

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const itemResult = await db
      .insert(ruleItems)
      .values({
        ruleId,
        keywordField: item.keywordField,
        detailKeyword: item.detailKeyword,
        keywordMatchType: item.keywordMatchType || "等于",
        sortOrder: i,
      })
      .$returningId();
    const itemId = Number(itemResult[0]?.id);
    if (!itemId) throw new Error(`导入规则条件${i + 1}失败，无法获取条件ID`);

    await db.insert(ruleItemSplits).values(
      item.splits.map((split, j) => ({
        ruleItemId: itemId,
        splitRatio: normalizeSplitRatio(split.splitRatio),
        incomeType: fixedDetailIncomeType,
        incomeAttr: split.incomeAttr,
        incomeDept: split.incomeDept,
        budgetCode: split.budgetCode,
        incomeProject: split.incomeProject,
        platformProjectName: split.platformProjectName,
        platformProjectDetail: split.platformProjectDetail,
        managementFeeRatio: normalizeManagementFeeRatio(split.managementFeeRatio),
        expenseFundSource: split.expenseFundSource,
        sortOrder: j,
      })),
    );
  }

  await db.update(recognitionRules).set({ updatedAt: new Date() }).where(eq(recognitionRules.id, ruleId));
}

export const ruleRouter = createRouter({
  list: authedQuery
    .input(
      z.object({
        search: z.string().optional(),
        activeOnly: z.boolean().default(true),
        all: z.boolean().optional().default(false),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(100).default(20),
      }).optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conditions = [];
      if (input?.search) {
        conditions.push(like(recognitionRules.ruleName, `%${input.search}%`));
      }
      if (input?.activeOnly) {
        conditions.push(eq(recognitionRules.isActive, true));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const allItems = input?.all === true;
      const page = input?.page || 1;
      const pageSize = input?.pageSize || 20;
      const items = await db.query.recognitionRules.findMany({
        where: whereClause,
        orderBy: desc(recognitionRules.createdAt),
        limit: allItems ? undefined : pageSize,
        offset: allItems ? undefined : (page - 1) * pageSize,
        with: {
          creator: true,
          items: {
            with: { splits: true },
          },
        },
      });

      const countResult = await db
        .select({ count: count() })
        .from(recognitionRules)
        .where(whereClause);

      const total = Number(countResult[0]?.count || 0);
      const counterparties = await db
        .select({
          alias: counterpartyRecords.alias,
          detailPackageType: counterpartyRecords.detailPackageType,
          detailMatchingMode: counterpartyRecords.detailMatchingMode,
        })
        .from(counterpartyRecords)
        .where(eq(counterpartyRecords.recognitionType, "明细认账"));
      const detailPackageTypeByAlias = new Map(
        counterparties.map((item) => [item.alias, item.detailPackageType || "T+1"]),
      );
      const detailMatchingModeByAlias = new Map(
        counterparties.map((item) => [item.alias, item.detailMatchingMode || "单笔匹配"]),
      );

      return {
        items: items.map((item) => ({
          ...item,
          detailPackageType: item.matchedCounterpartyAlias
            ? detailPackageTypeByAlias.get(item.matchedCounterpartyAlias) || null
            : null,
          detailMatchingMode: item.matchedCounterpartyAlias
            ? detailMatchingModeByAlias.get(item.matchedCounterpartyAlias) || null
            : null,
        })),
        total,
        page: allItems ? 1 : page,
        pageSize: allItems ? total : pageSize,
      };
    }),

  stats: authedQuery.query(async () => {
    const db = getDb();
    const [totalResult] = await db.select({ count: count() }).from(recognitionRules);
    const [activeResult] = await db
      .select({ count: count() })
      .from(recognitionRules)
      .where(eq(recognitionRules.isActive, true));

    return {
      total: Number(totalResult?.count || 0),
      active: Number(activeResult?.count || 0),
    };
  }),

  transferOptions: authedQuery.query(async () => {
    const db = getDb();
    const [rules, counterparties] = await Promise.all([
      db.select({
        id: recognitionRules.id,
        ruleName: recognitionRules.ruleName,
        matchedCounterpartyAlias: recognitionRules.matchedCounterpartyAlias,
      }).from(recognitionRules).orderBy(desc(recognitionRules.createdAt)),
      db.select({
        alias: counterpartyRecords.alias,
        detailPackageType: counterpartyRecords.detailPackageType,
        detailMatchingMode: counterpartyRecords.detailMatchingMode,
      }).from(counterpartyRecords).where(eq(counterpartyRecords.recognitionType, "明细认账")),
    ]);
    const detailPackageTypeByAlias = new Map(
      counterparties.map((item) => [item.alias, item.detailPackageType || "T+1"]),
    );
    const detailMatchingModeByAlias = new Map(
      counterparties.map((item) => [item.alias, item.detailMatchingMode || "单笔匹配"]),
    );

    return rules.map((rule) => ({
      id: rule.id,
      ruleName: rule.ruleName,
      detailPackageType: rule.matchedCounterpartyAlias
        ? detailPackageTypeByAlias.get(rule.matchedCounterpartyAlias) || null
        : null,
      detailMatchingMode: rule.matchedCounterpartyAlias
        ? detailMatchingModeByAlias.get(rule.matchedCounterpartyAlias) || null
        : null,
    }));
  }),

  getById: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const rule = await db.query.recognitionRules.findFirst({
        where: eq(recognitionRules.id, input.id),
        with: {
          creator: true,
          excludeConditions: {
            orderBy: recognitionRuleExcludeConditions.sortOrder,
          },
          items: {
            orderBy: ruleItems.sortOrder,
            with: { splits: true },
          },
        },
      });
      if (!rule) throw new Error("规则不存在");
      return rule;
    }),

  exportConditions: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const rule = await db.query.recognitionRules.findFirst({
        where: eq(recognitionRules.id, input.id),
        with: {
          items: {
            orderBy: ruleItems.sortOrder,
            with: { splits: true },
          },
        },
      });
      if (!rule) throw new Error("规则不存在");

      return {
        ruleName: rule.ruleName,
        items: rule.items.map((item) => ({
          keywordField: item.keywordField,
          detailKeyword: item.detailKeyword,
          keywordMatchType: item.keywordMatchType || "等于",
          splits: item.splits.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((split) => ({
            splitRatio: normalizeSplitRatio(split.splitRatio),
            incomeType: "捐赠收入",
            incomeAttr: split.incomeAttr,
            incomeDept: split.incomeDept,
            budgetCode: split.budgetCode,
            incomeProject: split.incomeProject,
            platformProjectName: split.platformProjectName,
            platformProjectDetail: split.platformProjectDetail,
            managementFeeRatio: normalizeManagementFeeRatio(split.managementFeeRatio),
            expenseFundSource: split.expenseFundSource,
          })),
        })),
      };
    }),

  importConditions: authedQuery
    .input(z.object({
      id: z.number(),
      items: detailRuleItemsSchema,
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [rule] = await db.select({ id: recognitionRules.id }).from(recognitionRules).where(eq(recognitionRules.id, input.id));
      if (!rule) throw new Error("规则不存在");

      await replaceDetailRuleItems(db, input.id, input.items);
      return { imported: input.items.length };
    }),

  create: authedQuery
    .input(
      z.object({
        ruleName: z.string().min(1, "规则名称不能为空"),
        matchedCounterpartyAlias: z.string().min(1, "匹配到账信息不能为空"),
        dateField: z.string().trim().optional().default("时间"),
        incomeField: z.string().min(1, "收入字段不能为空").default("金额"),
        orderNoField: z.string().trim().optional().default("订单号"),
        invoiceOtherOrderNo1Field: optionalTrimmedString,
        invoiceOtherOrderNo2Field: optionalTrimmedString,
        conditionRecognitionEnabled: z.boolean().default(true),
        excludeOrderEnabled: z.boolean().default(false),
        excludeConditions: z.array(excludeOrderConditionSchema).default([]),
        excludeOrderField: optionalTrimmedString,
        excludeOrderKeyword: optionalTrimmedString,
        refundOrderEnabled: z.boolean().default(false),
        refundJudgeField: optionalTrimmedString,
        refundJudgeValue: optionalTrimmedString,
        refundDirectionJudgeValue: optionalTrimmedString,
        refundAmountField: optionalTrimmedString,
        detailSplitEnabled: z.boolean().default(false),
        multiSplitKeywordField: optionalTrimmedString,
        multiSplitKeyword: optionalTrimmedString,
        multiSplitMatchField: optionalTrimmedString,
        detailSplitRecognitionKeywordField: z.string().trim().optional().default(defaultDetailSplitRecognitionKeywordField),
        detailSplitIncomeField: z.string().trim().optional().default(defaultDetailSplitIncomeField),
        detailSplitMatchField: z.string().trim().optional().default(defaultDetailSplitMatchField),
        detailSplitOrderNoField: z.string().trim().optional().default(defaultDetailSplitOrderNoField),
        enabledAt: z.coerce.date(),
        items: z.array(
          z.object({
            keywordField: z.string().min(1, "关键字字段不能为空"),
            detailKeyword: z.string().min(1, "关键字不能为空"),
            keywordMatchType: z.enum(keywordMatchTypeValues).default("等于"),
            splits: z.array(
              z.object({
                splitRatio: z.string().min(1, "分账比例不能为空"),
                incomeType: z.enum(incomeTypeValues).optional().default("捐赠收入"),
                incomeAttr: z.enum(["非限定性收入", "限定性收入"]),
                incomeDept: z.string().min(1, "收入部门不能为空"),
                budgetCode: z.string().min(1, "预算编码不能为空"),
                incomeProject: z.string().min(1, "NC项目名称不能为空"),
                platformProjectName: z.string().min(1, "平台项目名称不能为空"),
                platformProjectDetail: z.string().min(1, "平台项目详情不能为空"),
                managementFeeRatio: z.string().min(1, "管理费比例不能为空"),
                expenseFundSource: z.string().min(1, "支出资金来源不能为空"),
                sortOrder: z.number().default(0),
              }),
            ).min(1, "每个条件至少需要一条分账设置"),
          }),
        ).min(1, "至少需要一条规则条件"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      await validateRuleNameUnique(db, input.ruleName);
      await validateDetailCounterpartyAlias(db, input.matchedCounterpartyAlias);
      const normalizedDateField = await normalizeDateFieldForCounterparty(db, input.matchedCounterpartyAlias, input.dateField);
      const normalizedOrderNoField = await normalizeOrderNoFieldForCounterparty(db, input.matchedCounterpartyAlias, input.orderNoField);
      const normalizedItems = normalizeDetailRuleItemsForMode(input.items, input.conditionRecognitionEnabled);
      validateDetailRuleItems(normalizedItems, input.conditionRecognitionEnabled);
      const normalizedExcludeConditions = validateExcludeOrderConfig(input);
      const firstExcludeCondition = normalizedExcludeConditions[0];
      const normalizedRefundConfig = validateRefundOrderConfig(input);
      validateMultiSplitConfig(input);

      try {
        // 创建规则
        const ruleResult = await db
          .insert(recognitionRules)
          .values({
            ruleName: input.ruleName,
            matchedCounterpartyAlias: input.matchedCounterpartyAlias,
            dateField: normalizedDateField,
            incomeField: input.incomeField,
            orderNoField: normalizedOrderNoField,
            invoiceOtherOrderNo1Field: normalizeOptionalText(input.invoiceOtherOrderNo1Field),
            invoiceOtherOrderNo2Field: normalizeOptionalText(input.invoiceOtherOrderNo2Field),
            conditionRecognitionEnabled: input.conditionRecognitionEnabled,
            excludeOrderEnabled: input.excludeOrderEnabled,
            excludeOrderField: firstExcludeCondition?.field || null,
            excludeOrderKeyword: firstExcludeCondition?.keyword || null,
            refundOrderEnabled: input.refundOrderEnabled,
            refundJudgeField: input.refundOrderEnabled ? normalizeOptionalText(input.refundJudgeField) : null,
            refundJudgeValue: input.refundOrderEnabled ? normalizedRefundConfig.judgeValue || null : null,
            refundDirectionJudgeValue: input.refundOrderEnabled ? normalizedRefundConfig.directionJudgeValue || null : null,
            refundAmountField: input.refundOrderEnabled ? normalizeOptionalText(input.refundAmountField) : null,
            detailSplitEnabled: input.conditionRecognitionEnabled && input.detailSplitEnabled,
            multiSplitKeywordField: input.conditionRecognitionEnabled && input.detailSplitEnabled ? normalizeOptionalText(input.multiSplitKeywordField) : null,
            multiSplitKeyword: input.conditionRecognitionEnabled && input.detailSplitEnabled ? normalizeOptionalText(input.multiSplitKeyword) : null,
            multiSplitMatchField: input.conditionRecognitionEnabled && input.detailSplitEnabled ? normalizeOptionalText(input.multiSplitMatchField) : null,
            detailSplitRecognitionKeywordField: normalizeOptionalText(input.detailSplitRecognitionKeywordField) || defaultDetailSplitRecognitionKeywordField,
            detailSplitIncomeField: normalizeOptionalText(input.detailSplitIncomeField) || defaultDetailSplitIncomeField,
            detailSplitMatchField: normalizeOptionalText(input.detailSplitMatchField) || defaultDetailSplitMatchField,
            detailSplitOrderNoField: normalizeOptionalText(input.detailSplitOrderNoField) || defaultDetailSplitOrderNoField,
            creatorId: ctx.user.id,
            enabledAt: input.enabledAt,
            isActive: true,
          })
          .$returningId();
        const id = Number(ruleResult[0]?.id);
        if (!id) throw new Error("创建规则失败，无法获取规则ID");

        await replaceExcludeOrderConditions(db, id, normalizedExcludeConditions);

        // 创建条件 + 分账子项
        for (let i = 0; i < normalizedItems.length; i++) {
          const item = normalizedItems[i];
          const itemResult = await db
            .insert(ruleItems)
            .values({
              ruleId: id,
              keywordField: item.keywordField,
              detailKeyword: item.detailKeyword,
              keywordMatchType: item.keywordMatchType || "等于",
              sortOrder: i,
            })
            .$returningId();
          const itemId = Number(itemResult[0]?.id);
          if (!itemId) throw new Error(`创建规则条件${i + 1}失败，无法获取条件ID`);

          if (item.splits.length > 0) {
            const splitValues = item.splits.map((split, j) => ({
              ruleItemId: itemId,
              splitRatio: normalizeSplitRatio(split.splitRatio),
              incomeType: fixedDetailIncomeType,
              incomeAttr: split.incomeAttr,
              incomeDept: split.incomeDept,
              budgetCode: split.budgetCode,
              incomeProject: split.incomeProject,
              platformProjectName: split.platformProjectName,
              platformProjectDetail: split.platformProjectDetail,
              managementFeeRatio: normalizeManagementFeeRatio(split.managementFeeRatio),
              expenseFundSource: split.expenseFundSource,
              sortOrder: j,
            }));
            try {
              await db.insert(ruleItemSplits).values(splitValues);
            } catch (splitErr: any) {
              console.error("[rule.create] ruleItemSplits insert failed:", {
                itemId,
                splitCount: splitValues.length,
                firstSplit: splitValues[0],
                sqlMessage: splitErr?.message,
                sqlCode: splitErr?.code,
                sqlState: splitErr?.sqlState,
                sql: splitErr?.sql,
              });
              throw new Error(
                `分账子项插入失败: ${splitErr?.message || "未知错误"}` +
                ` (code=${splitErr?.code || "N/A"}, itemId=${itemId})`
              );
            }
          }
        }

        return { id };
      } catch (err: any) {
        console.error("[rule.create] 创建规则失败:", err);
        throw err;
      }
    }),

  update: authedQuery
    .input(
      z.object({
        id: z.number(),
        ruleName: z.string().min(1),
        matchedCounterpartyAlias: z.string().min(1, "匹配到账信息不能为空"),
        dateField: z.string().trim().optional().default("时间"),
        incomeField: z.string().min(1),
        orderNoField: z.string().trim().optional().default("订单号"),
        invoiceOtherOrderNo1Field: optionalTrimmedString,
        invoiceOtherOrderNo2Field: optionalTrimmedString,
        conditionRecognitionEnabled: z.boolean().default(true),
        excludeOrderEnabled: z.boolean().default(false),
        excludeConditions: z.array(excludeOrderConditionSchema).default([]),
        excludeOrderField: optionalTrimmedString,
        excludeOrderKeyword: optionalTrimmedString,
        refundOrderEnabled: z.boolean().default(false),
        refundJudgeField: optionalTrimmedString,
        refundJudgeValue: optionalTrimmedString,
        refundDirectionJudgeValue: optionalTrimmedString,
        refundAmountField: optionalTrimmedString,
        detailSplitEnabled: z.boolean().default(false),
        multiSplitKeywordField: optionalTrimmedString,
        multiSplitKeyword: optionalTrimmedString,
        multiSplitMatchField: optionalTrimmedString,
        detailSplitRecognitionKeywordField: z.string().trim().optional().default(defaultDetailSplitRecognitionKeywordField),
        detailSplitIncomeField: z.string().trim().optional().default(defaultDetailSplitIncomeField),
        detailSplitMatchField: z.string().trim().optional().default(defaultDetailSplitMatchField),
        detailSplitOrderNoField: z.string().trim().optional().default(defaultDetailSplitOrderNoField),
        enabledAt: z.coerce.date(),
        isActive: z.boolean().optional(),
        items: z.array(
          z.object({
            id: z.number().optional(),
            keywordField: z.string().min(1),
            detailKeyword: z.string().min(1),
            keywordMatchType: z.enum(keywordMatchTypeValues).default("等于"),
            splits: z.array(
              z.object({
                id: z.number().optional(),
                splitRatio: z.string().min(1),
                incomeType: z.enum(incomeTypeValues).optional().default("捐赠收入"),
                incomeAttr: z.enum(["非限定性收入", "限定性收入"]),
                incomeDept: z.string().min(1, "收入部门不能为空"),
                budgetCode: z.string().min(1, "预算编码不能为空"),
                incomeProject: z.string().min(1, "NC项目名称不能为空"),
                platformProjectName: z.string().min(1, "平台项目名称不能为空"),
                platformProjectDetail: z.string().min(1, "平台项目详情不能为空"),
                managementFeeRatio: z.string().min(1, "管理费比例不能为空"),
                expenseFundSource: z.string().min(1, "支出资金来源不能为空"),
                sortOrder: z.number().default(0),
              }),
            ).min(1),
          }),
        ).min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();

      await validateRuleNameUnique(db, input.ruleName, input.id);
      await validateDetailCounterpartyAlias(db, input.matchedCounterpartyAlias);
      const normalizedDateField = await normalizeDateFieldForCounterparty(db, input.matchedCounterpartyAlias, input.dateField);
      const normalizedOrderNoField = await normalizeOrderNoFieldForCounterparty(db, input.matchedCounterpartyAlias, input.orderNoField);
      const normalizedItems = normalizeDetailRuleItemsForMode(input.items, input.conditionRecognitionEnabled);
      validateDetailRuleItems(normalizedItems, input.conditionRecognitionEnabled);
      const normalizedExcludeConditions = validateExcludeOrderConfig(input);
      const firstExcludeCondition = normalizedExcludeConditions[0];
      const normalizedRefundConfig = validateRefundOrderConfig(input);
      validateMultiSplitConfig(input);

      await db
        .update(recognitionRules)
        .set({
          ruleName: input.ruleName,
          matchedCounterpartyAlias: input.matchedCounterpartyAlias,
          dateField: normalizedDateField,
          incomeField: input.incomeField,
          orderNoField: normalizedOrderNoField,
          invoiceOtherOrderNo1Field: normalizeOptionalText(input.invoiceOtherOrderNo1Field),
          invoiceOtherOrderNo2Field: normalizeOptionalText(input.invoiceOtherOrderNo2Field),
          conditionRecognitionEnabled: input.conditionRecognitionEnabled,
          excludeOrderEnabled: input.excludeOrderEnabled,
          excludeOrderField: firstExcludeCondition?.field || null,
          excludeOrderKeyword: firstExcludeCondition?.keyword || null,
          refundOrderEnabled: input.refundOrderEnabled,
          refundJudgeField: input.refundOrderEnabled ? normalizeOptionalText(input.refundJudgeField) : null,
          refundJudgeValue: input.refundOrderEnabled ? normalizedRefundConfig.judgeValue || null : null,
          refundDirectionJudgeValue: input.refundOrderEnabled ? normalizedRefundConfig.directionJudgeValue || null : null,
          refundAmountField: input.refundOrderEnabled ? normalizeOptionalText(input.refundAmountField) : null,
          detailSplitEnabled: input.conditionRecognitionEnabled && input.detailSplitEnabled,
          multiSplitKeywordField: input.conditionRecognitionEnabled && input.detailSplitEnabled ? normalizeOptionalText(input.multiSplitKeywordField) : null,
          multiSplitKeyword: input.conditionRecognitionEnabled && input.detailSplitEnabled ? normalizeOptionalText(input.multiSplitKeyword) : null,
          multiSplitMatchField: input.conditionRecognitionEnabled && input.detailSplitEnabled ? normalizeOptionalText(input.multiSplitMatchField) : null,
          detailSplitRecognitionKeywordField: normalizeOptionalText(input.detailSplitRecognitionKeywordField) || defaultDetailSplitRecognitionKeywordField,
          detailSplitIncomeField: normalizeOptionalText(input.detailSplitIncomeField) || defaultDetailSplitIncomeField,
          detailSplitMatchField: normalizeOptionalText(input.detailSplitMatchField) || defaultDetailSplitMatchField,
          detailSplitOrderNoField: normalizeOptionalText(input.detailSplitOrderNoField) || defaultDetailSplitOrderNoField,
          isActive: input.isActive,
          updatedAt: new Date(),
        })
        .where(eq(recognitionRules.id, input.id));

      await replaceExcludeOrderConditions(db, input.id, normalizedExcludeConditions);

      // 删除旧条件和分账
      const oldItems = await db.select({ id: ruleItems.id }).from(ruleItems).where(eq(ruleItems.ruleId, input.id));
      for (const oi of oldItems) {
        await db.delete(ruleItemSplits).where(eq(ruleItemSplits.ruleItemId, oi.id));
      }
      await db.delete(ruleItems).where(eq(ruleItems.ruleId, input.id));

      // 创建新条件 + 分账
      for (let i = 0; i < normalizedItems.length; i++) {
        const item = normalizedItems[i];
        const itemResult = await db
          .insert(ruleItems)
          .values({
            ruleId: input.id,
            keywordField: item.keywordField,
            detailKeyword: item.detailKeyword,
            keywordMatchType: item.keywordMatchType || "等于",
            sortOrder: i,
          })
          .$returningId();
        const itemId = Number(itemResult[0]?.id);
        if (!itemId) throw new Error("创建规则条件失败");

        if (item.splits.length > 0) {
          await db.insert(ruleItemSplits).values(
            item.splits.map((split, j) => ({
              ruleItemId: itemId,
              splitRatio: normalizeSplitRatio(split.splitRatio),
              incomeType: fixedDetailIncomeType,
              incomeAttr: split.incomeAttr,
              incomeDept: split.incomeDept,
              budgetCode: split.budgetCode,
              incomeProject: split.incomeProject,
              platformProjectName: split.platformProjectName,
              platformProjectDetail: split.platformProjectDetail,
              managementFeeRatio: normalizeManagementFeeRatio(split.managementFeeRatio),
              expenseFundSource: split.expenseFundSource,
              sortOrder: j,
            })),
          );
        }
      }

      return { success: true };
    }),

  updateItem: authedQuery
    .input(
      z.object({
        ruleId: z.number(),
        itemId: z.number(),
        item: detailRuleItemSchema,
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const [targetItem] = await db
        .select({
          id: ruleItems.id,
          ruleId: ruleItems.ruleId,
          sortOrder: ruleItems.sortOrder,
        })
        .from(ruleItems)
        .where(eq(ruleItems.id, input.itemId));
      if (!targetItem || Number(targetItem.ruleId) !== input.ruleId) {
        throw new Error("规则条件不存在");
      }

      const siblingItems = await db.query.ruleItems.findMany({
        where: eq(ruleItems.ruleId, input.ruleId),
        orderBy: ruleItems.sortOrder,
        with: { splits: true },
      });
      const nextItems = siblingItems.map((item) => {
        if (item.id !== input.itemId) {
          return {
            keywordField: item.keywordField,
            detailKeyword: item.detailKeyword,
            keywordMatchType: item.keywordMatchType || "等于",
            splits: item.splits.map((split) => ({
              splitRatio: normalizeSplitRatio(split.splitRatio),
            })),
          };
        }
        return {
          keywordField: input.item.keywordField,
          detailKeyword: input.item.detailKeyword,
          keywordMatchType: input.item.keywordMatchType || "等于",
          splits: input.item.splits.map((split) => ({
            splitRatio: normalizeSplitRatio(split.splitRatio),
          })),
        };
      });
      validateDetailRuleItems(nextItems);

      await db.transaction(async (tx) => {
        await tx.update(ruleItems).set({
          keywordField: input.item.keywordField,
          detailKeyword: input.item.detailKeyword,
          keywordMatchType: input.item.keywordMatchType || "等于",
        }).where(eq(ruleItems.id, input.itemId));

        await tx.delete(ruleItemSplits).where(eq(ruleItemSplits.ruleItemId, input.itemId));
        await tx.insert(ruleItemSplits).values(
          input.item.splits.map((split, j) => ({
            ruleItemId: input.itemId,
            splitRatio: normalizeSplitRatio(split.splitRatio),
            incomeType: fixedDetailIncomeType,
            incomeAttr: split.incomeAttr,
            incomeDept: split.incomeDept,
            budgetCode: split.budgetCode,
            incomeProject: split.incomeProject,
            platformProjectName: split.platformProjectName,
            platformProjectDetail: split.platformProjectDetail,
            managementFeeRatio: normalizeManagementFeeRatio(split.managementFeeRatio),
            expenseFundSource: split.expenseFundSource,
            sortOrder: j,
          })),
        );
        await tx.update(recognitionRules).set({ updatedAt: new Date() }).where(eq(recognitionRules.id, input.ruleId));
      });

      return { success: true };
    }),

  copy: authedQuery
    .input(z.object({
      sourceId: z.number(),
      ruleName: z.string().min(1, "规则名称不能为空"),
      matchedCounterpartyAlias: z.string().min(1, "匹配到账信息不能为空"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      await validateRuleNameUnique(db, input.ruleName);
      await validateDetailCounterpartyAlias(db, input.matchedCounterpartyAlias);

      const source = await db.query.recognitionRules.findFirst({
        where: eq(recognitionRules.id, input.sourceId),
        with: {
          excludeConditions: {
            orderBy: recognitionRuleExcludeConditions.sortOrder,
          },
          items: {
            orderBy: ruleItems.sortOrder,
            with: { splits: true },
          },
        },
      });
      if (!source) throw new Error("原规则不存在");

      const items = source.items.map((item) => ({
        keywordField: item.keywordField,
        detailKeyword: item.detailKeyword,
        keywordMatchType: item.keywordMatchType || "等于",
        splits: item.splits.map((split) => ({
          splitRatio: normalizeSplitRatio(split.splitRatio),
          incomeType: fixedDetailIncomeType as (typeof incomeTypeValues)[number],
          incomeAttr: split.incomeAttr as "非限定性收入" | "限定性收入",
          incomeDept: split.incomeDept || "",
          budgetCode: split.budgetCode || "",
          incomeProject: split.incomeProject || "",
          platformProjectName: split.platformProjectName || "",
          platformProjectDetail: split.platformProjectDetail || "",
          managementFeeRatio: normalizeManagementFeeRatio(split.managementFeeRatio),
          expenseFundSource: split.expenseFundSource || "",
          sortOrder: split.sortOrder,
        })),
      }));

      const id = await insertDetailRule(db, ctx.user.id, {
        ruleName: input.ruleName,
        matchedCounterpartyAlias: input.matchedCounterpartyAlias,
        dateField: source.dateField,
        incomeField: source.incomeField,
        orderNoField: source.orderNoField,
        invoiceOtherOrderNo1Field: source.invoiceOtherOrderNo1Field,
        invoiceOtherOrderNo2Field: source.invoiceOtherOrderNo2Field,
        conditionRecognitionEnabled: source.conditionRecognitionEnabled,
        excludeOrderEnabled: source.excludeOrderEnabled,
        excludeConditions: source.excludeConditions.map((condition) => ({
          field: condition.fieldName,
          matchType: condition.matchType,
          keyword: condition.keyword,
        })),
        excludeOrderField: source.excludeOrderField,
        excludeOrderKeyword: source.excludeOrderKeyword,
        refundOrderEnabled: source.refundOrderEnabled,
        refundJudgeField: source.refundJudgeField,
        refundJudgeValue: source.refundJudgeValue,
        refundDirectionJudgeValue: source.refundDirectionJudgeValue,
        refundAmountField: source.refundAmountField,
        detailSplitEnabled: source.detailSplitEnabled,
        multiSplitKeywordField: source.multiSplitKeywordField,
        multiSplitKeyword: source.multiSplitKeyword,
        multiSplitMatchField: source.multiSplitMatchField,
        detailSplitRecognitionKeywordField: source.detailSplitRecognitionKeywordField || defaultDetailSplitRecognitionKeywordField,
        detailSplitIncomeField: source.detailSplitIncomeField || defaultDetailSplitIncomeField,
        detailSplitMatchField: source.detailSplitMatchField || defaultDetailSplitMatchField,
        detailSplitOrderNoField: source.detailSplitOrderNoField || defaultDetailSplitOrderNoField,
        enabledAt: new Date(),
        isActive: true,
        items,
      });

      return { id };
    }),

  toggleActive: authedQuery
    .input(z.object({ id: z.number(), isActive: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.update(recognitionRules)
        .set({ isActive: input.isActive, updatedAt: new Date() })
        .where(eq(recognitionRules.id, input.id));
      return { success: true };
    }),

  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "recognition_rule_delete"))) throw new Error("权限不足");
      const db = getDb();
      // 先删分账，再删条件，最后删规则
      const oldItems = await db.select({ id: ruleItems.id }).from(ruleItems).where(eq(ruleItems.ruleId, input.id));
      for (const oi of oldItems) {
        await db.delete(ruleItemSplits).where(eq(ruleItemSplits.ruleItemId, oi.id));
      }
      await db.delete(ruleItems).where(eq(ruleItems.ruleId, input.id));
      await db.delete(recognitionRuleExcludeConditions)
        .where(eq(recognitionRuleExcludeConditions.ruleId, input.id));
      await db.delete(recognitionRules).where(eq(recognitionRules.id, input.id));
      return { success: true };
    }),
});
