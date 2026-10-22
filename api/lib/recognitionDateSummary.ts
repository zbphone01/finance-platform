import { and, count, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { bankFlows, counterpartyRecords, matchResults, recognitionDateSummaries, recognitionRules, recognitionTasks } from "@db/schema";

type SummaryStatus = "pending_recognition" | "processing" | "large_variance" | "partial_matched" | "completed" | "failed";

export function deriveSummaryStatus(rows: Array<{
  status: string;
  bankFlowCount?: number | null;
  incomeBankFlowCount?: number | null;
}>): SummaryStatus {
  if (rows.length === 0) return "pending_recognition";
  const recognitionRows = rows.filter((row) => (
    Number(row.bankFlowCount || 0) === 0 || Number(row.incomeBankFlowCount || 0) > 0
  ));
  if (recognitionRows.length === 0) return "completed";
  if (recognitionRows.some((row) => row.status === "processing")) return "processing";
  if (recognitionRows.some((row) => row.status === "large_variance")) return "large_variance";
  if (recognitionRows.some((row) => row.status === "failed")) return "failed";
  if (recognitionRows.some((row) => row.status === "partial_matched")) return "partial_matched";

  const bankTasks = recognitionRows.filter((row) => Number(row.incomeBankFlowCount || 0) > 0);
  if (bankTasks.length > 0 && bankTasks.every((row) => row.status === "completed")) return "completed";
  if (recognitionRows.some((row) => row.status === "completed")) return "partial_matched";
  return "pending_recognition";
}

export async function refreshRecognitionDateSummary(billDate: string) {
  const normalizedBillDate = String(billDate || "").trim();
  if (!normalizedBillDate) return;

  const db = getDb();
  const tasks = await db
    .select({
      id: recognitionTasks.id,
      status: recognitionTasks.status,
      bankFlowTotal: recognitionTasks.bankFlowTotal,
      bankFlowCount: recognitionTasks.bankFlowCount,
      billDetailTotal: recognitionTasks.billDetailTotal,
      billDetailCount: recognitionTasks.billDetailCount,
      matchedCount: recognitionTasks.matchedCount,
      unmatchedCount: recognitionTasks.unmatchedCount,
      pendingSplitCount: recognitionTasks.pendingSplitCount,
      diffAmount: recognitionTasks.diffAmount,
      hasDetailFile: recognitionTasks.hasDetailFile,
      updatedAt: recognitionTasks.updatedAt,
      completedAt: recognitionTasks.completedAt,
      ruleId: recognitionTasks.ruleId,
      ruleName: recognitionRules.ruleName,
      detailMatchingMode: counterpartyRecords.detailMatchingMode,
      recognitionType: counterpartyRecords.recognitionType,
    })
    .from(recognitionTasks)
    .leftJoin(recognitionRules, eq(recognitionRules.id, recognitionTasks.ruleId))
    .leftJoin(counterpartyRecords, eq(counterpartyRecords.alias, recognitionRules.matchedCounterpartyAlias))
    .where(eq(recognitionTasks.billDate, normalizedBillDate));

  if (tasks.length === 0) {
    await db.delete(recognitionDateSummaries).where(eq(recognitionDateSummaries.billDate, normalizedBillDate));
    return;
  }

  const taskIds = tasks.map((task) => Number(task.id));
  const [[recognized], incomeFlowRows] = await Promise.all([
    db
      .select({
        total: sql<string>`COALESCE(SUM(CAST(${matchResults.splitAmount} AS DECIMAL(18,2))), 0.00)`,
      })
      .from(matchResults)
      .where(inArray(matchResults.taskId, taskIds)),
    db
      .select({
        taskId: bankFlows.taskId,
        count: count(),
        total: sql<string>`COALESCE(SUM(CAST(${bankFlows.income} AS DECIMAL(18,2))), 0.00)`,
        recognizedCount: sql<number>`SUM(CASE WHEN ${bankFlows.recognitionStatus} = 'recognized' THEN 1 ELSE 0 END)`,
      })
      .from(bankFlows)
      .where(and(inArray(bankFlows.taskId, taskIds), gt(bankFlows.income, "0")))
      .groupBy(bankFlows.taskId),
  ]);
  const incomeFlowSummaryByTaskId = new Map(incomeFlowRows.map((row) => [Number(row.taskId), {
    count: Number(row.count || 0),
    total: Number(row.total || 0),
    recognizedCount: Number(row.recognizedCount || 0),
  }]));
  const tasksWithIncomeCounts = tasks.map((task) => ({
    ...task,
    incomeBankFlowCount: incomeFlowSummaryByTaskId.get(Number(task.id))?.count || 0,
  }));

  const bankFlowTotal = tasks.reduce((sum, task) => sum + Number(task.bankFlowTotal || 0), 0);
  const bankFlowIncomeTotal = Array.from(incomeFlowSummaryByTaskId.values())
    .reduce((sum, item) => sum + item.total, 0);
  const recognizedBankFlowCount = Array.from(incomeFlowSummaryByTaskId.values())
    .reduce((sum, item) => sum + item.recognizedCount, 0);
  const billDetailTotal = tasks.reduce((sum, task) => sum + Number(task.billDetailTotal || 0), 0);
  const latestUpdatedAt = tasks.reduce<Date | null>((latest, task) => {
    const current = task.updatedAt ? new Date(task.updatedAt) : null;
    if (!current || Number.isNaN(current.getTime())) return latest;
    return !latest || current > latest ? current : latest;
  }, null);
  const latestCompletedAt = tasks.reduce<Date | null>((latest, task) => {
    const current = task.completedAt ? new Date(task.completedAt) : null;
    if (!current || Number.isNaN(current.getTime())) return latest;
    return !latest || current > latest ? current : latest;
  }, null);
  const varianceRuleName = tasks.find((task) => task.status === "large_variance")?.ruleName || null;
  const billDetailCount = tasks.reduce((sum, task) => sum + Number(task.billDetailCount || 0), 0);
  const aggregateVarianceDiffByRule = new Map<number, number>();
  let diffAmount = 0;
  for (const task of tasks) {
    if (task.status !== "large_variance") continue;
    const taskDiffAmount = Number(task.diffAmount || 0);
    const isAggregateDetailRule = task.recognitionType === "明细认账" && task.detailMatchingMode === "同日汇总匹配";
    if (!isAggregateDetailRule) {
      diffAmount += taskDiffAmount;
      continue;
    }
    const ruleId = Number(task.ruleId || 0);
    if (!ruleId) {
      diffAmount += taskDiffAmount;
      continue;
    }
    aggregateVarianceDiffByRule.set(ruleId, Math.max(aggregateVarianceDiffByRule.get(ruleId) || 0, taskDiffAmount));
  }
  diffAmount += Array.from(aggregateVarianceDiffByRule.values()).reduce((sum, amount) => sum + amount, 0);

  const primaryTaskId = Math.min(...taskIds);
  const values = {
    billDate: normalizedBillDate,
    primaryTaskId,
    status: deriveSummaryStatus(tasksWithIncomeCounts),
    taskCount: tasks.length,
    bankFlowTotal: bankFlowTotal.toFixed(2),
    bankFlowIncomeTotal: bankFlowIncomeTotal.toFixed(2),
    bankFlowCount: Array.from(incomeFlowSummaryByTaskId.values())
      .reduce((sum, item) => sum + item.count, 0),
    recognizedBankFlowCount,
    billDetailTotal: billDetailTotal.toFixed(2),
    billDetailCount,
    recognizedAmount: Number(recognized?.total || 0).toFixed(2),
    matchedCount: tasks.reduce((sum, task) => sum + Number(task.matchedCount || 0), 0),
    unmatchedCount: tasks.reduce((sum, task) => sum + Number(task.unmatchedCount || 0), 0),
    pendingSplitCount: tasks.reduce((sum, task) => sum + Number(task.pendingSplitCount || 0), 0),
    diffAmount: diffAmount.toFixed(2),
    hasDetailFile: billDetailCount > 0,
    varianceRuleName,
    updatedAt: latestUpdatedAt || new Date(),
    completedAt: latestCompletedAt,
  };

  await db.insert(recognitionDateSummaries)
    .values(values)
    .onDuplicateKeyUpdate({
      set: {
        status: values.status,
        primaryTaskId: values.primaryTaskId,
        taskCount: values.taskCount,
        bankFlowTotal: values.bankFlowTotal,
        bankFlowIncomeTotal: values.bankFlowIncomeTotal,
        bankFlowCount: values.bankFlowCount,
        recognizedBankFlowCount: values.recognizedBankFlowCount,
        billDetailTotal: values.billDetailTotal,
        billDetailCount: values.billDetailCount,
        recognizedAmount: values.recognizedAmount,
        matchedCount: values.matchedCount,
        unmatchedCount: values.unmatchedCount,
        pendingSplitCount: values.pendingSplitCount,
        diffAmount: values.diffAmount,
        hasDetailFile: values.hasDetailFile,
        varianceRuleName: values.varianceRuleName,
        updatedAt: values.updatedAt,
        completedAt: values.completedAt,
      },
    });
}

export async function refreshRecognitionDateSummariesByTaskIds(taskIds: number[]) {
  const db = getDb();
  const ids = Array.from(new Set(taskIds.map(Number).filter(Number.isFinite)));
  if (ids.length === 0) return;

  const rows = await db
    .select({ billDate: recognitionTasks.billDate })
    .from(recognitionTasks)
    .where(inArray(recognitionTasks.id, ids));

  for (const billDate of Array.from(new Set(rows.map((row) => row.billDate)))) {
    await refreshRecognitionDateSummary(billDate);
  }
}

export async function countRecognitionDateSummaries(status?: string) {
  const db = getDb();
  const where = status ? eq(recognitionDateSummaries.status, status as SummaryStatus) : undefined;
  const rows = await db.select({ total: count() }).from(recognitionDateSummaries).where(where);
  return Number(rows[0]?.total || 0);
}

export async function listRecognitionDateSummaries(options: { status?: string; page: number; pageSize: number }) {
  const db = getDb();
  const where = options.status ? eq(recognitionDateSummaries.status, options.status as SummaryStatus) : undefined;
  return db
    .select()
    .from(recognitionDateSummaries)
    .where(where)
    .orderBy(desc(recognitionDateSummaries.billDate))
    .limit(options.pageSize)
    .offset((options.page - 1) * options.pageSize);
}

export async function getRecognitionDateSummaryByBillDate(billDate: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(recognitionDateSummaries)
    .where(eq(recognitionDateSummaries.billDate, billDate))
    .limit(1);
  return rows[0] || null;
}
