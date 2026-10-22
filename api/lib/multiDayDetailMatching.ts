import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import {
  bankFlows,
  billDetails,
  counterpartyRecords,
  multiDayMatchGroupFlows,
  multiDayMatchGroups,
  orderFiles,
  recognitionRules,
  recognitionTasks,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { attachCounterpartyMatchers } from "./counterpartyMatchers";
import { findMultiDayAmountSolutions } from "./multiDayMatchCombinations";
import { syncOrderFilePartitionsByOrderFileId } from "./orderFilePartitions";
import { refreshRecognitionDateSummariesByTaskIds } from "./recognitionDateSummary";
import { enqueueRecognition } from "./recognitionQueue";

export const MULTI_DAY_MAX_CANDIDATE_SOLUTIONS = 3;

export type MultiDayFlowCandidate = {
  id: number;
  taskId: number;
  billDate: string;
  transactionTime: string;
  referenceNo: string;
  counterpartyName: string | null;
  purpose: string | null;
  income: string;
  amount: string;
};

export type MultiDayMatchSolution = {
  flowIds: number[];
  flowCount: number;
  startDate: string;
  endDate: string;
  totalAmount: string;
  flows: MultiDayFlowCandidate[];
};

function toCents(value: unknown) {
  return Math.round(Number(value || 0) * 100);
}

function normalizeDate(value: unknown) {
  return String(value || "").trim().replace(/\//g, "-").slice(0, 10);
}

export function isMultiDayDetailCounterparty(counterparty: any) {
  return counterparty?.recognitionType === "明细认账"
    && counterparty?.detailMatchingMode === "多日汇总匹配";
}

export async function getOrCreatePendingMultiDayMatchGroup(ruleId: number) {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(multiDayMatchGroups)
    .where(and(
      eq(multiDayMatchGroups.ruleId, ruleId),
      inArray(multiDayMatchGroups.status, ["unmatched", "pending_confirmation"] as any),
      isNull(multiDayMatchGroups.anchorTaskId),
    ))
    .orderBy(asc(multiDayMatchGroups.id))
    .limit(1);
  if (existing) return Number(existing.id);

  const inserted = await db.insert(multiDayMatchGroups).values({
    ruleId,
    status: "unmatched",
    packageTotal: "0.00",
  }).$returningId();
  const groupId = Number(inserted[0]?.id || 0);
  if (!groupId) throw new Error("创建多日汇总匹配订单包失败");
  return groupId;
}

export async function refreshMultiDayMatchGroupTotal(groupId: number) {
  const db = getDb();
  const [summary] = await db
    .select({
      total: sql<string>`COALESCE(SUM(CAST(${orderFiles.orderTotalAmount} AS DECIMAL(18,2)) - CAST(${orderFiles.refundAmount} AS DECIMAL(18,2))), 0.00)`,
    })
    .from(orderFiles)
    .where(and(
      eq(orderFiles.multiDayMatchGroupId, groupId),
      eq(orderFiles.uploadStatus, "completed"),
    ));
  const packageTotal = Number(summary?.total || 0).toFixed(2);
  await db.update(multiDayMatchGroups).set({
    packageTotal,
    updatedAt: new Date(),
  }).where(eq(multiDayMatchGroups.id, groupId));
  return packageTotal;
}

async function readGroupContext(groupId: number) {
  const db = getDb();
  const [row] = await db
    .select({
      group: multiDayMatchGroups,
      matchedCounterpartyAlias: recognitionRules.matchedCounterpartyAlias,
      counterpartyId: counterpartyRecords.id,
      recognitionType: counterpartyRecords.recognitionType,
      detailMatchingMode: counterpartyRecords.detailMatchingMode,
    })
    .from(multiDayMatchGroups)
    .leftJoin(recognitionRules, eq(recognitionRules.id, multiDayMatchGroups.ruleId))
    .leftJoin(counterpartyRecords, eq(counterpartyRecords.alias, recognitionRules.matchedCounterpartyAlias))
    .where(eq(multiDayMatchGroups.id, groupId));
  if (!row?.group) throw new Error("多日汇总订单包不存在");
  const counterparty = await attachCounterpartyMatchers(db, {
    id: row.counterpartyId,
    recognitionType: row.recognitionType,
    detailMatchingMode: row.detailMatchingMode,
  });
  if (!isMultiDayDetailCounterparty(counterparty)) {
    throw new Error("该订单包未配置多日汇总匹配");
  }
  return { ...row, counterparty };
}

async function readAvailableFlowCandidates(groupId: number, packageTotal: string) {
  const db = getDb();
  const context = await readGroupContext(groupId);
  const targetCents = toCents(packageTotal);
  if (targetCents <= 0) return [] as MultiDayFlowCandidate[];
  const rows = await db
    .select({
      id: bankFlows.id,
      taskId: bankFlows.taskId,
      billDate: recognitionTasks.billDate,
      transactionTime: bankFlows.transactionTime,
      referenceNo: bankFlows.referenceNo,
      counterpartyName: bankFlows.counterpartyName,
      purpose: bankFlows.purpose,
      income: bankFlows.income,
      flow: bankFlows,
    })
    .from(bankFlows)
    .leftJoin(recognitionTasks, eq(recognitionTasks.id, bankFlows.taskId))
    .where(and(
      eq(bankFlows.recognitionStatus, "unrecognized"),
      eq(bankFlows.arrivalMatchStatus, "matched"),
      eq(bankFlows.matchedCounterpartyId, Number(context.counterparty.id)),
      or(
        isNull(recognitionTasks.ruleId),
        eq(recognitionTasks.ruleId, 0),
        eq(recognitionTasks.ruleId, Number(context.group.ruleId)),
      ),
      sql`CAST(${bankFlows.income} AS DECIMAL(18,2)) > 0`,
      sql`CAST(${bankFlows.income} AS DECIMAL(18,2)) <= ${packageTotal}`,
      sql`NOT EXISTS (SELECT 1 FROM multi_day_match_group_flows used_flow WHERE used_flow.bank_flow_id = ${bankFlows.id})`,
      sql`NOT EXISTS (SELECT 1 FROM match_results existing_result WHERE existing_result.bank_flow_id = ${bankFlows.id})`,
    ));

  return rows
    .filter((row) => row.taskId && row.billDate)
    .map((row) => ({
      id: Number(row.id),
      taskId: Number(row.taskId),
      billDate: String(row.billDate),
      transactionTime: String(row.transactionTime || ""),
      referenceNo: String(row.referenceNo || ""),
      counterpartyName: row.counterpartyName,
      purpose: row.purpose,
      income: Number(row.income || 0).toFixed(2),
      amount: Number(row.income || 0).toFixed(2),
    }));
}

export async function findMultiDayMatchCandidates(input: {
  groupId: number;
  preferredFlowIds?: number[];
}) {
  const packageTotal = await refreshMultiDayMatchGroupTotal(input.groupId);
  const preferredIds = new Set((input.preferredFlowIds || []).map(Number).filter(Boolean));
  const candidates = await readAvailableFlowCandidates(input.groupId, packageTotal);
  candidates.sort((a, b) => {
    const preferredDiff = Number(preferredIds.has(b.id)) - Number(preferredIds.has(a.id));
    if (preferredDiff !== 0) return preferredDiff;
    return b.transactionTime.localeCompare(a.transactionTime) || b.id - a.id;
  });
  const solutions = findMultiDayAmountSolutions(candidates, toCents(packageTotal), {
    maxSolutions: MULTI_DAY_MAX_CANDIDATE_SOLUTIONS,
    requiredCandidateIds: input.preferredFlowIds,
  });
  const formatted: MultiDayMatchSolution[] = solutions.map((flows) => {
    const sorted = [...flows].sort((a, b) =>
      a.billDate.localeCompare(b.billDate)
      || a.transactionTime.localeCompare(b.transactionTime)
      || a.id - b.id
    );
    return {
      flowIds: sorted.map((flow) => flow.id),
      flowCount: sorted.length,
      startDate: sorted[0]?.billDate || "-",
      endDate: sorted[sorted.length - 1]?.billDate || "-",
      totalAmount: (sorted.reduce((sum, flow) => sum + toCents(flow.income), 0) / 100).toFixed(2),
      flows: sorted,
    };
  });
  return { packageTotal, solutions: formatted };
}

async function refreshAnchorTaskSummary(taskId: number) {
  const db = getDb();
  const [summary] = await db.select({
    total: sql<string>`COALESCE(SUM(CAST(${billDetails.totalAmount} AS DECIMAL(18,2))), 0.00)`,
    count: sql<number>`COUNT(*)`,
    matchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchResultId} IS NOT NULL THEN 1 ELSE 0 END)`,
    unmatchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'unmatched' THEN 1 ELSE 0 END)`,
    pendingSplitCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'pending_split' AND ${billDetails.matchResultId} IS NULL THEN 1 ELSE 0 END)`,
  }).from(billDetails).where(and(
    eq(billDetails.taskId, taskId),
    isNull(billDetails.detailSplitFileId),
  ));
  await db.update(recognitionTasks).set({
    billDetailTotal: Number(summary?.total || 0).toFixed(2),
    billDetailCount: Number(summary?.count || 0),
    matchedCount: Number(summary?.matchedCount || 0),
    unmatchedCount: Number(summary?.unmatchedCount || 0),
    pendingSplitCount: Number(summary?.pendingSplitCount || 0),
    hasDetailFile: Number(summary?.count || 0) > 0,
    updatedAt: new Date(),
  }).where(eq(recognitionTasks.id, taskId));
}

export async function confirmMultiDayMatch(input: { groupId: number; flowIds: number[] }) {
  const db = getDb();
  const context = await readGroupContext(input.groupId);
  if (context.group.status === "matched") {
    return {
      status: "matched" as const,
      taskId: Number(context.group.anchorTaskId || 0),
      billDate: String(context.group.latestBillDate || ""),
      flowCount: 0,
    };
  }
  const uniqueFlowIds = Array.from(new Set(input.flowIds.map(Number).filter(Boolean)));
  if (uniqueFlowIds.length === 0) throw new Error("请选择银行流水组合");
  const packageTotal = await refreshMultiDayMatchGroupTotal(input.groupId);
  const candidates = await readAvailableFlowCandidates(input.groupId, packageTotal);
  const selected = candidates.filter((flow) => uniqueFlowIds.includes(flow.id));
  if (selected.length !== uniqueFlowIds.length) throw new Error("候选方案已变化，请重新查找");
  if (selected.reduce((sum, flow) => sum + toCents(flow.income), 0) !== toCents(packageTotal)) {
    throw new Error("所选流水金额合计与订单包净额不一致");
  }
  selected.sort((a, b) =>
    a.billDate.localeCompare(b.billDate)
    || a.transactionTime.localeCompare(b.transactionTime)
    || a.id - b.id
  );
  const latestFlow = selected[selected.length - 1];
  const latestBillDate = normalizeDate(latestFlow.billDate || latestFlow.transactionTime);
  const anchorTaskId = Number(latestFlow.taskId);
  const orderFileRows = await db.select({ id: orderFiles.id })
    .from(orderFiles)
    .where(eq(orderFiles.multiDayMatchGroupId, input.groupId));
  const orderFileIds = orderFileRows.map((row) => Number(row.id)).filter(Boolean);
  if (orderFileIds.length === 0) throw new Error("多日汇总订单包没有来源文件");

  await db.transaction(async (tx) => {
    // No-op update acquires row locks so a flow cannot be recognized or claimed
    // between the availability recheck and the group-flow insertion.
    await tx.update(bankFlows)
      .set({ recognitionStatus: sql`${bankFlows.recognitionStatus}` })
      .where(inArray(bankFlows.id, uniqueFlowIds));
    const lockedFlows = await tx.select({
      id: bankFlows.id,
      status: bankFlows.recognitionStatus,
    }).from(bankFlows).where(inArray(bankFlows.id, uniqueFlowIds));
    if (lockedFlows.length !== uniqueFlowIds.length || lockedFlows.some((flow) => flow.status !== "unrecognized")) {
      throw new Error("候选方案已变化，请重新查找");
    }
    const used = await tx.select({ bankFlowId: multiDayMatchGroupFlows.bankFlowId })
      .from(multiDayMatchGroupFlows)
      .where(inArray(multiDayMatchGroupFlows.bankFlowId, uniqueFlowIds));
    if (used.length > 0) throw new Error("候选流水已被其他订单包占用，请重新查找");

    const claimResult: any = await tx.update(multiDayMatchGroups).set({
      status: "matched",
      anchorTaskId,
      latestBillDate,
      packageTotal,
      updatedAt: new Date(),
    }).where(and(
      eq(multiDayMatchGroups.id, input.groupId),
      inArray(multiDayMatchGroups.status, ["unmatched", "pending_confirmation"] as any),
    ));
    const claimed = Number(claimResult?.[0]?.affectedRows ?? claimResult?.affectedRows ?? 0);
    if (claimed !== 1) throw new Error("该订单包已被其他操作匹配，请刷新后重试");
    await tx.insert(multiDayMatchGroupFlows).values(selected.map((flow, index) => ({
      groupId: input.groupId,
      bankFlowId: flow.id,
      sortOrder: index + 1,
    })));
    const selectedTaskIds = Array.from(new Set(selected.map((flow) => flow.taskId)));
    await tx.update(recognitionTasks).set({
      ruleId: Number(context.group.ruleId),
      status: "processing",
      completedAt: null,
      updatedAt: new Date(),
    }).where(inArray(recognitionTasks.id, selectedTaskIds));
    await tx.update(orderFiles).set({
      taskId: anchorTaskId,
      uploadDate: latestBillDate,
    }).where(inArray(orderFiles.id, orderFileIds));
    await tx.update(billDetails).set({
      taskId: anchorTaskId,
      billDate: latestBillDate,
      partitionDate: latestBillDate,
      lifecycleStatus: "normal",
    }).where(inArray(billDetails.orderFileId, orderFileIds));
  });

  for (const orderFileId of orderFileIds) {
    await syncOrderFilePartitionsByOrderFileId(db, orderFileId);
  }
  await refreshAnchorTaskSummary(anchorTaskId);
  const selectedTaskIds = Array.from(new Set(selected.map((flow) => flow.taskId)));
  await refreshRecognitionDateSummariesByTaskIds(selectedTaskIds);
  void enqueueRecognition(anchorTaskId).catch((err) => {
    console.error(`[multi-day-match] 认账任务 ${anchorTaskId} 执行失败:`, err);
  });
  return {
    status: "matched" as const,
    taskId: anchorTaskId,
    billDate: latestBillDate,
    flowCount: selected.length,
  };
}

export async function evaluateMultiDayMatchGroup(input: {
  groupId: number;
  preferredFlowIds?: number[];
  preserveStatusWhenEmpty?: boolean;
}) {
  const db = getDb();
  const result = await findMultiDayMatchCandidates(input);
  if (result.solutions.length === 1) {
    return confirmMultiDayMatch({ groupId: input.groupId, flowIds: result.solutions[0].flowIds });
  }
  if (result.solutions.length > 1) {
    await db.update(multiDayMatchGroups).set({
      status: "pending_confirmation",
      updatedAt: new Date(),
    }).where(eq(multiDayMatchGroups.id, input.groupId));
    return { status: "pending_confirmation" as const, solutionCount: result.solutions.length };
  }
  if (!input.preserveStatusWhenEmpty) {
    await db.update(multiDayMatchGroups).set({
      status: "unmatched",
      updatedAt: new Date(),
    }).where(eq(multiDayMatchGroups.id, input.groupId));
  }
  return { status: "unmatched" as const, solutionCount: 0 };
}

export async function retryPendingMultiDayGroupsForFlowIds(flowIds: number[]) {
  const db = getDb();
  const preferredFlowIds = Array.from(new Set(flowIds.map(Number).filter(Boolean)));
  if (preferredFlowIds.length === 0) return [];
  const groups = await db.select({ id: multiDayMatchGroups.id })
    .from(multiDayMatchGroups)
    .where(inArray(multiDayMatchGroups.status, ["unmatched", "pending_confirmation"] as any))
    .orderBy(asc(multiDayMatchGroups.createdAt), asc(multiDayMatchGroups.id));
  const results = [];
  for (const group of groups) {
    const result = await evaluateMultiDayMatchGroup({
      groupId: Number(group.id),
      preferredFlowIds,
      preserveStatusWhenEmpty: true,
    });
    results.push({ groupId: Number(group.id), ...result });
  }
  return results;
}

export async function retryPendingMultiDayGroupsForBillDate(billDate: string) {
  const db = getDb();
  const taskRows = await db.select({ id: recognitionTasks.id })
    .from(recognitionTasks)
    .where(eq(recognitionTasks.billDate, billDate));
  const taskIds = taskRows.map((row) => Number(row.id)).filter(Boolean);
  if (taskIds.length === 0) return [];
  const flowRows = await db.select({ id: bankFlows.id })
    .from(bankFlows)
    .where(and(
      inArray(bankFlows.taskId, taskIds),
      eq(bankFlows.recognitionStatus, "unrecognized"),
      gt(bankFlows.income, "0"),
    ));
  return retryPendingMultiDayGroupsForFlowIds(flowRows.map((row) => Number(row.id)));
}

export async function getMultiDayMatchGroupByTaskId(taskId: number) {
  const db = getDb();
  const [direct] = await db.select().from(multiDayMatchGroups).where(and(
    eq(multiDayMatchGroups.anchorTaskId, taskId),
    eq(multiDayMatchGroups.status, "matched"),
  ));
  if (direct) return direct;
  const [linked] = await db
    .select({ group: multiDayMatchGroups })
    .from(multiDayMatchGroupFlows)
    .innerJoin(multiDayMatchGroups, eq(multiDayMatchGroups.id, multiDayMatchGroupFlows.groupId))
    .innerJoin(bankFlows, eq(bankFlows.id, multiDayMatchGroupFlows.bankFlowId))
    .where(and(
      eq(bankFlows.taskId, taskId),
      eq(multiDayMatchGroups.status, "matched"),
    ));
  return linked?.group || null;
}

export async function getMultiDayMatchGroupByFlowId(flowId: number) {
  const db = getDb();
  const [row] = await db
    .select({ group: multiDayMatchGroups })
    .from(multiDayMatchGroupFlows)
    .innerJoin(multiDayMatchGroups, eq(multiDayMatchGroups.id, multiDayMatchGroupFlows.groupId))
    .where(and(
      eq(multiDayMatchGroupFlows.bankFlowId, flowId),
      eq(multiDayMatchGroups.status, "matched"),
    ));
  return row?.group || null;
}

export async function getMultiDayMatchGroupFlows(groupId: number) {
  const db = getDb();
  return db
    .select({ flow: bankFlows, billDate: recognitionTasks.billDate })
    .from(multiDayMatchGroupFlows)
    .innerJoin(bankFlows, eq(bankFlows.id, multiDayMatchGroupFlows.bankFlowId))
    .leftJoin(recognitionTasks, eq(recognitionTasks.id, bankFlows.taskId))
    .where(eq(multiDayMatchGroupFlows.groupId, groupId))
    .orderBy(asc(multiDayMatchGroupFlows.sortOrder), asc(multiDayMatchGroupFlows.id));
}

export async function cleanupEmptyMultiDayMatchGroup(groupId: number) {
  const db = getDb();
  const [row] = await db.select({ count: sql<number>`COUNT(*)` })
    .from(orderFiles)
    .where(eq(orderFiles.multiDayMatchGroupId, groupId));
  if (Number(row?.count || 0) === 0) {
    await db.delete(multiDayMatchGroupFlows).where(eq(multiDayMatchGroupFlows.groupId, groupId));
    await db.delete(multiDayMatchGroups).where(eq(multiDayMatchGroups.id, groupId));
  }
}
