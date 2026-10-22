import { and, asc, count, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  bankFlows,
  billDetails,
  counterpartyRecords,
  detailSplitFiles,
  matchResults,
  orderFiles,
  recognitionDateSummaries,
  recognitionRules,
  recognitionTasks,
} from "@db/schema";
import { getDb } from "../queries/connection";
import { isBillDetailArchiveTableName, listBillDetailArchiveTableNames } from "./billDetailArchiveWrite";
import { deriveFlowRecognitionStatus, toCents } from "./splitAmounts";

export type SameDayDetailCounterparty = typeof counterpartyRecords.$inferSelect & {
  matchAccounts: any[];
};

export function allocateRecognizedAmountAcrossFlows(
  flows: Array<{ id: number; income: string | number }>,
  recognizedTotal: string | number,
) {
  let remainingRecognizedCents = Math.max(0, toCents(recognizedTotal));
  return flows.map((flow) => {
    const incomeCents = Math.max(0, toCents(flow.income));
    const recognizedCents = Math.min(incomeCents, remainingRecognizedCents);
    remainingRecognizedCents = Math.max(0, remainingRecognizedCents - incomeCents);
    return {
      flowId: Number(flow.id),
      status: deriveFlowRecognitionStatus(incomeCents / 100, recognizedCents / 100),
      recognizedAmount: recognizedCents / 100,
      recognitionAvailableAmount: Math.max(0, incomeCents - recognizedCents) / 100,
    };
  });
}

export async function ensureSameDayAggregateTask(input: {
  billDate: string;
  counterparty: SameDayDetailCounterparty;
  creatorId: number;
  ruleId?: number;
  preferredTaskId?: number;
  database?: any;
}) {
  const db = getDb();
  const run = async (tx: any) => {
    const counterpartyId = Number(input.counterparty.id);
    const requestedRuleId = Number(input.ruleId || 0);

    // Serialize creation/merge for the same arrival configuration. This works with
    // the nullable unique key to keep concurrent imports on one task.
    await tx.update(counterpartyRecords)
      .set({ alias: sql`${counterpartyRecords.alias}` })
      .where(eq(counterpartyRecords.id, counterpartyId));

    const taskRows: Array<{
      task: typeof recognitionTasks.$inferSelect;
      matchedCounterpartyAlias: string | null;
    }> = await tx
      .select({
        task: recognitionTasks,
        matchedCounterpartyAlias: recognitionRules.matchedCounterpartyAlias,
      })
      .from(recognitionTasks)
      .leftJoin(recognitionRules, eq(recognitionRules.id, recognitionTasks.ruleId))
      .where(eq(recognitionTasks.billDate, input.billDate))
      .orderBy(asc(recognitionTasks.id));
    const dateTaskIds = taskRows.map((row) => Number(row.task.id)).filter(Boolean);
    const flowRows: Array<typeof bankFlows.$inferSelect> = dateTaskIds.length > 0
      ? await tx.select().from(bankFlows).where(and(
        inArray(bankFlows.taskId, dateTaskIds),
        gt(bankFlows.income, "0"),
        eq(bankFlows.arrivalMatchStatus, "matched"),
        eq(bankFlows.matchedCounterpartyId, counterpartyId),
      ))
      : [];
    const matchingFlowTaskIds = new Set(flowRows
      .map((flow) => Number(flow.taskId)));

    const candidates = taskRows.filter((row) =>
      Number(row.task.sameDayCounterpartyId || 0) === counterpartyId
      || String(row.matchedCounterpartyAlias || "").trim() === String(input.counterparty.alias || "").trim()
      || matchingFlowTaskIds.has(Number(row.task.id))
      || Number(row.task.id) === Number(input.preferredTaskId || 0)
    );
    const candidateRuleIds = new Set(candidates
      .map((row) => Number(row.task.ruleId || 0))
      .filter(Boolean));
    if (requestedRuleId) candidateRuleIds.add(requestedRuleId);
    if (candidateRuleIds.size > 1) {
      throw new Error(`${input.billDate} 的同日汇总流水已绑定不同订单明细规则，不能自动合并任务`);
    }

    let anchor = candidates.find((row) => Number(row.task.sameDayCounterpartyId || 0) === counterpartyId)
      || candidates.find((row) => Number(row.task.id) === Number(input.preferredTaskId || 0))
      || candidates.find((row) => row.task.hasDetailFile)
      || candidates[0];

    let created = false;
    if (!anchor) {
      await tx.insert(recognitionTasks).values({
        ruleId: requestedRuleId,
        sameDayCounterpartyId: counterpartyId,
        billDate: input.billDate,
        creatorId: input.creatorId,
        status: "pending_details",
        bankFlowTotal: "0.00",
        bankFlowCount: 0,
      }).onDuplicateKeyUpdate({
        set: { updatedAt: new Date() },
      });
      [anchor] = await tx
        .select({ task: recognitionTasks, matchedCounterpartyAlias: recognitionRules.matchedCounterpartyAlias })
        .from(recognitionTasks)
        .leftJoin(recognitionRules, eq(recognitionRules.id, recognitionTasks.ruleId))
        .where(and(
          eq(recognitionTasks.billDate, input.billDate),
          eq(recognitionTasks.sameDayCounterpartyId, counterpartyId),
        ));
      created = true;
    }
    if (!anchor) throw new Error("创建同日汇总认账任务失败");

    const anchorTaskId = Number(anchor.task.id);
    const mergedTaskIds = candidates
      .map((row) => Number(row.task.id))
      .filter((taskId) => taskId > 0 && taskId !== anchorTaskId);
    if (mergedTaskIds.length > 0) {
      await tx.update(bankFlows).set({ taskId: anchorTaskId }).where(inArray(bankFlows.taskId, mergedTaskIds));
      await tx.update(orderFiles).set({ taskId: anchorTaskId }).where(inArray(orderFiles.taskId, mergedTaskIds));
      await tx.update(billDetails).set({ taskId: anchorTaskId }).where(inArray(billDetails.taskId, mergedTaskIds));
      await tx.update(billDetails).set({ originalTaskId: anchorTaskId }).where(inArray(billDetails.originalTaskId, mergedTaskIds));
      await tx.update(detailSplitFiles).set({ taskId: anchorTaskId }).where(inArray(detailSplitFiles.taskId, mergedTaskIds));
      await tx.update(matchResults).set({ taskId: anchorTaskId }).where(inArray(matchResults.taskId, mergedTaskIds));
      await tx.update(recognitionDateSummaries).set({ primaryTaskId: anchorTaskId })
        .where(inArray(recognitionDateSummaries.primaryTaskId, mergedTaskIds));

      const mergedTaskIdList = sql.join(mergedTaskIds.map((taskId) => sql`${taskId}`), sql`, `);
      const archiveTableNames = await listBillDetailArchiveTableNames(tx);
      for (const tableName of archiveTableNames) {
        if (!isBillDetailArchiveTableName(tableName)) continue;
        const archiveTable = sql.raw(`\`${tableName}\``);
        await tx.execute(sql`
          UPDATE ${archiveTable}
          SET
            task_id = CASE WHEN task_id IN (${mergedTaskIdList}) THEN ${anchorTaskId} ELSE task_id END,
            original_task_id = CASE WHEN original_task_id IN (${mergedTaskIdList}) THEN ${anchorTaskId} ELSE original_task_id END
          WHERE task_id IN (${mergedTaskIdList})
             OR original_task_id IN (${mergedTaskIdList})
        `);
      }
      await tx.delete(recognitionTasks).where(inArray(recognitionTasks.id, mergedTaskIds));
    }

    const [flowSummary] = await tx.select({
      count: count(),
      total: sql<string>`COALESCE(SUM(CAST(${bankFlows.income} AS DECIMAL(18,2))), 0.00)`,
    }).from(bankFlows).where(and(
      eq(bankFlows.taskId, anchorTaskId),
      gt(bankFlows.income, "0"),
      eq(bankFlows.arrivalMatchStatus, "matched"),
      eq(bankFlows.matchedCounterpartyId, counterpartyId),
    ));
    const [detailSummary] = await tx.select({
      count: count(),
      total: sql<string>`COALESCE(SUM(CAST(${billDetails.totalAmount} AS DECIMAL(18,2))), 0.00)`,
      matchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchResultId} IS NOT NULL THEN 1 ELSE 0 END)`,
      unmatchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'unmatched' THEN 1 ELSE 0 END)`,
      pendingSplitCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'pending_split' AND ${billDetails.matchResultId} IS NULL THEN 1 ELSE 0 END)`,
    }).from(billDetails).where(and(
      eq(billDetails.taskId, anchorTaskId),
      isNull(billDetails.detailSplitFileId),
      sql`(
        COALESCE(${billDetails.operationStatus}, 'active') = 'active'
        OR ${billDetails.operationStatus} = 'split_replaced'
        OR ${billDetails.ignoreReason} LIKE '已按明细分账拆分认账%'
      )`,
      sql`NOT EXISTS (
        SELECT 1 FROM order_files same_day_abnormal_file
        WHERE same_day_abnormal_file.id = ${billDetails.orderFileId}
          AND same_day_abnormal_file.upload_status = 'abnormal'
      )`,
    ));
    await tx.update(recognitionTasks).set({
      ruleId: requestedRuleId || Number(anchor.task.ruleId || 0),
      sameDayCounterpartyId: counterpartyId,
      bankFlowCount: Number(flowSummary?.count || 0),
      bankFlowTotal: Number(flowSummary?.total || 0).toFixed(2),
      billDetailCount: Number(detailSummary?.count || 0),
      billDetailTotal: Number(detailSummary?.total || 0).toFixed(2),
      matchedCount: Number(detailSummary?.matchedCount || 0),
      unmatchedCount: Number(detailSummary?.unmatchedCount || 0),
      pendingSplitCount: Number(detailSummary?.pendingSplitCount || 0),
      hasDetailFile: Number(detailSummary?.count || 0) > 0,
      updatedAt: new Date(),
    }).where(eq(recognitionTasks.id, anchorTaskId));

    return { taskId: anchorTaskId, mergedTaskIds, created };
  };
  return input.database ? run(input.database) : db.transaction(run);
}
