import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  orderFiles,
  billDetails,
  recognitionRules,
  users,
  matchResults,
  recognitionTasks,
  bankFlows,
  counterpartyRecords,
  multiDayMatchGroupFlows,
  multiDayMatchGroups,
  invoiceOnlyOrderDetails,
  invoiceOnlyOrderFiles,
  invoiceOnlyRules,
  ruleItems,
} from "@db/schema";
import { and, asc, count, desc, eq, gt, inArray, isNull, like, or, sql } from "drizzle-orm";
import { refreshRecognitionDateSummariesByTaskIds } from "./lib/recognitionDateSummary";
import { refreshDetailSplitFileSummaries } from "./lib/detailSplitSummary";
import { userHasPermission } from "./lib/permissions";
import { attachCounterpartyMatchers } from "./lib/counterpartyMatchers";
import { enqueueRecognition } from "./lib/recognitionQueue";
import { getPackageScopePartitionDate, listOrderFileBillDetails, listOrderFilePackageBillDetails } from "./lib/billDetailArchiveRead";
import { applyOrderFilePartitionDeltas, clearOrderFilePartitionsByOrderFileIds, syncOrderFilePartitionsByOrderFileId } from "./lib/orderFilePartitions";
import {
  acquireBillDetailArchiveDateLock,
  listBillDetailArchiveTableNames,
  refreshArchiveRunSnapshots,
  releaseBillDetailArchiveDateLock,
  restoreArchivedPackageToHotTable,
} from "./lib/billDetailArchiveWrite";
import {
  confirmMultiDayMatch,
  cleanupEmptyMultiDayMatchGroup,
  evaluateMultiDayMatchGroup,
  findMultiDayMatchCandidates,
  isMultiDayDetailCounterparty,
  refreshMultiDayMatchGroupTotal,
} from "./lib/multiDayDetailMatching";
import { allocateRecognizedAmountAcrossFlows, ensureSameDayAggregateTask } from "./lib/sameDayDetailTask";
import { getDeleteTargetTaskDate, getOrderFileDeleteDbHeavyJobKey } from "./lib/orderFileDeletion";
import { deleteManualOrderWorkItemsByOrderFileIds } from "./lib/manualOrderWorkItems";
import { enqueueDbHeavyJob } from "./lib/dbHeavyQueue";

const DELETE_PACKAGE_STEPS = [
  "正在检查订单明细包",
  "正在回滚明细分账认账状态",
  "正在删除入账结果",
  "正在删除订单明细包",
  "正在刷新认账汇总",
] as const;

const deletePackageInputSchema = z.object({
  billDate: z.string(),
  ruleId: z.number(),
  detailPackageType: z.enum(["T+1", "打包明细", "不认账"]).default("T+1"),
  sourceType: z.enum(["recognition", "invoice_only"]).default("recognition"),
  orderFileId: z.number().optional(),
});

type DeletePackageInput = z.infer<typeof deletePackageInputSchema>;
type DeletePackageSessionStatus = "running" | "completed" | "failed";
type DeletePackageResult = {
  success: true;
  deletedCount: number;
  affectedTasks: number;
  alreadyDeleted?: boolean;
};
type DeletePackageSession = {
  deleteId: string;
  packageKey: string;
  status: DeletePackageSessionStatus;
  step: number;
  totalSteps: number;
  message: string;
  error?: string;
  deletedCount?: number;
  affectedTasks?: number;
  startedAt: number;
  completedAt?: number;
};

const deletePackageSessions = new Map<string, DeletePackageSession>();
const DELETE_PACKAGE_SESSION_TTL = 30 * 60 * 1000;

function getDeletePackageKey(input: DeletePackageInput) {
  return `${input.sourceType || "recognition"}-${input.billDate}-${input.detailPackageType || "T+1"}-${input.ruleId || 0}`;
}

function cleanupDeletePackageSessions() {
  const now = Date.now();
  for (const [deleteId, session] of deletePackageSessions.entries()) {
    const finishedAt = session.completedAt || session.startedAt;
    if (now - finishedAt > DELETE_PACKAGE_SESSION_TTL) {
      deletePackageSessions.delete(deleteId);
    }
  }
}

function createDeletePackageSession(input: DeletePackageInput) {
  cleanupDeletePackageSessions();
  const deleteId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const session: DeletePackageSession = {
    deleteId,
    packageKey: getDeletePackageKey(input),
    status: "running",
    step: 1,
    totalSteps: DELETE_PACKAGE_STEPS.length,
    message: DELETE_PACKAGE_STEPS[0],
    startedAt: Date.now(),
  };
  deletePackageSessions.set(deleteId, session);
  return session;
}

function updateDeletePackageSession(deleteId: string, patch: Partial<DeletePackageSession>) {
  const session = deletePackageSessions.get(deleteId);
  if (!session) return;
  deletePackageSessions.set(deleteId, { ...session, ...patch });
}

function normalizeDate(dateStr: string): string {
  let d = String(dateStr || "").replace(/\//g, "-").trim();
  d = d.split(" ")[0];
  const parts = d.split("-");
  if (parts.length === 3) {
    const year = parts[0];
    const month = parts[1].padStart(2, "0");
    const day = parts[2].padStart(2, "0");
    d = `${year}-${month}-${day}`;
  }
  return d;
}

function rowsFromExecuteResult(result: any): any[] {
  if (Array.isArray(result)) {
    if (Array.isArray(result[0])) return result[0];
    return result;
  }
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
}

function addDays(dateStr: string, days: number): string {
  const normalized = normalizeDate(dateStr);
  const [year, month, day] = normalized.split("-").map(Number);
  if (!year || !month || !day) return normalized;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return normalized;
  date.setUTCDate(date.getUTCDate() + days);
  const resultYear = date.getUTCFullYear();
  const resultMonth = String(date.getUTCMonth() + 1).padStart(2, "0");
  const resultDay = String(date.getUTCDate()).padStart(2, "0");
  return `${resultYear}-${resultMonth}-${resultDay}`;
}

function isZeroOrderTotal(value: number) {
  return Math.abs(value) < 0.005;
}

function isAggregateDetailMode(task: { recognitionType?: string | null; detailMatchingMode?: string | null }) {
  return task.recognitionType === "明细认账" && task.detailMatchingMode === "同日汇总匹配";
}

function isUnmatchedPackageDate(value: string) {
  return String(value || "").trim() === "-";
}

async function findEarliestUnrecognizedBankFlowTask(counterparty: any) {
  const db = getDb();
  const pageSize = 1000;
  for (let page = 0; page < 50; page += 1) {
    const rows = await db
      .select({
        flow: bankFlows,
        taskId: recognitionTasks.id,
        billDate: recognitionTasks.billDate,
      })
      .from(bankFlows)
      .leftJoin(recognitionTasks, eq(recognitionTasks.id, bankFlows.taskId))
      .where(and(
        inArray(bankFlows.recognitionStatus, ["unrecognized", "partial_matched"] as any),
        eq(bankFlows.arrivalMatchStatus, "matched"),
        eq(bankFlows.matchedCounterpartyId, Number(counterparty.id)),
        gt(bankFlows.income, "0"),
      ))
      .orderBy(asc(recognitionTasks.billDate), asc(bankFlows.transactionTime), asc(bankFlows.id))
      .limit(pageSize)
      .offset(page * pageSize);
    if (rows.length === 0) return null;
    const flowIds = rows.map((row) => Number(row.flow.id || 0)).filter(Boolean);
    const recognizedRows = flowIds.length > 0
      ? await db
        .select({
          bankFlowId: matchResults.bankFlowId,
          total: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
        })
        .from(matchResults)
        .where(inArray(matchResults.bankFlowId, flowIds))
        .groupBy(matchResults.bankFlowId)
      : [];
    const recognizedByFlowId = new Map(recognizedRows.map((row) => [Number(row.bankFlowId || 0), Number(row.total || 0)]));
    const matched = rows.find((row) => {
      const flowId = Number(row.flow.id || 0);
      const remainingAmount = Number(row.flow.income || 0) - Number(recognizedByFlowId.get(flowId) || 0);
      return row.taskId && row.billDate && remainingAmount > 0.01;
    });
    if (matched) {
      return {
        taskId: Number(matched.taskId),
        billDate: String(matched.billDate),
      };
    }
  }
  return null;
}

function deriveFlowRecognitionStatus(income: number, recognizedAmount: number) {
  if (recognizedAmount >= income - 0.01) return "recognized";
  if (recognizedAmount > 0.01) return "partial_matched";
  return "unrecognized";
}

async function syncAggregateDetailFlowStatus(taskId: number) {
  const db = getDb();
  const [task] = await db
    .select({
      ruleId: recognitionTasks.ruleId,
      billDate: recognitionTasks.billDate,
      counterpartyId: counterpartyRecords.id,
      recognitionType: counterpartyRecords.recognitionType,
      detailMatchingMode: counterpartyRecords.detailMatchingMode,
    })
    .from(recognitionTasks)
    .leftJoin(recognitionRules, eq(recognitionRules.id, recognitionTasks.ruleId))
    .leftJoin(counterpartyRecords, eq(counterpartyRecords.alias, recognitionRules.matchedCounterpartyAlias))
    .where(eq(recognitionTasks.id, taskId));
  if (!task || !isAggregateDetailMode(task)) return false;

  const flows = await db.select().from(bankFlows)
    .where(and(
      eq(bankFlows.taskId, taskId),
      gt(bankFlows.income, "0"),
      eq(bankFlows.arrivalMatchStatus, "matched"),
      eq(bankFlows.matchedCounterpartyId, Number(task.counterpartyId)),
    ))
    .orderBy(asc(bankFlows.transactionTime), asc(bankFlows.id));
  const flowIds = flows.map((flow) => Number(flow.id)).filter(Boolean);
  if (flowIds.length === 0) return true;

  const [recognizedSummary] = await db
    .select({
      total: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
    })
    .from(matchResults)
    .where(inArray(matchResults.bankFlowId, flowIds));

  for (const allocation of allocateRecognizedAmountAcrossFlows(flows, recognizedSummary?.total || 0)) {
    await db.update(bankFlows)
      .set({ recognitionStatus: allocation.status })
      .where(eq(bankFlows.id, allocation.flowId));
  }

  return true;
}

// 仅用于订单包源明细被实际删除后重建剩余文件快照。
// 忽略、转移等状态操作不得调用本函数改写上传结果。
async function refreshOrderFileSummary(orderFileId: number) {
  const db = getDb();
  const [summary] = await db
    .select({
      entryCount: count(),
      orderTotalAmount: sql<string>`COALESCE(SUM(CASE WHEN CAST(${billDetails.refundAmountSnapshot} AS DECIMAL(18,2)) > 0 THEN 0 ELSE CAST(${billDetails.totalAmount} AS DECIMAL(18,2)) END), 0.00)`,
      refundAmount: sql<string>`COALESCE(SUM(CAST(${billDetails.refundAmountSnapshot} AS DECIMAL(18,2))), 0.00)`,
      activityAmount: sql<string>`COALESCE(SUM(ABS(CAST(${billDetails.totalAmount} AS DECIMAL(18,2)))), 0.00)`,
      matchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'matched' THEN 1 ELSE 0 END)`,
      unmatchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'unmatched' THEN 1 ELSE 0 END)`,
      pendingSplitCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'pending_split' THEN 1 ELSE 0 END)`,
    })
    .from(billDetails)
    .where(and(
      eq(billDetails.orderFileId, orderFileId),
      isNull(billDetails.detailSplitFileId),
    ));

  const entryCount = Number(summary?.entryCount || 0);
  if (entryCount === 0) {
    await db.delete(orderFiles).where(eq(orderFiles.id, orderFileId));
    return;
  }

  const orderTotalAmount = Number(summary?.orderTotalAmount || 0);
  const activityAmount = Number(summary?.activityAmount || 0);
  const isAbnormal = entryCount > 0 && isZeroOrderTotal(activityAmount);
  await db.update(orderFiles).set({
    uploadStatus: isAbnormal ? "abnormal" : "completed",
    entryCount,
    processedCount: entryCount,
    orderTotalAmount: orderTotalAmount.toFixed(2),
    refundAmount: Number(summary?.refundAmount || 0).toFixed(2),
    matchedCount: Number(summary?.matchedCount || 0),
    unmatchedCount: Number(summary?.unmatchedCount || 0),
    pendingSplitCount: Number(summary?.pendingSplitCount || 0),
    failedReason: isAbnormal ? "订单总金额为0，已标记异常，不参与认账" : null,
  }).where(eq(orderFiles.id, orderFileId));
}

async function refreshRecognitionTaskSummary(taskId: number) {
  const db = getDb();
  const [task] = await db
    .select({
      id: recognitionTasks.id,
      ruleId: recognitionTasks.ruleId,
      billDate: recognitionTasks.billDate,
      bankFlowTotal: recognitionTasks.bankFlowTotal,
      bankFlowCount: recognitionTasks.bankFlowCount,
      counterpartyId: counterpartyRecords.id,
      detailPackageType: counterpartyRecords.detailPackageType,
      recognitionType: counterpartyRecords.recognitionType,
      detailMatchingMode: counterpartyRecords.detailMatchingMode,
    })
    .from(recognitionTasks)
    .leftJoin(recognitionRules, eq(recognitionRules.id, recognitionTasks.ruleId))
    .leftJoin(counterpartyRecords, eq(counterpartyRecords.alias, recognitionRules.matchedCounterpartyAlias))
    .where(eq(recognitionTasks.id, taskId));
  if (!task) return;

  const taskRuleId = Number(task.ruleId || 0);
  const detailDate = addDays(task.billDate, -1);
  const detailPackageType = task.detailPackageType === "打包明细" ? "打包明细" : "T+1";
  const activeDetailWhere = and(
    eq(billDetails.taskId, taskId),
    detailPackageType === "打包明细"
      ? eq(orderFiles.detailPackageType, "打包明细")
      : and(eq(billDetails.billDate, detailDate), sql`COALESCE(${orderFiles.detailPackageType}, 'T+1') = 'T+1'`),
    eq(billDetails.ruleId, taskRuleId),
    isNull(billDetails.detailSplitFileId),
    sql`(
      COALESCE(${billDetails.operationStatus}, 'active') = 'active'
      OR ${billDetails.operationStatus} = 'split_replaced'
      OR ${billDetails.ignoreReason} LIKE '已按明细分账拆分认账%'
    )`,
    sql`COALESCE(${orderFiles.uploadStatus}, 'completed') <> 'abnormal'`,
  );
  const [detailSummary] = await db.select({
    total: sql<string>`COALESCE(SUM(CAST(${billDetails.totalAmount} AS DECIMAL(18,2))), 0.00)`,
    count: count(),
  }).from(billDetails).leftJoin(orderFiles, eq(billDetails.orderFileId, orderFiles.id)).where(activeDetailWhere);
  const [recognizedSummary] = await db.select({
    total: sql<string>`COALESCE(SUM(CAST(${billDetails.totalAmount} AS DECIMAL(18,2))), 0.00)`,
    count: count(),
  }).from(billDetails).leftJoin(orderFiles, eq(billDetails.orderFileId, orderFiles.id)).where(and(activeDetailWhere, sql`${billDetails.matchResultId} IS NOT NULL`));
  const [openSummary] = await db.select({ count: count() })
    .from(billDetails)
    .leftJoin(orderFiles, eq(billDetails.orderFileId, orderFiles.id))
    .where(and(activeDetailWhere, sql`${billDetails.matchResultId} IS NULL`));
  const [unmatchedSummary] = await db.select({ count: count() })
    .from(billDetails)
    .leftJoin(orderFiles, eq(billDetails.orderFileId, orderFiles.id))
    .where(and(activeDetailWhere, eq(billDetails.matchStatus, "unmatched")));
  const [pendingSplitSummary] = await db.select({ count: count() })
    .from(billDetails)
    .leftJoin(orderFiles, eq(billDetails.orderFileId, orderFiles.id))
    .where(and(activeDetailWhere, eq(billDetails.matchStatus, "pending_split"), sql`${billDetails.matchResultId} IS NULL`, sql`COALESCE(${billDetails.operationStatus}, 'active') = 'active'`));
  const [bankSummary] = await db.select({
    total: sql<string>`COALESCE(SUM(CAST(${bankFlows.income} AS DECIMAL(18,2))), 0.00)`,
    count: count(),
  }).from(bankFlows).where(and(
    eq(bankFlows.taskId, taskId),
    gt(bankFlows.income, "0"),
    eq(bankFlows.arrivalMatchStatus, "matched"),
    eq(bankFlows.matchedCounterpartyId, Number(task.counterpartyId)),
  ));

  const detailTotal = Number(detailSummary?.total || 0);
  const detailCount = Number(detailSummary?.count || 0);
  const recognizedTotal = Number(recognizedSummary?.total || 0);
  const recognizedCount = Number(recognizedSummary?.count || 0);
  const openCount = Number(openSummary?.count || 0);
  const unmatchedCount = Number(unmatchedSummary?.count || 0);
  const pendingSplitCount = Number(pendingSplitSummary?.count || 0);
  const bankTotal = Number(bankSummary?.total || 0);
  const bankFlowCount = Number(bankSummary?.count || 0);
  const isCompleted = detailCount > 0 && openCount === 0 && Math.abs(recognizedTotal - bankTotal) <= 0.01;
  const status = detailCount === 0
    ? "pending_details"
    : bankFlowCount === 0
      ? "pending_details"
    : detailTotal > bankTotal + 0.01
      ? "large_variance"
      : isCompleted
        ? "completed"
        : recognizedCount > 0
          ? "partial_matched"
          : "pending_details";

  if (isAggregateDetailMode(task)) {
    await syncAggregateDetailFlowStatus(taskId);
  } else {
    await db.update(bankFlows)
      .set({ recognitionStatus: isCompleted ? "recognized" : recognizedTotal > 0.01 ? "partial_matched" : status === "large_variance" ? "large_variance" : "unrecognized" })
      .where(and(
        eq(bankFlows.taskId, taskId),
        gt(bankFlows.income, "0"),
        eq(bankFlows.arrivalMatchStatus, "matched"),
        eq(bankFlows.matchedCounterpartyId, Number(task.counterpartyId)),
      ));
  }

  await db.update(recognitionTasks).set({
    status,
    billDetailTotal: detailTotal.toFixed(2),
    billDetailCount: detailCount,
    diffAmount: bankFlowCount > 0 && detailTotal > bankTotal + 0.01 ? (detailTotal - bankTotal).toFixed(2) : "0.00",
    matchedCount: recognizedCount,
    unmatchedCount,
    pendingSplitCount,
    hasDetailFile: detailCount > 0,
    completedAt: isCompleted ? new Date() : null,
    updatedAt: new Date(),
  }).where(eq(recognitionTasks.id, taskId));
  await refreshRecognitionDateSummariesByTaskIds([taskId]);
}

async function refreshRecognitionTasks(taskIds: number[]) {
  for (const taskId of Array.from(new Set(taskIds.filter(Boolean)))) {
    await refreshRecognitionTaskSummary(taskId);
  }
}

async function resetTaskFlowsByRemainingResults(taskIds: number[]) {
  const db = getDb();
  const uniqueTaskIds = Array.from(new Set(taskIds.filter(Boolean)));
  if (uniqueTaskIds.length === 0) return;

  await db.update(bankFlows)
    .set({ recognitionStatus: "unrecognized" })
    .where(and(inArray(bankFlows.taskId, uniqueTaskIds), gt(bankFlows.income, "0")));

  const recognizedRows = await db
    .select({
      bankFlowId: matchResults.bankFlowId,
      total: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
    })
    .from(matchResults)
    .where(and(
      inArray(matchResults.taskId, uniqueTaskIds),
      sql`${matchResults.bankFlowId} IS NOT NULL`,
      sql`EXISTS (
        SELECT 1
        FROM bank_flows eligible_result_flow
        WHERE eligible_result_flow.id = ${matchResults.bankFlowId}
          AND CAST(eligible_result_flow.income AS DECIMAL(18,2)) > 0
      )`,
    ))
    .groupBy(matchResults.bankFlowId);
  const flowIds = recognizedRows.map((row) => Number(row.bankFlowId || 0)).filter(Boolean);
  if (flowIds.length > 0) {
    const flows = await db.select({ id: bankFlows.id, income: bankFlows.income })
      .from(bankFlows)
      .where(and(inArray(bankFlows.id, flowIds), gt(bankFlows.income, "0")));
    const incomeByFlowId = new Map(flows.map((flow) => [Number(flow.id), Number(flow.income || 0)]));
    for (const row of recognizedRows) {
      const flowId = Number(row.bankFlowId || 0);
      if (!flowId) continue;
      await db.update(bankFlows)
        .set({ recognitionStatus: deriveFlowRecognitionStatus(incomeByFlowId.get(flowId) || 0, Number(row.total || 0)) })
        .where(eq(bankFlows.id, flowId));
    }
  }

  for (const taskId of uniqueTaskIds) {
    await syncAggregateDetailFlowStatus(taskId);
  }
}

async function assertNoCreatedVoucherForResultIds(queryDb: any, matchResultIds: number[]) {
  const uniqueIds = Array.from(new Set(matchResultIds.map(Number).filter(Boolean)));
  if (uniqueIds.length === 0) return;
  for (let i = 0; i < uniqueIds.length; i += 5000) {
    const [result] = await queryDb.select({ count: count() }).from(matchResults).where(and(
      inArray(matchResults.id, uniqueIds.slice(i, i + 5000)),
      eq(matchResults.voucherStatus, "created"),
    ));
    if (Number(result?.count || 0) > 0) {
      throw new Error("该条订单明细已有入账锁定记录，无法删除。");
    }
  }
}

async function deleteInvoiceOnlyOrderFilePackage(
  input: DeletePackageInput,
  setStep: (step: number, message: string) => void = () => {},
): Promise<DeletePackageResult> {
  const db = getDb();
  const billDate = normalizeDate(input.billDate);
  setStep(1, "正在检查不认账订单明细包");
  return db.transaction(async (tx) => {
    const files = await tx
      .select({ id: invoiceOnlyOrderFiles.id })
      .from(invoiceOnlyOrderFiles)
      .where(and(
        eq(invoiceOnlyOrderFiles.ruleId, input.ruleId),
        eq(invoiceOnlyOrderFiles.billDate, billDate),
        input.orderFileId ? eq(invoiceOnlyOrderFiles.id, input.orderFileId) : undefined,
      ));
    const orderFileIds = files.map((file) => Number(file.id)).filter(Boolean);
    if (orderFileIds.length === 0) {
      return { success: true as const, deletedCount: 0, affectedTasks: 0, alreadyDeleted: true };
    }
    const details = await tx
      .select({ id: invoiceOnlyOrderDetails.id })
      .from(invoiceOnlyOrderDetails)
      .where(inArray(invoiceOnlyOrderDetails.orderFileId, orderFileIds));
    const detailIds = details.map((detail) => Number(detail.id)).filter(Boolean);

    const claimSchemaRows = rowsFromExecuteResult(await tx.execute(sql`
      SELECT COUNT(*) AS count
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'invoice_order_claims'
        AND column_name = 'source_type'
    `));
    if (Number(claimSchemaRows[0]?.count || 0) > 0) {
      for (let index = 0; index < detailIds.length; index += 5_000) {
        const chunk = detailIds.slice(index, index + 5_000);
        if (chunk.length === 0) continue;
        const claims = rowsFromExecuteResult(await tx.execute(sql`
          SELECT bill_detail_id AS billDetailId, status
          FROM invoice_order_claims
          WHERE source_type = 'invoice_only'
            AND bill_detail_id IN (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)})
          LIMIT 1
          FOR UPDATE
        `));
        if (claims.length > 0) {
          throw new Error("该不认账订单明细已进入开票申请或已开票，无法删除。");
        }
      }
    }

    setStep(4, "正在删除不认账订单明细包");
    await tx.delete(invoiceOnlyOrderFiles).where(inArray(invoiceOnlyOrderFiles.id, orderFileIds));
    setStep(5, "正在刷新订单明细包列表");
    return {
      success: true as const,
      deletedCount: detailIds.length,
      affectedTasks: 0,
    };
  });
}

async function deleteOrderFilePackage(
  input: DeletePackageInput,
  setStep: (step: number, message: string) => void = () => {},
): Promise<DeletePackageResult> {
  if (input.sourceType === "invoice_only") {
    return deleteInvoiceOnlyOrderFilePackage(input, setStep);
  }
  const db = getDb();
  const billDate = normalizeDate(input.billDate);
  const packageDate = input.detailPackageType === "打包明细" ? billDate : addDays(billDate, 1);
  const isUnmatchedPackage = input.detailPackageType === "打包明细" && isUnmatchedPackageDate(input.billDate);
  const targetTaskDate = getDeleteTargetTaskDate(packageDate, isUnmatchedPackage);

  setStep(1, DELETE_PACKAGE_STEPS[0]);
  const archiveTableNames = isUnmatchedPackage ? [] : await listBillDetailArchiveTableNames(db);
  const transactionResult = await db.transaction(async (tx) => {
    let archiveLockAcquired = false;
    if (archiveTableNames.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(packageDate)) {
      archiveLockAcquired = await acquireBillDetailArchiveDateLock(tx, packageDate);
      if (!archiveLockAcquired) throw new Error("订单明细正在归档，请稍后重试删除");
    }

    try {
      await restoreArchivedPackageToHotTable(tx, archiveTableNames, {
        billDate,
        ruleId: input.ruleId,
        detailPackageType: input.detailPackageType === "打包明细" ? "打包明细" : "T+1",
        orderFileId: input.orderFileId,
      });

      const targetDetailWhere = and(
        input.detailPackageType === "打包明细"
          ? and(eq(orderFiles.detailPackageType, "打包明细"), isUnmatchedPackage ? isNull(orderFiles.uploadDate) : eq(orderFiles.uploadDate, billDate))
          : and(eq(billDetails.billDate, billDate), sql`COALESCE(${orderFiles.detailPackageType}, 'T+1') = 'T+1'`),
        sql`COALESCE(${billDetails.ruleId}, ${orderFiles.ruleId}, 0) = ${input.ruleId}`,
        isNull(billDetails.detailSplitFileId),
        input.orderFileId ? eq(billDetails.orderFileId, input.orderFileId) : undefined,
      );
      const targetDetailRefs = await tx
        .select({
          taskId: billDetails.taskId,
          orderFileId: billDetails.orderFileId,
        })
        .from(billDetails)
        .leftJoin(orderFiles, eq(billDetails.orderFileId, orderFiles.id))
        .where(targetDetailWhere)
        .groupBy(billDetails.taskId, billDetails.orderFileId);

      if (targetDetailRefs.length === 0) {
        const emptyFiles = await tx
          .select({
            id: orderFiles.id,
            taskId: orderFiles.taskId,
            detailCount: count(billDetails.id),
          })
          .from(orderFiles)
          .leftJoin(recognitionTasks, eq(orderFiles.taskId, recognitionTasks.id))
          .leftJoin(billDetails, eq(billDetails.orderFileId, orderFiles.id))
          .where(and(
            input.detailPackageType === "打包明细"
              ? and(eq(orderFiles.detailPackageType, "打包明细"), isUnmatchedPackage ? isNull(orderFiles.uploadDate) : eq(orderFiles.uploadDate, billDate))
              : and(eq(recognitionTasks.billDate, packageDate), sql`COALESCE(${orderFiles.detailPackageType}, 'T+1') = 'T+1'`),
            eq(orderFiles.ruleId, input.ruleId),
            input.orderFileId ? eq(orderFiles.id, input.orderFileId) : undefined,
          ))
          .groupBy(orderFiles.id, orderFiles.taskId);
        const deletableEmptyFiles = emptyFiles.filter((item) => Number(item.detailCount || 0) === 0);
        if (deletableEmptyFiles.length === 0) {
          return {
            kind: "already_deleted" as const,
            deletedCount: 0,
            orderFileIds: [] as number[],
            affectedTaskIds: [] as number[],
            rollbackTaskIds: [] as number[],
            affectedDetailSplitFileIds: [] as number[],
            releasedMultiDayGroupIds: [] as number[],
            releasedMultiDayOrderFileIds: [] as number[],
          };
        }
        const emptyOrderFileIds = deletableEmptyFiles.map((item) => Number(item.id)).filter(Boolean);
        const emptyTaskIds = Array.from(new Set(deletableEmptyFiles.map((item) => Number(item.taskId || 0)).filter(Boolean)));
        await deleteManualOrderWorkItemsByOrderFileIds(tx, emptyOrderFileIds);
        await clearOrderFilePartitionsByOrderFileIds(tx, emptyOrderFileIds);
        await tx.delete(orderFiles).where(inArray(orderFiles.id, emptyOrderFileIds));
        return {
          kind: "empty" as const,
          deletedCount: 0,
          orderFileIds: emptyOrderFileIds,
          affectedTaskIds: emptyTaskIds,
          rollbackTaskIds: emptyTaskIds,
          affectedDetailSplitFileIds: [] as number[],
          releasedMultiDayGroupIds: [] as number[],
          releasedMultiDayOrderFileIds: [] as number[],
        };
      }

      const orderFileIds = Array.from(new Set(targetDetailRefs.map((item) => Number(item.orderFileId || 0)).filter(Boolean)));
      const deletionTaskIds = Array.from(new Set(targetDetailRefs.map((item) => Number(item.taskId || 0)).filter(Boolean)));
      const sourceDetailWhere = and(
        inArray(billDetails.orderFileId, orderFileIds),
        input.detailPackageType === "打包明细" ? undefined : eq(billDetails.billDate, billDate),
        isNull(billDetails.detailSplitFileId),
      );
      const [detailCountRow] = await tx.select({ count: count() }).from(billDetails).where(sourceDetailWhere);
      const sourcePartitionRows = await tx
        .select({
          orderFileId: billDetails.orderFileId,
          partitionDate: billDetails.partitionDate,
          detailCount: count(),
        })
        .from(billDetails)
        .where(sourceDetailWhere)
        .groupBy(billDetails.orderFileId, billDetails.partitionDate);
      const sourceMatchResultRows = await tx
        .select({ matchResultId: billDetails.matchResultId })
        .from(billDetails)
        .where(and(sourceDetailWhere, sql`${billDetails.matchResultId} IS NOT NULL`))
        .groupBy(billDetails.matchResultId);
      const affectedMatchResultIds = new Set<number>(sourceMatchResultRows.map((item) => Number(item.matchResultId || 0)).filter(Boolean));
      const groupRows = await tx.select({ groupId: orderFiles.multiDayMatchGroupId })
        .from(orderFiles)
        .where(inArray(orderFiles.id, orderFileIds));
      const releasedMultiDayGroupIds = Array.from(new Set(groupRows
        .map((row) => Number(row.groupId || 0))
        .filter(Boolean)));
      const releasedMultiDayOrderFileIds = new Set<number>();
      const releasedMultiDayFlowIds = new Set<number>();
      const releasedMultiDayTaskIds = new Set<number>();
      for (const groupId of releasedMultiDayGroupIds) {
        const allGroupFiles = await tx.select({ id: orderFiles.id })
          .from(orderFiles)
          .where(eq(orderFiles.multiDayMatchGroupId, groupId));
        allGroupFiles.forEach((row) => releasedMultiDayOrderFileIds.add(Number(row.id)));
        const groupFlows = await tx
          .select({ bankFlowId: multiDayMatchGroupFlows.bankFlowId, taskId: bankFlows.taskId })
          .from(multiDayMatchGroupFlows)
          .innerJoin(bankFlows, eq(bankFlows.id, multiDayMatchGroupFlows.bankFlowId))
          .where(eq(multiDayMatchGroupFlows.groupId, groupId));
        groupFlows.forEach((row) => {
          releasedMultiDayFlowIds.add(Number(row.bankFlowId));
          releasedMultiDayTaskIds.add(Number(row.taskId));
        });
      }
      if (releasedMultiDayFlowIds.size > 0) {
        const groupResultRows = await tx.select({ id: matchResults.id })
          .from(matchResults)
          .where(inArray(matchResults.bankFlowId, Array.from(releasedMultiDayFlowIds)));
        groupResultRows.forEach((row) => affectedMatchResultIds.add(Number(row.id)));
      }
      const sourceDetails = sql.raw("source_details");
      const linkedSplitRows = await tx.execute(sql`
        SELECT
          linked_detail.id AS id,
          linked_detail.detail_split_file_id AS detailSplitFileId,
          linked_detail.match_result_id AS matchResultId,
          linked_detail.partition_date AS partitionDate
        FROM bill_details linked_detail
        INNER JOIN bill_details ${sourceDetails} ON linked_detail.split_source_detail_id = ${sourceDetails}.id
        WHERE ${sourceDetails}.order_file_id IN (${sql.join(orderFileIds.map((id) => sql`${id}`), sql`, `)})
          ${input.detailPackageType === "打包明细" ? sql`` : sql`AND ${sourceDetails}.bill_date = ${billDate}`}
          AND ${sourceDetails}.detail_split_file_id IS NULL
          AND linked_detail.detail_split_file_id IS NOT NULL
      `);
      const linkedRows = rowsFromExecuteResult(linkedSplitRows);
      const affectedDetailSplitFileIds = new Set<number>();
      const linkedSplitDetailIds: number[] = [];
      const archiveSnapshotDates = new Set(sourcePartitionRows.map((row) => String(row.partitionDate || "")));
      for (const row of linkedRows as any[]) {
        const splitFileId = Number(row.detailSplitFileId || 0);
        if (splitFileId) affectedDetailSplitFileIds.add(splitFileId);
        const detailId = Number(row.id || 0);
        if (detailId) linkedSplitDetailIds.push(detailId);
        const resultId = Number(row.matchResultId || 0);
        if (resultId) affectedMatchResultIds.add(resultId);
        if (row.partitionDate) archiveSnapshotDates.add(String(row.partitionDate));
      }

      const affectedTaskIds = new Set(deletionTaskIds);
      releasedMultiDayTaskIds.forEach((taskId) => affectedTaskIds.add(taskId));
      const targetTasks = targetTaskDate
        ? await tx.select({ id: recognitionTasks.id })
          .from(recognitionTasks)
          .where(and(eq(recognitionTasks.billDate, targetTaskDate), eq(recognitionTasks.ruleId, input.ruleId)))
        : [];
      targetTasks.forEach((task) => affectedTaskIds.add(Number(task.id)));
      const rollbackTaskIds = Array.from(affectedTaskIds);
      const resultIds = Array.from(affectedMatchResultIds);
      await assertNoCreatedVoucherForResultIds(tx, resultIds);

      setStep(2, DELETE_PACKAGE_STEPS[1]);
      for (let i = 0; i < linkedSplitDetailIds.length; i += 5000) {
        await tx.update(billDetails).set({
          taskId: 0,
          orderFileId: null,
          splitSourceDetailId: null,
          billDate: "1970-01-01",
          partitionDate: "1970-01-01",
          lifecycleStatus: "unmatched_package",
          matchResultId: sql`NULL`,
        }).where(inArray(billDetails.id, linkedSplitDetailIds.slice(i, i + 5000)));
      }

      setStep(3, DELETE_PACKAGE_STEPS[2]);
      for (let i = 0; i < resultIds.length; i += 5000) {
        await tx.delete(matchResults).where(inArray(matchResults.id, resultIds.slice(i, i + 5000)));
      }

      if (releasedMultiDayGroupIds.length > 0) {
        const allGroupOrderFileIds = Array.from(releasedMultiDayOrderFileIds);
        if (allGroupOrderFileIds.length > 0) {
          await tx.update(billDetails).set({
            taskId: 0,
            billDate: "1970-01-01",
            partitionDate: "1970-01-01",
            lifecycleStatus: "unmatched_package",
            matchResultId: sql`NULL`,
          }).where(and(
            inArray(billDetails.orderFileId, allGroupOrderFileIds),
            isNull(billDetails.detailSplitFileId),
          ));
          await tx.update(orderFiles).set({
            taskId: 0,
            uploadDate: null,
          }).where(inArray(orderFiles.id, allGroupOrderFileIds));
        }
        await tx.delete(multiDayMatchGroupFlows)
          .where(inArray(multiDayMatchGroupFlows.groupId, releasedMultiDayGroupIds));
        await tx.update(multiDayMatchGroups).set({
          status: "unmatched",
          anchorTaskId: null,
          latestBillDate: null,
          updatedAt: new Date(),
        }).where(inArray(multiDayMatchGroups.id, releasedMultiDayGroupIds));
      }

      setStep(4, DELETE_PACKAGE_STEPS[3]);
      await deleteManualOrderWorkItemsByOrderFileIds(tx, orderFileIds);
      for (let i = 0; i < orderFileIds.length; i += 5000) {
        const chunk = orderFileIds.slice(i, i + 5000);
        await applyOrderFilePartitionDeltas(tx, sourcePartitionRows
          .filter((row) => chunk.includes(Number(row.orderFileId || 0)))
          .map((row) => ({
            orderFileId: Number(row.orderFileId || 0),
            partitionDate: String(row.partitionDate || ""),
            delta: -Number(row.detailCount || 0),
          })));
        await tx.delete(billDetails).where(and(
          inArray(billDetails.orderFileId, chunk),
          input.detailPackageType === "打包明细" ? undefined : eq(billDetails.billDate, billDate),
          isNull(billDetails.detailSplitFileId),
        ));
      }
      await refreshArchiveRunSnapshots(tx, archiveTableNames, Array.from(archiveSnapshotDates));

      return {
        kind: "deleted" as const,
        deletedCount: Number(detailCountRow?.count || 0),
        orderFileIds,
        affectedTaskIds: Array.from(affectedTaskIds),
        rollbackTaskIds,
        affectedDetailSplitFileIds: Array.from(affectedDetailSplitFileIds),
        releasedMultiDayGroupIds,
        releasedMultiDayOrderFileIds: Array.from(releasedMultiDayOrderFileIds),
      };
    } finally {
      if (archiveLockAcquired) {
        await releaseBillDetailArchiveDateLock(tx, packageDate).catch(() => undefined);
      }
    }
  });

  if (transactionResult.kind === "already_deleted") {
    return { success: true, deletedCount: 0, affectedTasks: 0, alreadyDeleted: true };
  }

  setStep(5, DELETE_PACKAGE_STEPS[4]);
  try {
    for (const orderFileId of transactionResult.orderFileIds) {
      await refreshOrderFileSummary(orderFileId);
    }
    await resetTaskFlowsByRemainingResults(transactionResult.rollbackTaskIds);
    await refreshRecognitionTasks(transactionResult.affectedTaskIds);
    await refreshDetailSplitFileSummaries(transactionResult.affectedDetailSplitFileIds);
    if (transactionResult.releasedMultiDayOrderFileIds.length > 0) {
      await clearOrderFilePartitionsByOrderFileIds(db, transactionResult.releasedMultiDayOrderFileIds);
      for (const orderFileId of transactionResult.releasedMultiDayOrderFileIds) {
        await syncOrderFilePartitionsByOrderFileId(db, orderFileId);
      }
    }
    for (const groupId of transactionResult.releasedMultiDayGroupIds) {
      await cleanupEmptyMultiDayMatchGroup(groupId);
      const [remaining] = await db.select({ count: count() })
        .from(orderFiles)
        .where(eq(orderFiles.multiDayMatchGroupId, groupId));
      if (Number(remaining?.count || 0) > 0) {
        await refreshMultiDayMatchGroupTotal(groupId);
        await evaluateMultiDayMatchGroup({ groupId });
      }
    }
  } catch (err) {
    console.error("[order-files/delete-package] 删除已提交，刷新汇总失败:", err);
  }

  return {
    success: true,
    deletedCount: transactionResult.deletedCount,
    affectedTasks: transactionResult.affectedTaskIds.length,
  };
}

async function enqueueDeleteOrderFilePackage(
  input: DeletePackageInput,
  setStep: (step: number, message: string) => void = () => {},
) {
  setStep(1, "正在等待认账任务完成");
  return enqueueDbHeavyJob({
    key: input.sourceType === "invoice_only"
      ? `invoice-only-order-file-delete:${input.ruleId}:${input.billDate}:${input.orderFileId || "all"}`
      : getOrderFileDeleteDbHeavyJobKey({
        ...input,
        detailPackageType: input.detailPackageType === "打包明细" ? "打包明细" : "T+1",
      }),
    type: "order-file-delete",
    run: () => deleteOrderFilePackage(input, setStep),
  });
}

async function runDeletePackageSession(deleteId: string, input: DeletePackageInput) {
  try {
    const result = await enqueueDeleteOrderFilePackage(input, (step, message) => {
      updateDeletePackageSession(deleteId, { step, message, status: "running" });
    });
    updateDeletePackageSession(deleteId, {
      status: "completed",
      step: DELETE_PACKAGE_STEPS.length,
      message: result.alreadyDeleted ? "订单明细包已删除，正在刷新列表" : "删除完成，正在刷新列表",
      deletedCount: result.deletedCount,
      affectedTasks: result.affectedTasks,
      completedAt: Date.now(),
    });
  } catch (err: any) {
    updateDeletePackageSession(deleteId, {
      status: "failed",
      message: "删除失败",
      error: err?.message || "删除失败",
      completedAt: Date.now(),
    });
  }
}

export const orderFileRouter = createRouter({
  uploadRuleOptions: authedQuery.query(async () => {
    const db = getDb();
    const [rules, itemCounts, counterparties, invoiceOnlyRuleOptions] = await Promise.all([
      db
        .select({
          id: recognitionRules.id,
          ruleName: recognitionRules.ruleName,
          matchedCounterpartyAlias: recognitionRules.matchedCounterpartyAlias,
        })
        .from(recognitionRules)
        .where(eq(recognitionRules.isActive, true))
        .orderBy(desc(recognitionRules.createdAt)),
      db
        .select({
          ruleId: ruleItems.ruleId,
          itemCount: count(),
        })
        .from(ruleItems)
        .innerJoin(recognitionRules, eq(recognitionRules.id, ruleItems.ruleId))
        .where(eq(recognitionRules.isActive, true))
        .groupBy(ruleItems.ruleId),
      db
        .select({
          alias: counterpartyRecords.alias,
          detailPackageType: counterpartyRecords.detailPackageType,
          detailMatchingMode: counterpartyRecords.detailMatchingMode,
        })
        .from(counterpartyRecords)
        .where(eq(counterpartyRecords.recognitionType, "明细认账")),
      db
        .select({
          id: invoiceOnlyRules.id,
          ruleName: invoiceOnlyRules.ruleName,
        })
        .from(invoiceOnlyRules)
        .where(eq(invoiceOnlyRules.isActive, true))
        .orderBy(desc(invoiceOnlyRules.createdAt)),
    ]);

    const itemCountByRuleId = new Map(
      itemCounts.map((item) => [Number(item.ruleId), Number(item.itemCount || 0)]),
    );
    const counterpartyByAlias = new Map(
      counterparties.map((item) => [item.alias, item]),
    );

    return {
      recognitionRules: rules.map((rule) => {
        const counterparty = rule.matchedCounterpartyAlias
          ? counterpartyByAlias.get(rule.matchedCounterpartyAlias)
          : undefined;
        return {
          id: Number(rule.id),
          ruleName: rule.ruleName,
          itemCount: itemCountByRuleId.get(Number(rule.id)) || 0,
          detailPackageType: counterparty?.detailPackageType || null,
          detailMatchingMode: counterparty?.detailMatchingMode || null,
        };
      }),
      invoiceOnlyRules: invoiceOnlyRuleOptions.map((rule) => ({
        id: Number(rule.id),
        ruleName: rule.ruleName,
      })),
    };
  }),

  list: authedQuery
    .input(
      z.object({
        search: z.string().optional(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(50).default(20),
      }).optional(),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const search = input?.search?.trim();
      const detailDateSql = sql<string>`CASE
        WHEN ${orderFiles.detailPackageType} = '打包明细' THEN COALESCE(${orderFiles.uploadDate}, '-')
        ELSE COALESCE(
          DATE_FORMAT(DATE_SUB(${recognitionTasks.billDate}, INTERVAL 1 DAY), '%Y-%m-%d'),
          ${orderFiles.uploadDate},
          DATE_FORMAT(${orderFiles.createdAt}, '%Y-%m-%d')
        )
      END`;
      const where = search
        ? or(
            like(orderFiles.fileName, `%${search}%`),
            like(recognitionRules.ruleName, `%${search}%`),
            like(recognitionTasks.billDate, `%${search}%`),
            sql`${detailDateSql} LIKE ${`%${search}%`}`,
            like(users.username, `%${search}%`),
            like(users.name, `%${search}%`),
        )
        : undefined;
      const page = input?.page || 1;
      const pageSize = input?.pageSize || 20;
      const fetchLimit = page * pageSize;
      const recognitionItems = await db
        .select({
          sourceType: sql<string>`'recognition'`,
          billDate: detailDateSql,
          detailPackageType: orderFiles.detailPackageType,
          ruleId: orderFiles.ruleId,
          ruleName: recognitionRules.ruleName,
          entryCount: sql<number>`COALESCE(SUM(${orderFiles.entryCount}), 0)`,
          orderTotalAmount: sql<string>`COALESCE(SUM(CAST(${orderFiles.orderTotalAmount} AS DECIMAL(18,2))), 0.00)`,
          refundAmount: sql<string>`COALESCE(SUM(CAST(${orderFiles.refundAmount} AS DECIMAL(18,2))), 0.00)`,
          fileCount: sql<number>`COUNT(DISTINCT ${orderFiles.id})`,
          primaryFileId: sql<number>`MIN(${orderFiles.id})`,
          fileNames: sql<string>`GROUP_CONCAT(DISTINCT ${orderFiles.fileName} ORDER BY ${orderFiles.createdAt} SEPARATOR '||')`,
          fileOptions: sql<string>`GROUP_CONCAT(CONCAT(${orderFiles.id}, '::', ${orderFiles.fileName}) ORDER BY ${orderFiles.createdAt} SEPARATOR '||')`,
          uploadInfos: sql<string>`GROUP_CONCAT(DISTINCT CONCAT(COALESCE(${users.name}, ${users.username}, '-'), ' @ ', DATE_FORMAT(${orderFiles.createdAt}, '%Y-%m-%d %H:%i:%s')) ORDER BY ${orderFiles.createdAt} SEPARATOR '||')`,
          uploadFileInfos: sql<string>`GROUP_CONCAT(CONCAT(COALESCE(${users.name}, ${users.username}, '-'), ' @ ', DATE_FORMAT(${orderFiles.createdAt}, '%Y-%m-%d %H:%i:%s'), '::', ${orderFiles.fileName}) ORDER BY ${orderFiles.createdAt} SEPARATOR '||')`,
          processingCount: sql<number>`SUM(CASE WHEN ${orderFiles.uploadStatus} = 'processing' THEN 1 ELSE 0 END)`,
          failedCount: sql<number>`SUM(CASE WHEN ${orderFiles.uploadStatus} = 'failed' THEN 1 ELSE 0 END)`,
          abnormalCount: sql<number>`SUM(CASE WHEN ${orderFiles.uploadStatus} = 'abnormal' THEN 1 ELSE 0 END)`,
          matchedCount: sql<number>`COALESCE(SUM(${orderFiles.matchedCount}), 0)`,
          unmatchedCount: sql<number>`COALESCE(SUM(${orderFiles.unmatchedCount}), 0)`,
          pendingSplitCount: sql<number>`COALESCE(SUM(${orderFiles.pendingSplitCount}), 0)`,
          unboundPackageCount: sql<number>`SUM(CASE WHEN ${orderFiles.detailPackageType} = '打包明细' AND ${orderFiles.multiDayMatchGroupId} IS NULL AND (${orderFiles.uploadDate} IS NULL OR ${orderFiles.taskId} = 0) THEN 1 ELSE 0 END)`,
          multiDayMatchGroupId: sql<number>`MAX(COALESCE(${orderFiles.multiDayMatchGroupId}, 0))`,
          multiDayMatchStatus: sql<string>`CASE
            WHEN MAX(CASE WHEN ${multiDayMatchGroups.status} = 'pending_confirmation' THEN 1 ELSE 0 END) = 1 THEN 'pending_confirmation'
            WHEN MAX(CASE WHEN ${multiDayMatchGroups.status} = 'unmatched' THEN 1 ELSE 0 END) = 1 THEN 'unmatched'
            WHEN MAX(CASE WHEN ${multiDayMatchGroups.status} = 'matched' THEN 1 ELSE 0 END) = 1 THEN 'matched'
            ELSE NULL
          END`,
          latestUploadedAt: sql<string>`MAX(${orderFiles.createdAt})`,
        })
        .from(orderFiles)
        .leftJoin(recognitionTasks, eq(orderFiles.taskId, recognitionTasks.id))
        .leftJoin(recognitionRules, eq(orderFiles.ruleId, recognitionRules.id))
        .leftJoin(users, eq(orderFiles.uploaderId, users.id))
        .leftJoin(multiDayMatchGroups, eq(orderFiles.multiDayMatchGroupId, multiDayMatchGroups.id))
        .where(where)
        .groupBy(detailDateSql, orderFiles.detailPackageType, orderFiles.ruleId, recognitionRules.ruleName)
        .orderBy(desc(detailDateSql), desc(sql`MAX(${orderFiles.createdAt})`))
        .limit(fetchLimit);

      const countResult = await db
        .select({
          count: sql<number>`COUNT(DISTINCT CONCAT(${detailDateSql}, '|', COALESCE(${orderFiles.detailPackageType}, 'T+1'), '|', COALESCE(${orderFiles.ruleId}, 0)))`,
        })
        .from(orderFiles)
        .leftJoin(recognitionTasks, eq(orderFiles.taskId, recognitionTasks.id))
        .leftJoin(recognitionRules, eq(orderFiles.ruleId, recognitionRules.id))
        .leftJoin(users, eq(orderFiles.uploaderId, users.id))
        .where(where);

      const invoiceOnlyWhere = search
        ? or(
          like(invoiceOnlyOrderFiles.fileName, `%${search}%`),
          like(invoiceOnlyRules.ruleName, `%${search}%`),
          like(invoiceOnlyOrderFiles.billDate, `%${search}%`),
          like(users.username, `%${search}%`),
          like(users.name, `%${search}%`),
        )
        : undefined;
      const invoiceOnlyItems = await db
        .select({
          sourceType: sql<string>`'invoice_only'`,
          billDate: invoiceOnlyOrderFiles.billDate,
          detailPackageType: sql<string>`'不认账'`,
          ruleId: invoiceOnlyOrderFiles.ruleId,
          ruleName: invoiceOnlyRules.ruleName,
          entryCount: sql<number>`COALESCE(SUM(${invoiceOnlyOrderFiles.entryCount}), 0)`,
          orderTotalAmount: sql<string>`COALESCE(SUM(CAST(${invoiceOnlyOrderFiles.orderTotalAmount} AS DECIMAL(18,2))), 0.00)`,
          refundAmount: sql<string>`'0.00'`,
          fileCount: sql<number>`COUNT(DISTINCT ${invoiceOnlyOrderFiles.id})`,
          primaryFileId: sql<number>`MIN(${invoiceOnlyOrderFiles.id})`,
          fileNames: sql<string>`GROUP_CONCAT(DISTINCT ${invoiceOnlyOrderFiles.fileName} ORDER BY ${invoiceOnlyOrderFiles.createdAt} SEPARATOR '||')`,
          fileOptions: sql<string>`GROUP_CONCAT(CONCAT(${invoiceOnlyOrderFiles.id}, '::', ${invoiceOnlyOrderFiles.fileName}) ORDER BY ${invoiceOnlyOrderFiles.createdAt} SEPARATOR '||')`,
          uploadInfos: sql<string>`GROUP_CONCAT(DISTINCT CONCAT(COALESCE(${users.name}, ${users.username}, '-'), ' @ ', DATE_FORMAT(${invoiceOnlyOrderFiles.createdAt}, '%Y-%m-%d %H:%i:%s')) ORDER BY ${invoiceOnlyOrderFiles.createdAt} SEPARATOR '||')`,
          uploadFileInfos: sql<string>`GROUP_CONCAT(CONCAT(COALESCE(${users.name}, ${users.username}, '-'), ' @ ', DATE_FORMAT(${invoiceOnlyOrderFiles.createdAt}, '%Y-%m-%d %H:%i:%s'), '::', ${invoiceOnlyOrderFiles.fileName}) ORDER BY ${invoiceOnlyOrderFiles.createdAt} SEPARATOR '||')`,
          processingCount: sql<number>`SUM(CASE WHEN ${invoiceOnlyOrderFiles.uploadStatus} = 'processing' THEN 1 ELSE 0 END)`,
          failedCount: sql<number>`SUM(CASE WHEN ${invoiceOnlyOrderFiles.uploadStatus} = 'failed' THEN 1 ELSE 0 END)`,
          abnormalCount: sql<number>`0`,
          matchedCount: sql<number>`0`,
          unmatchedCount: sql<number>`0`,
          pendingSplitCount: sql<number>`0`,
          unboundPackageCount: sql<number>`0`,
          multiDayMatchGroupId: sql<number>`0`,
          multiDayMatchStatus: sql<string>`NULL`,
          latestUploadedAt: sql<string>`MAX(${invoiceOnlyOrderFiles.createdAt})`,
        })
        .from(invoiceOnlyOrderFiles)
        .leftJoin(invoiceOnlyRules, eq(invoiceOnlyOrderFiles.ruleId, invoiceOnlyRules.id))
        .leftJoin(users, eq(invoiceOnlyOrderFiles.uploaderId, users.id))
        .where(invoiceOnlyWhere)
        .groupBy(invoiceOnlyOrderFiles.billDate, invoiceOnlyOrderFiles.ruleId, invoiceOnlyRules.ruleName)
        .orderBy(desc(invoiceOnlyOrderFiles.billDate), desc(sql`MAX(${invoiceOnlyOrderFiles.createdAt})`))
        .limit(fetchLimit);
      const invoiceOnlyCountResult = await db
        .select({
          count: sql<number>`COUNT(DISTINCT CONCAT(${invoiceOnlyOrderFiles.billDate}, '|', ${invoiceOnlyOrderFiles.ruleId}))`,
        })
        .from(invoiceOnlyOrderFiles)
        .leftJoin(invoiceOnlyRules, eq(invoiceOnlyOrderFiles.ruleId, invoiceOnlyRules.id))
        .leftJoin(users, eq(invoiceOnlyOrderFiles.uploaderId, users.id))
        .where(invoiceOnlyWhere);

      const items = [...(recognitionItems as any[]), ...(invoiceOnlyItems as any[])]
        .sort((a, b) => {
          const dateOrder = String(b.billDate || "").localeCompare(String(a.billDate || ""));
          if (dateOrder !== 0) return dateOrder;
          return String(b.latestUploadedAt || "").localeCompare(String(a.latestUploadedAt || ""));
        })
        .slice((page - 1) * pageSize, page * pageSize);

      return {
        items,
        total: Number(countResult[0]?.count || 0) + Number(invoiceOnlyCountResult[0]?.count || 0),
        page,
        pageSize,
      };
    }),

  getMultiDayMatchCandidates: authedQuery
    .input(z.object({ groupId: z.number().min(1) }))
    .query(async ({ input }) => {
      const db = getDb();
      const [group] = await db
        .select({
          id: multiDayMatchGroups.id,
          status: multiDayMatchGroups.status,
          ruleId: multiDayMatchGroups.ruleId,
          ruleName: recognitionRules.ruleName,
          packageTotal: multiDayMatchGroups.packageTotal,
        })
        .from(multiDayMatchGroups)
        .leftJoin(recognitionRules, eq(recognitionRules.id, multiDayMatchGroups.ruleId))
        .where(eq(multiDayMatchGroups.id, input.groupId));
      if (!group) throw new Error("多日汇总订单包不存在");
      const candidates = await findMultiDayMatchCandidates({ groupId: input.groupId });
      return { ...group, ...candidates };
    }),

  confirmMultiDayMatch: authedQuery
    .input(z.object({
      groupId: z.number().min(1),
      flowIds: z.array(z.number().min(1)).min(1),
    }))
    .mutation(async ({ input }) => confirmMultiDayMatch(input)),

  getById: authedQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const file = await db.query.orderFiles.findFirst({
        where: eq(orderFiles.id, input.id),
        with: {
          task: true,
          uploader: {
            columns: {
              id: true,
              username: true,
              name: true,
            },
          },
        },
      });
      if (!file) throw new Error("订单文件不存在");

      return {
        ...file,
        orderTotalAmount: Number(file.orderTotalAmount || 0).toFixed(2),
        refundAmount: Number(file.refundAmount || 0).toFixed(2),
      };
    }),

  getDetails: authedQuery
    .input(
      z.object({
        orderFileId: z.number(),
        packageScope: z.object({
          billDate: z.string(),
          ruleId: z.number(),
          detailPackageType: z.enum(["T+1", "打包明细"]).default("T+1"),
        }).optional(),
        matchStatus: z.enum(["matched", "unmatched", "pending_split", "unmatched_with_pending_split"]).optional(),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(500).default(100),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      if (
        input.packageScope
        && !(input.packageScope.detailPackageType === "打包明细" && isUnmatchedPackageDate(input.packageScope.billDate))
      ) {
        const billDate = normalizeDate(input.packageScope.billDate);
        return listOrderFilePackageBillDetails(db, {
          partitionDate: getPackageScopePartitionDate({
            billDate,
            detailPackageType: input.packageScope.detailPackageType,
          }),
          packageBillDate: billDate,
          detailPackageType: input.packageScope.detailPackageType,
          ruleId: input.packageScope.ruleId,
          matchStatus: input.matchStatus,
          page: input.page,
          pageSize: input.pageSize,
        });
      }
      if (!input.packageScope) {
        return listOrderFileBillDetails(db, {
          orderFileId: input.orderFileId,
          matchStatus: input.matchStatus,
          page: input.page,
          pageSize: input.pageSize,
        });
      }
      const conditions = [];
      const scopeConditions = [];
      if (input.packageScope) {
        const billDate = normalizeDate(input.packageScope.billDate);
        scopeConditions.push(
          input.packageScope.detailPackageType === "打包明细"
            ? and(
              eq(orderFiles.detailPackageType, "打包明细"),
              isUnmatchedPackageDate(input.packageScope.billDate) ? isNull(orderFiles.uploadDate) : eq(orderFiles.uploadDate, billDate),
            )
            : and(eq(billDetails.billDate, billDate), sql`COALESCE(${orderFiles.detailPackageType}, 'T+1') = 'T+1'`),
        );
        scopeConditions.push(sql`COALESCE(${billDetails.ruleId}, ${orderFiles.ruleId}, 0) = ${input.packageScope.ruleId}`);
        conditions.push(...scopeConditions);
      } else {
        scopeConditions.push(eq(billDetails.orderFileId, input.orderFileId));
        conditions.push(...scopeConditions);
      }
      conditions.push(isNull(billDetails.detailSplitFileId));
      if (input.matchStatus === "unmatched_with_pending_split") {
        conditions.push(inArray(billDetails.matchStatus, ["unmatched", "pending_split"]));
      } else if (input.matchStatus) {
        conditions.push(eq(billDetails.matchStatus, input.matchStatus));
      }
      const whereClause = and(...conditions);
      const items = await db
        .select({
          id: billDetails.id,
          billDate: billDetails.billDate,
          description: billDetails.description,
          totalAmount: billDetails.totalAmount,
          rawData: billDetails.rawData,
          matchStatus: billDetails.matchStatus,
          operationStatus: billDetails.operationStatus,
          ignoreReason: billDetails.ignoreReason,
        })
        .from(billDetails)
        .leftJoin(orderFiles, eq(billDetails.orderFileId, orderFiles.id))
        .where(whereClause)
        .orderBy(billDetails.id)
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);

      const countResult = await db
        .select({ count: count() })
        .from(billDetails)
        .leftJoin(orderFiles, eq(billDetails.orderFileId, orderFiles.id))
        .where(whereClause);
      const summaryWhere = and(...scopeConditions);
      const [summary] = await db
        .select({
          entryCount: count(),
          orderTotalAmount: sql<string>`COALESCE(SUM(CASE WHEN CAST(${billDetails.refundAmountSnapshot} AS DECIMAL(18,2)) > 0 THEN 0 ELSE CAST(${billDetails.totalAmount} AS DECIMAL(18,2)) END), 0.00)`,
          refundAmount: sql<string>`COALESCE(SUM(CAST(${billDetails.refundAmountSnapshot} AS DECIMAL(18,2))), 0.00)`,
          matchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'matched' THEN 1 ELSE 0 END)`,
          unmatchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'unmatched' THEN 1 ELSE 0 END)`,
          pendingSplitCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'pending_split' THEN 1 ELSE 0 END)`,
        })
        .from(billDetails)
        .leftJoin(orderFiles, eq(billDetails.orderFileId, orderFiles.id))
        .where(and(summaryWhere, isNull(billDetails.detailSplitFileId)));

      return {
        items,
        total: Number(countResult[0]?.count || 0),
        summary: {
          entryCount: Number(summary?.entryCount || 0),
          orderTotalAmount: Number(summary?.orderTotalAmount || 0).toFixed(2),
          refundAmount: Number(summary?.refundAmount || 0).toFixed(2),
          matchedCount: Number(summary?.matchedCount || 0),
          unmatchedCount: Number(summary?.unmatchedCount || 0),
          pendingSplitCount: Number(summary?.pendingSplitCount || 0),
        },
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  matchPackageBankFlow: authedQuery
    .input(z.object({
      ruleId: z.number(),
      orderFileId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const ruleId = Number(input.ruleId || 0);
      if (!ruleId) throw new Error("请选择明细认账规则");

      const [rule] = await db
        .select({
          id: recognitionRules.id,
          matchedCounterpartyAlias: recognitionRules.matchedCounterpartyAlias,
        })
        .from(recognitionRules)
        .where(eq(recognitionRules.id, ruleId));
      if (!rule?.matchedCounterpartyAlias) throw new Error("所选明细认账规则未配置匹配到账信息");

      const [counterpartyRow] = await db
        .select()
        .from(counterpartyRecords)
        .where(eq(counterpartyRecords.alias, rule.matchedCounterpartyAlias));
      const counterparty = await attachCounterpartyMatchers(db, counterpartyRow);
      if (!counterparty) throw new Error("所选明细认账规则的匹配到账信息不存在");

      const files = await db
        .select({ id: orderFiles.id, multiDayMatchGroupId: orderFiles.multiDayMatchGroupId })
        .from(orderFiles)
        .where(and(
          eq(orderFiles.ruleId, ruleId),
          eq(orderFiles.detailPackageType, "打包明细"),
          isNull(orderFiles.uploadDate),
          input.orderFileId ? eq(orderFiles.id, input.orderFileId) : undefined,
          sql`${orderFiles.uploadStatus} <> 'abnormal'`,
        ));
      const orderFileIds = files.map((file) => Number(file.id)).filter(Boolean);
      if (orderFileIds.length === 0) throw new Error("没有待匹配流水的打包明细包");

      if (isMultiDayDetailCounterparty(counterparty)) {
        const groupIds = Array.from(new Set(files
          .map((file) => Number(file.multiDayMatchGroupId || 0))
          .filter(Boolean)));
        if (groupIds.length !== 1) throw new Error("多日汇总订单包状态异常，请刷新后重试");
        const result = await evaluateMultiDayMatchGroup({ groupId: groupIds[0] });
        return {
          success: true,
          ...result,
          billDate: result.status === "matched" ? result.billDate : "-",
          orderFileCount: orderFileIds.length,
        };
      }

      const located = await findEarliestUnrecognizedBankFlowTask(counterparty);
      if (!located) throw new Error("暂无符合该到账信息的未认账银行流水");
      const sameDayResolved = isAggregateDetailMode(counterparty)
        ? await ensureSameDayAggregateTask({
          billDate: located.billDate,
          counterparty,
          creatorId: Number((await db.select({ creatorId: recognitionTasks.creatorId })
            .from(recognitionTasks)
            .where(eq(recognitionTasks.id, located.taskId)))[0]?.creatorId || 0),
          ruleId,
          preferredTaskId: located.taskId,
        })
        : null;
      const targetTaskId = sameDayResolved?.taskId || located.taskId;

      await db.update(recognitionTasks).set({
        ruleId,
        updatedAt: new Date(),
      }).where(eq(recognitionTasks.id, targetTaskId));

      await db.update(orderFiles).set({
        taskId: targetTaskId,
        uploadDate: located.billDate,
      }).where(inArray(orderFiles.id, orderFileIds));

      await db.update(billDetails).set({
        taskId: targetTaskId,
        billDate: located.billDate,
        partitionDate: located.billDate,
        lifecycleStatus: "normal",
      }).where(inArray(billDetails.orderFileId, orderFileIds));

      await refreshRecognitionTaskSummary(targetTaskId);
      await db.update(recognitionTasks).set({
        status: "processing",
        completedAt: null,
        updatedAt: new Date(),
      }).where(eq(recognitionTasks.id, targetTaskId));
      await refreshRecognitionDateSummariesByTaskIds([targetTaskId]);
      void enqueueRecognition(targetTaskId).catch((err) => {
        console.error(`[order-files/match-package-bank-flow] 明细认账队列任务 ${targetTaskId} 执行失败:`, err);
      });

      return {
        success: true,
        taskId: targetTaskId,
        billDate: located.billDate,
        orderFileCount: orderFileIds.length,
      };
    }),

  deletePackage: authedQuery
    .input(deletePackageInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "order_detail_package_delete"))) throw new Error("权限不足");
      return enqueueDeleteOrderFilePackage(input);
    }),

  startDeletePackage: authedQuery
    .input(deletePackageInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "order_detail_package_delete"))) throw new Error("权限不足");
      const session = createDeletePackageSession(input);
      void runDeletePackageSession(session.deleteId, input);
      return session;
    }),

  getDeletePackageStatus: authedQuery
    .input(z.object({ deleteId: z.string().min(1) }))
    .query(({ input }) => {
      const session = deletePackageSessions.get(input.deleteId);
      if (!session) {
        return {
          deleteId: input.deleteId,
          packageKey: "",
          status: "failed" as const,
          step: DELETE_PACKAGE_STEPS.length,
          totalSteps: DELETE_PACKAGE_STEPS.length,
          message: "删除状态已过期",
          error: "删除状态已过期，请刷新列表确认结果",
          startedAt: Date.now(),
          completedAt: Date.now(),
        };
      }
      return session;
    }),
});
