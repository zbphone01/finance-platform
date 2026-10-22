import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { bankFlows, billDetails, detailSplitFiles, matchResults, orderFiles, recognitionRules, recognitionTasks, users } from "@db/schema";
import { and, asc, count, desc, eq, gt, inArray, isNull, like, notInArray, or, sql } from "drizzle-orm";
import { refreshRecognitionDateSummariesByTaskIds } from "./lib/recognitionDateSummary";
import { enqueueRecognition } from "./lib/recognitionQueue";
import { enqueueDbHeavyJob } from "./lib/dbHeavyQueue";
import {
  getDetailSplitBindingDates,
  isDetailSplitGroupReady,
  planDetailSplitRuleRematches,
} from "./lib/detailSplitMatching";
import { refreshDetailSplitFileSummaries, refreshDetailSplitFileSummary } from "./lib/detailSplitSummary";
import { userHasPermission } from "./lib/permissions";
import { clearBillDetailMatchResults } from "./lib/billDetailCleanup";
import {
  hasArchivedDetailSplitFileRows,
  listDetailSplitFileBillDetails,
} from "./lib/billDetailArchiveRead";
import {
  getRelatedRecognitionTaskIds,
  markRecognitionTasksProcessing,
  settleRecognitionTasksAfterProcessing,
} from "./taskRouter";
import { toCents } from "./lib/splitAmounts";

function cleanCell(value: unknown) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^[`'"]+/, "")
    .replace(/[`'"]+$/, "")
    .trim();
}

function getRawField(rawData: unknown, field: string) {
  if (!rawData || typeof rawData !== "object") return "";
  const target = cleanCell(field);
  const row = rawData as Record<string, unknown>;
  const exact = row[target];
  if (exact !== undefined && exact !== null && String(exact).trim() !== "") return String(exact);
  const normalizedTarget = target.replace(/\s+/g, "");
  const key = Object.keys(row).find((item) => cleanCell(item).replace(/\s+/g, "") === normalizedTarget);
  return key ? String(row[key] || "") : "";
}

function deriveFlowRecognitionStatus(income: number, recognizedAmount: number) {
  if (recognizedAmount >= income - 0.01) return "recognized";
  if (recognizedAmount > 0.01) return "partial_matched";
  return "unrecognized";
}

function normalizeDetailSplitMatchKey(value: unknown) {
  return cleanCell(value).replace(/[^a-zA-Z0-9]/g, "").slice(5);
}

type SplitCandidateGroup = {
  ids: number[];
  totalCents: number;
  allRecognizable: boolean;
  detailSplitFileIds: Set<number>;
};

function buildSplitCandidateGroups(rows: Array<{
  id: number;
  detailSplitFileId: number | null;
  totalAmount: unknown;
  rawData: unknown;
  matchStatus: string;
  ruleItemId: number | null;
}>, matchField: string) {
  const groups = new Map<string, SplitCandidateGroup>();
  for (const row of rows) {
    const key = cleanCell(getRawField(row.rawData, matchField));
    const id = Number(row.id || 0);
    if (!key || !id) continue;
    const group = groups.get(key) || {
      ids: [],
      totalCents: 0,
      allRecognizable: true,
      detailSplitFileIds: new Set<number>(),
    };
    group.ids.push(id);
    group.totalCents += toCents(row.totalAmount as number | string | null | undefined);
    group.allRecognizable = group.allRecognizable
      && row.matchStatus === "matched"
      && Number(row.ruleItemId || 0) > 0;
    const detailSplitFileId = Number(row.detailSplitFileId || 0);
    if (detailSplitFileId) group.detailSplitFileIds.add(detailSplitFileId);
    groups.set(key, group);
  }
  return groups;
}

async function linkSplitCandidateGroup(input: {
  splitIds: number[];
  taskId: number;
  orderFileId: number;
  sourceDetailId: number;
  billDate: string;
  partitionDate: string;
}) {
  const db = getDb();
  const bindingDates = getDetailSplitBindingDates(input);
  for (let index = 0; index < input.splitIds.length; index += 5000) {
    await db.update(billDetails).set({
      taskId: input.taskId,
      orderFileId: input.orderFileId,
      splitSourceDetailId: input.sourceDetailId,
      billDate: bindingDates.billDate,
      partitionDate: bindingDates.partitionDate,
      lifecycleStatus: "normal",
    }).where(inArray(billDetails.id, input.splitIds.slice(index, index + 5000)));
  }
}

function rowsFromExecuteResult(result: any): any[] {
  if (Array.isArray(result) && Array.isArray(result[0])) return result[0];
  return Array.isArray(result) ? result : [];
}

async function repairLinkedDetailSplitDates(detailSplitFileId: number, ruleId: number) {
  const db = getDb();
  let repairedCount = 0;
  await db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      SELECT
        split_detail.id AS id,
        split_detail.partition_date AS currentPartitionDate,
        source_detail.bill_date AS sourceBillDate,
        source_detail.partition_date AS sourcePartitionDate
      FROM bill_details split_detail FORCE INDEX (bd_rule_detail_split_status_idx)
      INNER JOIN bill_details source_detail ON source_detail.id = split_detail.split_source_detail_id
      WHERE split_detail.rule_id = ${ruleId}
        AND split_detail.detail_split_file_id = ${detailSplitFileId}
        AND split_detail.split_source_detail_id IS NOT NULL
        AND split_detail.match_status = 'matched'
        AND split_detail.match_result_id IS NULL
        AND source_detail.detail_split_file_id IS NULL
        AND COALESCE(split_detail.operation_status, 'active') = 'active'
        AND (
          split_detail.bill_date <> source_detail.bill_date
          OR split_detail.partition_date <> source_detail.partition_date
        )
      FOR UPDATE
    `);
    const groups = new Map<string, {
      ids: number[];
      currentPartitionDate: string;
      sourceBillDate: string;
      sourcePartitionDate: string;
    }>();
    for (const row of rowsFromExecuteResult(result)) {
      const id = Number(row.id || 0);
      const currentPartitionDate = String(row.currentPartitionDate || "");
      const sourceBillDate = String(row.sourceBillDate || "");
      const sourcePartitionDate = String(row.sourcePartitionDate || "");
      if (!id || !currentPartitionDate || !sourceBillDate || !sourcePartitionDate) continue;
      const key = `${currentPartitionDate}|${sourceBillDate}|${sourcePartitionDate}`;
      const group = groups.get(key) || { ids: [], currentPartitionDate, sourceBillDate, sourcePartitionDate };
      group.ids.push(id);
      groups.set(key, group);
    }

    for (const group of groups.values()) {
      for (let index = 0; index < group.ids.length; index += 5000) {
        const updateResult: any = await tx.update(billDetails).set({
          billDate: group.sourceBillDate,
          partitionDate: group.sourcePartitionDate,
        }).where(and(
          inArray(billDetails.id, group.ids.slice(index, index + 5000)),
          eq(billDetails.ruleId, ruleId),
          eq(billDetails.detailSplitFileId, detailSplitFileId),
          eq(billDetails.partitionDate, group.currentPartitionDate),
          eq(billDetails.matchStatus, "matched"),
          sql`${billDetails.matchResultId} IS NULL`,
          sql`COALESCE(${billDetails.operationStatus}, 'active') = 'active'`,
        ));
        repairedCount += getAffectedRows(updateResult);
      }
    }
  });
  if (repairedCount > 0) {
    console.log(`[detail-split-files/date-repair] 分账包 ${detailSplitFileId} 已修复 ${repairedCount} 条关联明细日期`);
  }
  return repairedCount;
}

async function rematchDetailSplitUnmatchedEntries(detailSplitFileId: number) {
  const db = getDb();
  const splitFile = await db.query.detailSplitFiles.findFirst({
    where: eq(detailSplitFiles.id, detailSplitFileId),
    with: { rule: { with: { items: true } } },
  });
  if (!splitFile?.rule?.items?.length) return 0;
  const keywordField = cleanCell(splitFile.recognitionKeywordField);
  if (!keywordField) return 0;

  const exactItems = splitFile.rule.items
    .filter((item: any) => !item.keywordMatchType || item.keywordMatchType === "等于")
    .map((item: any) => ({ id: Number(item.id), keyword: cleanCell(item.detailKeyword) }))
    .filter((item) => item.id && item.keyword);
  const currentRuleItemIds = splitFile.rule.items
    .map((item: any) => Number(item.id || 0))
    .filter(Boolean);
  const candidateRows = await db.select({
    id: billDetails.id,
    rawData: billDetails.rawData,
    matchStatus: billDetails.matchStatus,
    ruleItemId: billDetails.ruleItemId,
  }).from(billDetails).where(and(
    eq(billDetails.ruleId, Number(splitFile.ruleId)),
    eq(billDetails.detailSplitFileId, detailSplitFileId),
    or(
      eq(billDetails.matchStatus, "unmatched"),
      and(
        eq(billDetails.matchStatus, "matched"),
        or(
          isNull(billDetails.ruleItemId),
          notInArray(billDetails.ruleItemId, currentRuleItemIds),
        ),
      ),
    ),
    sql`${billDetails.matchResultId} IS NULL`,
    sql`COALESCE(${billDetails.operationStatus}, 'active') = 'active'`,
  ));
  const plan = planDetailSplitRuleRematches(
    candidateRows.map((row) => ({
      id: Number(row.id),
      matchStatus: row.matchStatus === "matched" ? "matched" : "unmatched",
      ruleItemId: Number(row.ruleItemId || 0) || null,
      keyword: cleanCell(getRawField(row.rawData, keywordField)),
    })),
    exactItems,
    currentRuleItemIds,
  );

  let rematchedCount = 0;
  await db.transaction(async (tx) => {
    for (let index = 0; index < plan.staleMatchedIds.length; index += 5000) {
      await tx.update(billDetails).set({
        matchStatus: "unmatched",
        ruleItemId: null,
      }).where(and(
        inArray(billDetails.id, plan.staleMatchedIds.slice(index, index + 5000)),
        eq(billDetails.matchStatus, "matched"),
        sql`${billDetails.matchResultId} IS NULL`,
        sql`COALESCE(${billDetails.operationStatus}, 'active') = 'active'`,
      ));
    }

    for (const assignment of plan.assignments) {
      for (let index = 0; index < assignment.detailIds.length; index += 5000) {
        const result: any = await tx.update(billDetails).set({
          matchStatus: "matched",
          ruleItemId: assignment.ruleItemId,
        }).where(and(
          inArray(billDetails.id, assignment.detailIds.slice(index, index + 5000)),
          inArray(billDetails.matchStatus, ["matched", "unmatched"]),
          sql`${billDetails.matchResultId} IS NULL`,
          sql`COALESCE(${billDetails.operationStatus}, 'active') = 'active'`,
        ));
        rematchedCount += getAffectedRows(result);
      }
    }
  });
  await refreshDetailSplitFileSummary(detailSplitFileId);
  return rematchedCount;
}

async function assertNoInvalidLinkedDetailSplitEntries(detailSplitFileId: number) {
  const db = getDb();
  const [invalidLinkedRows] = await db.select({ count: count() })
    .from(billDetails)
    .where(and(
      eq(billDetails.detailSplitFileId, detailSplitFileId),
      sql`${billDetails.splitSourceDetailId} IS NOT NULL`,
      sql`${billDetails.matchResultId} IS NULL`,
      sql`${billDetails.matchStatus} <> 'matched'`,
      sql`COALESCE(${billDetails.operationStatus}, 'active') = 'active'`,
    ));
  const invalidLinkedCount = Number(invalidLinkedRows?.count || 0);
  if (invalidLinkedCount > 0) {
    throw new Error(
      `该分账包有 ${invalidLinkedCount} 条已关联明细无法匹配当前规则，请更新规则后重试`,
    );
  }
}

async function refreshTaskSummary(taskId: number) {
  const db = getDb();
  const activeWhere = and(
    eq(billDetails.taskId, taskId),
    isNull(billDetails.detailSplitFileId),
    sql`(
      COALESCE(${billDetails.operationStatus}, 'active') = 'active'
      OR ${billDetails.operationStatus} = 'split_replaced'
      OR ${billDetails.ignoreReason} LIKE '已按明细分账拆分认账%'
    )`,
    sql`NOT EXISTS (SELECT 1 FROM order_files of_abnormal WHERE of_abnormal.id = ${billDetails.orderFileId} AND of_abnormal.upload_status = 'abnormal')`,
  );
  const [summary] = await db.select({
    total: sql<string>`COALESCE(SUM(CAST(${billDetails.totalAmount} AS DECIMAL(18,2))), 0.00)`,
    entryCount: count(),
    matchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchResultId} IS NOT NULL THEN 1 ELSE 0 END)`,
    unmatchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'unmatched' THEN 1 ELSE 0 END)`,
    pendingSplitCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'pending_split' AND ${billDetails.matchResultId} IS NULL THEN 1 ELSE 0 END)`,
  }).from(billDetails).where(activeWhere);

  await db.update(recognitionTasks).set({
    billDetailTotal: Number(summary?.total || 0).toFixed(2),
    billDetailCount: Number(summary?.entryCount || 0),
    matchedCount: Number(summary?.matchedCount || 0),
    unmatchedCount: Number(summary?.unmatchedCount || 0),
    pendingSplitCount: Number(summary?.pendingSplitCount || 0),
    hasDetailFile: Number(summary?.entryCount || 0) > 0,
    updatedAt: new Date(),
  }).where(eq(recognitionTasks.id, taskId));
  await refreshRecognitionDateSummariesByTaskIds([taskId]);
}

async function resetTaskFlowStatus(taskIds: number[]) {
  const db = getDb();
  const uniqueTaskIds = Array.from(new Set(taskIds.map(Number).filter(Boolean)));
  if (uniqueTaskIds.length === 0) return;

  await db.update(bankFlows)
    .set({ recognitionStatus: "unrecognized", incomeRuleId: null })
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
    const [flowProgress] = await db.select({
      allTotal: count(),
      total: sql<number>`SUM(CASE WHEN CAST(${bankFlows.income} AS DECIMAL(18,2)) > 0 THEN 1 ELSE 0 END)`,
      recognized: sql<number>`SUM(CASE WHEN CAST(${bankFlows.income} AS DECIMAL(18,2)) > 0 AND ${bankFlows.recognitionStatus} = 'recognized' THEN 1 ELSE 0 END)`,
    }).from(bankFlows).where(eq(bankFlows.taskId, taskId));
    const [resultProgress] = await db.select({ count: count() })
      .from(matchResults)
      .innerJoin(bankFlows, eq(bankFlows.id, matchResults.bankFlowId))
      .where(and(eq(matchResults.taskId, taskId), gt(bankFlows.income, "0")));
    const allTotal = Number(flowProgress?.allTotal || 0);
    const total = Number(flowProgress?.total || 0);
    const recognized = Number(flowProgress?.recognized || 0);
    const resultCount = Number(resultProgress?.count || 0);
    const status = allTotal > 0 && total === 0
      ? "completed"
      : total > 0 && recognized >= total
      ? "completed"
      : recognized > 0 || resultCount > 0
        ? "partial_matched"
        : "pending_details";

    await db.update(recognitionTasks).set({
      status,
      completedAt: status === "completed" ? new Date() : null,
      updatedAt: new Date(),
    }).where(eq(recognitionTasks.id, taskId));
  }
}

async function refreshOrderFileSummary(orderFileId: number) {
  const db = getDb();
  const [summary] = await db.select({
    matchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'matched' THEN 1 ELSE 0 END)`,
    unmatchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'unmatched' THEN 1 ELSE 0 END)`,
    pendingSplitCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'pending_split' THEN 1 ELSE 0 END)`,
  }).from(billDetails).where(and(
    eq(billDetails.orderFileId, orderFileId),
    isNull(billDetails.detailSplitFileId),
  ));

  await db.update(orderFiles).set({
    matchedCount: Number(summary?.matchedCount || 0),
    unmatchedCount: Number(summary?.unmatchedCount || 0),
    pendingSplitCount: Number(summary?.pendingSplitCount || 0),
  }).where(eq(orderFiles.id, orderFileId));
}

async function assertNoCreatedVoucherForResultIds(matchResultIds: number[]) {
  const uniqueIds = Array.from(new Set(matchResultIds.map(Number).filter(Boolean)));
  if (uniqueIds.length === 0) return;
  const db = getDb();
  for (let i = 0; i < uniqueIds.length; i += 5000) {
    const [result] = await db.select({ count: count() }).from(matchResults).where(and(
      inArray(matchResults.id, uniqueIds.slice(i, i + 5000)),
      eq(matchResults.voucherStatus, "created"),
    ));
    if (Number(result?.count || 0) > 0) {
      throw new Error("该明细分账包已有入账锁定记录，无法删除。");
    }
  }
}

async function expandRelatedSplitMatchResultIds(matchResultIds: number[]) {
  const uniqueIds = Array.from(new Set(matchResultIds.map(Number).filter(Boolean)));
  if (uniqueIds.length === 0) return [];
  const db = getDb();
  const expandedIds = new Set<number>(uniqueIds);

  for (let i = 0; i < uniqueIds.length; i += 5000) {
    const seedRows = await db.select({
      taskId: matchResults.taskId,
      ruleItemId: matchResults.ruleItemId,
      bankFlowId: matchResults.bankFlowId,
      totalAmount: matchResults.totalAmount,
      entryTime: matchResults.entryTime,
      orderDetailCountSnapshot: matchResults.orderDetailCountSnapshot,
    }).from(matchResults).where(inArray(matchResults.id, uniqueIds.slice(i, i + 5000)));

    for (const seed of seedRows) {
      const ruleItemId = Number(seed.ruleItemId || 0);
      const taskId = Number(seed.taskId || 0);
      if (!taskId || !ruleItemId) continue;
      const relatedRows = await db.select({ id: matchResults.id })
        .from(matchResults)
        .where(and(
          eq(matchResults.taskId, taskId),
          eq(matchResults.ruleItemId, ruleItemId),
          sql`${matchResults.bankFlowId} <=> ${seed.bankFlowId}`,
          eq(matchResults.entryTime, String(seed.entryTime || "")),
          sql`CAST(${matchResults.totalAmount} AS DECIMAL(18,2)) = CAST(${seed.totalAmount} AS DECIMAL(18,2))`,
          eq(matchResults.orderDetailCountSnapshot, Number(seed.orderDetailCountSnapshot || 0)),
        ));
      relatedRows.forEach((row) => {
        const id = Number(row.id || 0);
        if (id) expandedIds.add(id);
      });
    }
  }

  return Array.from(expandedIds);
}

type DetailSplitSourceCandidate = {
  id: number;
  taskId: number;
  orderFileId: number;
  billDate: string;
  partitionDate: string;
  totalAmount: unknown;
  rawData: unknown;
};

type DetailSplitSourceMatch = {
  source: DetailSplitSourceCandidate;
  splitGroup: SplitCandidateGroup;
  sourceKey: string;
};

const runningDetailSplitRecognitionIds = new Set<number>();
let detailSplitRecoveryChecked = false;

function getAffectedRows(result: any) {
  return Number(result?.[0]?.affectedRows ?? result?.affectedRows ?? 0);
}

async function setDetailSplitRecognitionFailed(detailSplitFileId: number, err: unknown) {
  const db = getDb();
  const message = err instanceof Error ? err.message : String(err || "明细分账认账失败");
  await db.update(detailSplitFiles).set({
    recognitionPhase: "failed",
    recognitionFailedReason: message.slice(0, 500),
  }).where(eq(detailSplitFiles.id, detailSplitFileId));
}

async function recoverInterruptedDetailSplitRecognitionJobs() {
  if (detailSplitRecoveryChecked) return;
  detailSplitRecoveryChecked = true;
  const db = getDb();
  const interruptedFiles = await db.select({ id: detailSplitFiles.id })
    .from(detailSplitFiles)
    .where(or(
      eq(detailSplitFiles.recognitionPhase, "finding_tasks"),
      eq(detailSplitFiles.recognitionPhase, "recognizing"),
    ));
  const interruptedFileIds = interruptedFiles.map((row) => Number(row.id)).filter(Boolean);
  if (interruptedFileIds.length === 0) return;

  await db.update(detailSplitFiles).set({
    recognitionPhase: "failed",
    recognitionFailedReason: "服务重启导致本次认账中断，请重新开始拆分认账",
  }).where(inArray(detailSplitFiles.id, interruptedFileIds));
  const sourceTaskRows = await db.select({ taskId: billDetails.taskId })
    .from(billDetails)
    .where(and(
      inArray(billDetails.detailSplitFileId, interruptedFileIds),
      sql`${billDetails.taskId} > 0`,
    ))
    .groupBy(billDetails.taskId);
  const relatedTaskIds = new Set<number>();
  for (const taskId of sourceTaskRows.map((row) => Number(row.taskId)).filter(Boolean)) {
    for (const relatedTaskId of await getRelatedRecognitionTaskIds(taskId)) relatedTaskIds.add(relatedTaskId);
  }
  if (relatedTaskIds.size > 0) {
    await settleRecognitionTasksAfterProcessing(Array.from(relatedTaskIds));
  }
}

type PreparedDetailSplitRecognition = {
  recognitionTaskIds: number[];
  sourceIdsByTaskId: Map<number, Set<number>>;
  processingTaskIds: number[];
};

async function prepareDetailSplitPackageRecognition(
  detailSplitFileId: number
): Promise<PreparedDetailSplitRecognition | null> {
  const db = getDb();
  const [splitFile] = await db
    .select({
      id: detailSplitFiles.id,
      ruleId: detailSplitFiles.ruleId,
      matchField: detailSplitFiles.matchField,
      uploadStatus: detailSplitFiles.uploadStatus,
      orderMatchField: recognitionRules.multiSplitMatchField,
    })
    .from(detailSplitFiles)
    .leftJoin(
      recognitionRules,
      eq(recognitionRules.id, detailSplitFiles.ruleId)
    )
    .where(eq(detailSplitFiles.id, detailSplitFileId));
  if (!splitFile || !splitFile.ruleId)
    throw new Error("明细分账上传批次不存在");
  if (splitFile.uploadStatus !== "completed")
    throw new Error("明细分账包尚未完成入库");

  await rematchDetailSplitUnmatchedEntries(detailSplitFileId);
  await repairLinkedDetailSplitDates(detailSplitFileId, Number(splitFile.ruleId));
  await assertNoInvalidLinkedDetailSplitEntries(detailSplitFileId);

  const splitMatchField = cleanCell(splitFile.matchField);
  const orderMatchField = cleanCell(splitFile.orderMatchField);
  if (!splitMatchField || !orderMatchField)
    throw new Error("所选明细认账规则未完整配置分账匹配字段");

  const splitRows = await db
    .select({
      id: billDetails.id,
      taskId: billDetails.taskId,
      orderFileId: billDetails.orderFileId,
      detailSplitFileId: billDetails.detailSplitFileId,
      splitSourceDetailId: billDetails.splitSourceDetailId,
      totalAmount: billDetails.totalAmount,
      rawData: billDetails.rawData,
      matchStatus: billDetails.matchStatus,
      ruleItemId: billDetails.ruleItemId,
    })
    .from(billDetails)
    .where(
      and(
        eq(billDetails.ruleId, Number(splitFile.ruleId)),
        eq(billDetails.detailSplitFileId, detailSplitFileId),
        sql`${billDetails.matchResultId} IS NULL`,
        sql`COALESCE(${billDetails.operationStatus}, 'active') = 'active'`
      )
    );

  const unlinkedSplitRows = splitRows.filter(
    row => !row.splitSourceDetailId && !row.orderFileId
  );
  const splitGroups = buildSplitCandidateGroups(
    unlinkedSplitRows,
    splitMatchField
  );
  const sourceRows = await db
    .select({
      id: billDetails.id,
      taskId: billDetails.taskId,
      orderFileId: billDetails.orderFileId,
      billDate: billDetails.billDate,
      partitionDate: billDetails.partitionDate,
      totalAmount: billDetails.totalAmount,
      rawData: billDetails.rawData,
    })
    .from(billDetails)
    .innerJoin(orderFiles, eq(orderFiles.id, billDetails.orderFileId))
    .where(
      and(
        eq(billDetails.ruleId, Number(splitFile.ruleId)),
        isNull(billDetails.detailSplitFileId),
        eq(billDetails.matchStatus, "pending_split"),
        sql`${billDetails.matchResultId} IS NULL`,
        sql`COALESCE(${billDetails.operationStatus}, 'active') = 'active'`,
        eq(orderFiles.uploadStatus, "completed")
      )
    )
    .orderBy(asc(billDetails.id));

  const sourceMatches: DetailSplitSourceMatch[] = [];
  for (const row of sourceRows) {
    const source: DetailSplitSourceCandidate = {
      id: Number(row.id),
      taskId: Number(row.taskId || 0),
      orderFileId: Number(row.orderFileId || 0),
      billDate: String(row.billDate || "1970-01-01"),
      partitionDate: String(row.partitionDate || "1970-01-01"),
      totalAmount: row.totalAmount,
      rawData: row.rawData,
    };
    if (!source.id || !source.taskId || !source.orderFileId) continue;
    const sourceKey = normalizeDetailSplitMatchKey(
      getRawField(source.rawData, orderMatchField)
    );
    if (!sourceKey) continue;
    const splitGroup = splitGroups.get(sourceKey);
    const splitCount = splitGroup?.ids.length || 0;
    if (
      !splitGroup ||
      !isDetailSplitGroupReady(splitGroup, source.totalAmount)
    )
      continue;
    if (splitCount > 20000)
      throw new Error("单条订单明细匹配到的分账条目过多，请缩小数据后重试");
    sourceMatches.push({ source, splitGroup, sourceKey });
    splitGroups.delete(sourceKey);
  }

  if (sourceMatches.length > 0) {
    await db.transaction(async tx => {
      const confirmedMatches: DetailSplitSourceMatch[] = [];
      for (const match of sourceMatches) {
        const sourceUpdate: any = await tx
          .update(billDetails)
          .set({
            matchStatus: "ignored",
            operationStatus: "split_replaced",
            ignoreReason: `已拆分，匹配值：${match.sourceKey}`,
          })
          .where(
            and(
              eq(billDetails.id, match.source.id),
              eq(billDetails.matchStatus, "pending_split"),
              sql`${billDetails.matchResultId} IS NULL`,
              sql`COALESCE(${billDetails.operationStatus}, 'active') = 'active'`
            )
          );
        if (getAffectedRows(sourceUpdate) !== 1) continue;

        let linkedCount = 0;
        const bindingDates = getDetailSplitBindingDates(match.source);
        for (
          let index = 0;
          index < match.splitGroup.ids.length;
          index += 5000
        ) {
          const ids = match.splitGroup.ids.slice(index, index + 5000);
          const splitUpdate: any = await tx
            .update(billDetails)
            .set({
              taskId: match.source.taskId,
              orderFileId: match.source.orderFileId,
              splitSourceDetailId: match.source.id,
              billDate: bindingDates.billDate,
              partitionDate: bindingDates.partitionDate,
              lifecycleStatus: "normal",
            })
            .where(
              and(
                inArray(billDetails.id, ids),
                eq(billDetails.detailSplitFileId, detailSplitFileId),
                isNull(billDetails.splitSourceDetailId),
                isNull(billDetails.orderFileId),
                eq(billDetails.matchStatus, "matched"),
                sql`${billDetails.matchResultId} IS NULL`,
                sql`COALESCE(${billDetails.operationStatus}, 'active') = 'active'`
              )
            );
          linkedCount += getAffectedRows(splitUpdate);
        }
        if (linkedCount !== match.splitGroup.ids.length) {
          throw new Error(
            `分账条目已被其他任务占用，来源订单 ${match.source.id} 绑定失败`
          );
        }
        confirmedMatches.push(match);
      }

      const taskDeltas = new Map<number, number>();
      const orderFileDeltas = new Map<number, number>();
      for (const match of confirmedMatches) {
        taskDeltas.set(
          match.source.taskId,
          (taskDeltas.get(match.source.taskId) || 0) + 1
        );
        orderFileDeltas.set(
          match.source.orderFileId,
          (orderFileDeltas.get(match.source.orderFileId) || 0) + 1
        );
      }
      for (const [taskId, delta] of taskDeltas) {
        await tx
          .update(recognitionTasks)
          .set({
            pendingSplitCount: sql`GREATEST(COALESCE(${recognitionTasks.pendingSplitCount}, 0) - ${delta}, 0)`,
            updatedAt: new Date(),
          })
          .where(eq(recognitionTasks.id, taskId));
      }
      for (const [orderFileId, delta] of orderFileDeltas) {
        await tx
          .update(orderFiles)
          .set({
            pendingSplitCount: sql`GREATEST(COALESCE(${orderFiles.pendingSplitCount}, 0) - ${delta}, 0)`,
            recognitionSummaryValid: false,
          })
          .where(eq(orderFiles.id, orderFileId));
      }
    });
  }

  const pendingRows = await db
    .select({
      taskId: billDetails.taskId,
      splitSourceDetailId: billDetails.splitSourceDetailId,
    })
    .from(billDetails)
    .where(
      and(
        eq(billDetails.ruleId, Number(splitFile.ruleId)),
        eq(billDetails.detailSplitFileId, detailSplitFileId),
        eq(billDetails.matchStatus, "matched"),
        sql`${billDetails.matchResultId} IS NULL`,
        sql`${billDetails.splitSourceDetailId} IS NOT NULL`,
        sql`COALESCE(${billDetails.operationStatus}, 'active') = 'active'`
      )
    );
  const sourceIdsByTaskId = new Map<number, Set<number>>();
  for (const row of pendingRows) {
    const taskId = Number(row.taskId || 0);
    const sourceDetailId = Number(row.splitSourceDetailId || 0);
    if (!taskId || !sourceDetailId) continue;
    const ids = sourceIdsByTaskId.get(taskId) || new Set<number>();
    ids.add(sourceDetailId);
    sourceIdsByTaskId.set(taskId, ids);
  }
  const allPendingTaskIds = Array.from(sourceIdsByTaskId.keys()).sort(
    (a, b) => a - b
  );
  const taskRowsWithFlows =
    allPendingTaskIds.length > 0
      ? await db
          .select({ taskId: bankFlows.taskId })
          .from(bankFlows)
          .where(and(
            inArray(bankFlows.taskId, allPendingTaskIds),
            gt(bankFlows.income, "0"),
          ))
          .groupBy(bankFlows.taskId)
      : [];
  const taskIdsWithFlows = new Set(
    taskRowsWithFlows.map(row => Number(row.taskId || 0)).filter(Boolean)
  );
  const recognitionTaskIds = allPendingTaskIds.filter(taskId =>
    taskIdsWithFlows.has(taskId)
  );
  if (recognitionTaskIds.length === 0) {
    if (allPendingTaskIds.length > 0) {
      throw new Error("分账明细已关联到认账任务，但对应任务没有银行到账数据");
    }
    await refreshDetailSplitFileSummary(detailSplitFileId);
    await refreshRecognitionDateSummariesByTaskIds(allPendingTaskIds);
    await db
      .update(detailSplitFiles)
      .set({
        recognitionPhase: "completed",
        recognitionTaskTotal: 0,
        recognitionTaskCompleted: 0,
        recognitionFailedReason: null,
      })
      .where(eq(detailSplitFiles.id, detailSplitFileId));
    return null;
  }

  await db
    .update(detailSplitFiles)
    .set({
      recognitionPhase: "recognizing",
      recognitionTaskTotal: recognitionTaskIds.length,
      recognitionTaskCompleted: 0,
      recognitionFailedReason: null,
    })
    .where(eq(detailSplitFiles.id, detailSplitFileId));

  const relatedTaskIds = new Set<number>();
  for (const taskId of recognitionTaskIds) {
    for (const relatedTaskId of await getRelatedRecognitionTaskIds(taskId))
      relatedTaskIds.add(relatedTaskId);
  }
  const processingTaskIds = await markRecognitionTasksProcessing(
    Array.from(relatedTaskIds),
    allPendingTaskIds
  );

  return {
    recognitionTaskIds,
    sourceIdsByTaskId,
    processingTaskIds,
  };
}

async function runDetailSplitPackageRecognition(detailSplitFileId: number) {
  const db = getDb();
  let processingTaskIds: number[] = [];
  try {
    const prepared = await enqueueDbHeavyJob({
      key: `detail-split-find-tasks:${detailSplitFileId}`,
      type: "detail-split-find-tasks",
      run: () => prepareDetailSplitPackageRecognition(detailSplitFileId),
    });
    if (!prepared) return;
    processingTaskIds = prepared.processingTaskIds;

    const { recognitionTaskIds, sourceIdsByTaskId } = prepared;
    for (let index = 0; index < recognitionTaskIds.length; index += 1) {
      const taskId = recognitionTaskIds[index];
      const candidateSourceIds = Array.from(sourceIdsByTaskId.get(taskId) || []);
      const unrecognizedSources = candidateSourceIds.length > 0
        ? await db.select({ id: billDetails.id }).from(billDetails).where(and(
          inArray(billDetails.id, candidateSourceIds),
          sql`${billDetails.matchResultId} IS NULL`,
        ))
        : [];
      await enqueueRecognition(taskId, { detailSplitFileId });
      if (candidateSourceIds.length > 0) {
        const [remainingLinkedDetails] = await db.select({ count: count() })
          .from(billDetails)
          .where(and(
            eq(billDetails.detailSplitFileId, detailSplitFileId),
            eq(billDetails.taskId, taskId),
            sql`${billDetails.splitSourceDetailId} IS NOT NULL`,
            sql`${billDetails.matchResultId} IS NULL`,
            sql`COALESCE(${billDetails.operationStatus}, 'active') = 'active'`,
          ));
        const remainingLinkedDetailCount = Number(remainingLinkedDetails?.count || 0);
        if (remainingLinkedDetailCount > 0) {
          throw new Error(
            `分账包认账结果不完整：任务 ${taskId} 仍有 ${remainingLinkedDetailCount} 条已关联分账明细未认账`,
          );
        }
      }
      if (unrecognizedSources.length > 0) {
        const [recognizedSources] = await db.select({ count: count() }).from(billDetails).where(and(
          inArray(billDetails.id, unrecognizedSources.map((row) => Number(row.id))),
          sql`${billDetails.matchResultId} IS NOT NULL`,
        ));
        const recognizedSourceCount = Number(recognizedSources?.count || 0);
        if (recognizedSourceCount > 0) {
          await db.update(recognitionTasks).set({
            matchedCount: sql`COALESCE(${recognitionTasks.matchedCount}, 0) + ${recognizedSourceCount}`,
            updatedAt: new Date(),
          }).where(eq(recognitionTasks.id, taskId));
        }
      }
      await db.update(detailSplitFiles).set({
        recognitionTaskCompleted: index + 1,
      }).where(eq(detailSplitFiles.id, detailSplitFileId));
    }

    await settleRecognitionTasksAfterProcessing(processingTaskIds);
    processingTaskIds = [];
    await refreshDetailSplitFileSummary(detailSplitFileId);
    await db.update(detailSplitFiles).set({
      recognitionPhase: "completed",
      recognitionTaskCompleted: recognitionTaskIds.length,
      recognitionFailedReason: null,
    }).where(eq(detailSplitFiles.id, detailSplitFileId));
  } catch (err) {
    if (processingTaskIds.length > 0) {
      try {
        await settleRecognitionTasksAfterProcessing(processingTaskIds);
      } catch (statusErr) {
        console.error(`[detail-split-files/package-progress] 恢复关联任务状态失败:`, statusErr);
      }
    }
    try {
      await refreshDetailSplitFileSummary(detailSplitFileId);
      await setDetailSplitRecognitionFailed(detailSplitFileId, err);
    } catch (statusErr) {
      console.error(`[detail-split-files/package-progress] 写入分账包失败状态失败:`, statusErr);
    }
    console.error(`[detail-split-files/package-progress] 分账包 ${detailSplitFileId} 自动认账失败:`, err);
  } finally {
    runningDetailSplitRecognitionIds.delete(detailSplitFileId);
  }
}

export async function startDetailSplitPackageRecognition(detailSplitFileId: number) {
  if (runningDetailSplitRecognitionIds.has(detailSplitFileId)) return false;
  detailSplitRecoveryChecked = true;
  const db = getDb();
  await db.update(detailSplitFiles).set({
    recognitionPhase: "finding_tasks",
    recognitionTaskTotal: 0,
    recognitionTaskCompleted: 0,
    recognitionFailedReason: null,
  }).where(eq(detailSplitFiles.id, detailSplitFileId));
  runningDetailSplitRecognitionIds.add(detailSplitFileId);
  void runDetailSplitPackageRecognition(detailSplitFileId);
  return true;
}

export const detailSplitFileRouter = createRouter({
  list: authedQuery
    .input(z.object({
      search: z.string().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(50).default(20),
    }).optional())
    .query(async ({ input }) => {
      await recoverInterruptedDetailSplitRecognitionJobs();
      const db = getDb();
      const search = input?.search?.trim();
      const where = search
        ? or(
          like(detailSplitFiles.fileName, `%${search}%`),
          like(recognitionRules.ruleName, `%${search}%`),
          sql`CAST(${detailSplitFiles.orderFileId} AS CHAR) LIKE ${`%${search}%`}`,
          like(users.username, `%${search}%`),
          like(users.name, `%${search}%`),
        )
        : undefined;
      const items = await db.select({
        id: detailSplitFiles.id,
        uploadDate: sql<string>`DATE_FORMAT(${detailSplitFiles.createdAt}, '%Y-%m-%d')`,
        ruleName: recognitionRules.ruleName,
        fileName: detailSplitFiles.fileName,
        entryCount: detailSplitFiles.entryCount,
        matchedCount: detailSplitFiles.matchedCount,
        unmatchedCount: detailSplitFiles.unmatchedCount,
        pendingRecognitionCount: detailSplitFiles.pendingRecognitionCount,
        recognizedCount: detailSplitFiles.recognizedCount,
        duplicateCount: detailSplitFiles.duplicateCount,
        recognitionPhase: detailSplitFiles.recognitionPhase,
        recognitionTaskTotal: detailSplitFiles.recognitionTaskTotal,
        recognitionTaskCompleted: detailSplitFiles.recognitionTaskCompleted,
        recognitionFailedReason: detailSplitFiles.recognitionFailedReason,
        recognitionExecuting: sql<number>`${detailSplitFiles.recognitionPhase} IN ('finding_tasks', 'recognizing')`,
        uploadStatus: detailSplitFiles.uploadStatus,
        failedReason: detailSplitFiles.failedReason,
        uploadInfo: sql<string>`CONCAT(COALESCE(${users.name}, ${users.username}, '-'), ' @ ', DATE_FORMAT(${detailSplitFiles.createdAt}, '%Y-%m-%d %H:%i:%s'))`,
        createdAt: detailSplitFiles.createdAt,
      })
        .from(detailSplitFiles)
        .leftJoin(recognitionRules, eq(detailSplitFiles.ruleId, recognitionRules.id))
        .leftJoin(users, eq(detailSplitFiles.uploaderId, users.id))
        .where(where)
        .orderBy(desc(detailSplitFiles.createdAt), desc(detailSplitFiles.id))
        .limit(input?.pageSize || 20)
        .offset(((input?.page || 1) - 1) * (input?.pageSize || 20));
      const [countResult] = await db.select({ count: count() })
        .from(detailSplitFiles)
        .leftJoin(orderFiles, eq(detailSplitFiles.orderFileId, orderFiles.id))
        .leftJoin(recognitionRules, eq(detailSplitFiles.ruleId, recognitionRules.id))
        .leftJoin(users, eq(detailSplitFiles.uploaderId, users.id))
        .where(where);
      return { items, total: Number(countResult?.count || 0), page: input?.page || 1, pageSize: input?.pageSize || 20 };
    }),

  availableOrderFiles: authedQuery.query(async () => {
    const db = getDb();
    const rows = await db.select({
      id: orderFiles.id,
      fileName: orderFiles.fileName,
      ruleName: recognitionRules.ruleName,
      ruleId: orderFiles.ruleId,
      billDate: sql<string>`COALESCE(${orderFiles.uploadDate}, DATE_FORMAT(${orderFiles.createdAt}, '%Y-%m-%d'))`,
      detailPackageType: orderFiles.detailPackageType,
      pendingSplitCount: orderFiles.pendingSplitCount,
      multiSplitMatchField: recognitionRules.multiSplitMatchField,
      incomeField: recognitionRules.incomeField,
    })
      .from(orderFiles)
      .leftJoin(recognitionRules, eq(orderFiles.ruleId, recognitionRules.id))
      .where(and(
        eq(recognitionRules.detailSplitEnabled, true),
        sql`COALESCE(${orderFiles.pendingSplitCount}, 0) > 0`,
        sql`COALESCE(${orderFiles.uploadStatus}, 'completed') = 'completed'`,
      ))
      .orderBy(desc(orderFiles.createdAt))
      .limit(200);
    return rows;
  }),

  startSplitRecognition: authedQuery
    .input(z.object({ orderFileId: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [sourceFile] = await db.select({
        id: orderFiles.id,
        taskId: orderFiles.taskId,
        ruleId: orderFiles.ruleId,
        billDate: recognitionTasks.billDate,
        detailPackageType: orderFiles.detailPackageType,
        uploadDate: orderFiles.uploadDate,
        multiSplitMatchField: recognitionRules.multiSplitMatchField,
        ruleName: recognitionRules.ruleName,
      })
        .from(orderFiles)
        .leftJoin(recognitionTasks, eq(orderFiles.taskId, recognitionTasks.id))
        .leftJoin(recognitionRules, eq(orderFiles.ruleId, recognitionRules.id))
        .where(eq(orderFiles.id, input.orderFileId));

      if (!sourceFile || !sourceFile.ruleId || !sourceFile.taskId) throw new Error("所选订单明细包不存在");
      const matchField = cleanCell(sourceFile.multiSplitMatchField);
      if (!matchField) throw new Error("所选明细认账规则未配置明细匹配字段");

      const sourceRows = await db.select({
        id: billDetails.id,
        taskId: billDetails.taskId,
        ruleId: billDetails.ruleId,
        billDate: billDetails.billDate,
        partitionDate: billDetails.partitionDate,
        totalAmount: billDetails.totalAmount,
        rawData: billDetails.rawData,
      }).from(billDetails).where(and(
        eq(billDetails.orderFileId, Number(sourceFile.id)),
        eq(billDetails.matchStatus, "pending_split"),
        sql`${billDetails.matchResultId} IS NULL`,
        sql`COALESCE(${billDetails.operationStatus}, 'active') = 'active'`,
      ));
      if (sourceRows.length === 0) throw new Error("所选订单明细包没有待拆分明细");

      let recognizedSourceCount = 0;
      let linkedSplitCount = 0;
      const taskIdsToRefresh = new Set<number>([Number(sourceFile.taskId)]);
      const orderFileIdsToRefresh = new Set<number>([Number(sourceFile.id)]);
      const candidateSplitFiles = await db.select({ id: detailSplitFiles.id })
        .from(detailSplitFiles)
        .where(and(
          eq(detailSplitFiles.ruleId, Number(sourceFile.ruleId)),
          eq(detailSplitFiles.matchField, matchField),
          eq(detailSplitFiles.uploadStatus, "completed"),
        ));
      for (const splitFile of candidateSplitFiles) {
        await rematchDetailSplitUnmatchedEntries(Number(splitFile.id));
      }
      const splitRows = await db.select({
        id: billDetails.id,
        detailSplitFileId: billDetails.detailSplitFileId,
        totalAmount: billDetails.totalAmount,
        rawData: billDetails.rawData,
        matchStatus: billDetails.matchStatus,
        ruleItemId: billDetails.ruleItemId,
      }).from(billDetails)
        .leftJoin(detailSplitFiles, eq(billDetails.detailSplitFileId, detailSplitFiles.id))
        .where(and(
          eq(detailSplitFiles.ruleId, Number(sourceFile.ruleId)),
          eq(detailSplitFiles.matchField, matchField),
          sql`${billDetails.matchResultId} IS NULL`,
          sql`${billDetails.splitSourceDetailId} IS NULL`,
          sql`${billDetails.orderFileId} IS NULL`,
          sql`COALESCE(${billDetails.operationStatus}, 'active') = 'active'`,
        ));
      const splitGroups = buildSplitCandidateGroups(splitRows, matchField);
      const affectedDetailSplitFileIds = new Set<number>();

      for (const source of sourceRows) {
        const sourceKey = normalizeDetailSplitMatchKey(getRawField(source.rawData, matchField));
        if (!sourceKey) continue;

        const splitGroup = splitGroups.get(sourceKey);
        const splitCount = splitGroup?.ids.length || 0;
        if (!splitGroup || !isDetailSplitGroupReady(splitGroup, source.totalAmount)) continue;
        if (splitCount > 20000) {
          throw new Error("单条订单明细匹配到的分账条目过多，请缩小数据后重试");
        }
        await linkSplitCandidateGroup({
          splitIds: splitGroup.ids,
          taskId: Number(sourceFile.taskId),
          orderFileId: Number(sourceFile.id),
          sourceDetailId: Number(source.id),
          billDate: String(source.billDate || sourceFile.uploadDate || sourceFile.billDate || "1970-01-01"),
          partitionDate: String(source.partitionDate || sourceFile.billDate || "1970-01-01"),
        });

        await db.update(billDetails).set({
          matchStatus: "ignored",
          operationStatus: "split_replaced",
          ignoreReason: `已拆分，匹配值：${sourceKey}`,
        }).where(eq(billDetails.id, Number(source.id)));

        recognizedSourceCount += 1;
        linkedSplitCount += splitGroup.ids.length;
        splitGroup.detailSplitFileIds.forEach((id) => affectedDetailSplitFileIds.add(id));
        splitGroups.delete(sourceKey);
      }

      if (linkedSplitCount === 0) {
        return { success: true, recognizedSourceCount: 0, linkedSplitCount: 0, message: "未找到金额一致的明细分账条目" };
      }

      await db.update(orderFiles)
        .set({ recognitionSummaryValid: false })
        .where(inArray(orderFiles.id, Array.from(orderFileIdsToRefresh)));
      await refreshDetailSplitFileSummaries(Array.from(affectedDetailSplitFileIds));
      for (const orderFileId of orderFileIdsToRefresh) await refreshOrderFileSummary(orderFileId);
      for (const taskId of taskIdsToRefresh) {
        await refreshTaskSummary(taskId);
      }
      for (const detailSplitFileId of affectedDetailSplitFileIds) {
        await startDetailSplitPackageRecognition(detailSplitFileId);
      }

      return {
        success: true,
        recognizedSourceCount,
        linkedSplitCount,
        message: `已匹配 ${recognizedSourceCount} 条待拆分订单明细，关联 ${linkedSplitCount} 条明细分账`,
      };
    }),

  startPackageRecognition: authedQuery
    .input(z.object({
      detailSplitFileId: z.number(),
      auto: z.boolean().optional().default(false),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [splitFile] = await db.select({ id: detailSplitFiles.id })
        .from(detailSplitFiles)
        .where(eq(detailSplitFiles.id, input.detailSplitFileId));
      if (!splitFile) throw new Error("明细分账上传批次不存在");
      if (await hasArchivedDetailSplitFileRows(db, input.detailSplitFileId)) {
        throw new Error("该明细分账包已归档，只支持查看，不再支持自动认账");
      }
      const started = await startDetailSplitPackageRecognition(Number(splitFile.id));
      return {
        success: true,
        started,
        message: started ? "已开始查找分账任务" : "该分账包正在执行认账",
      };
    }),

  getDetails: authedQuery
    .input(z.object({
      id: z.number(),
      matchStatus: z.enum(["matched", "unmatched", "recognized", "unrecognized"]).optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(500).default(100),
    }))
    .query(async ({ input }) => {
      const db = getDb();
      const splitFile = await db.query.detailSplitFiles.findFirst({
        where: eq(detailSplitFiles.id, input.id),
        columns: {
          matchField: true,
          incomeField: true,
          recognitionKeywordField: true,
          orderNoField: true,
        },
      });
      if (!splitFile) throw new Error("明细分账上传批次不存在");
      const details = await listDetailSplitFileBillDetails(db, {
        detailSplitFileId: input.id,
        matchStatus: input.matchStatus,
        page: input.page,
        pageSize: input.pageSize,
      });
      return {
        fields: {
          matchField: splitFile.matchField,
          recognitionKeywordField: splitFile.recognitionKeywordField,
          incomeField: splitFile.incomeField,
          orderNoField: splitFile.orderNoField,
        },
        items: details.items.map((item) => ({
          ...item,
          splitMatchValue: getRawField(item.rawData, splitFile.matchField),
          recognitionKeywordValue: splitFile.recognitionKeywordField ? getRawField(item.rawData, splitFile.recognitionKeywordField) : "",
          incomeValue: getRawField(item.rawData, splitFile.incomeField) || Number(item.totalAmount || 0).toFixed(2),
          orderNoValue: splitFile.orderNoField ? getRawField(item.rawData, splitFile.orderNoField) : "",
        })),
        total: details.total,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  deletePackage: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "detail_split_delete"))) throw new Error("权限不足");
      const db = getDb();
      if (await hasArchivedDetailSplitFileRows(db, input.id)) {
        throw new Error("该明细分账包已归档，只支持查看，不支持删除");
      }
      const details = await db.select({
        id: billDetails.id,
        taskId: billDetails.taskId,
        splitSourceDetailId: billDetails.splitSourceDetailId,
        matchResultId: billDetails.matchResultId,
      }).from(billDetails).where(eq(billDetails.detailSplitFileId, input.id));
      if (details.length === 0) {
        await db.delete(detailSplitFiles).where(eq(detailSplitFiles.id, input.id));
        return { success: true, deletedCount: 0 };
      }

      const taskIds = Array.from(new Set(details.map((item) => Number(item.taskId || 0)).filter(Boolean)));
      const sourceIds = Array.from(new Set(details.map((item) => Number(item.splitSourceDetailId || 0)).filter(Boolean)));
      const sourceTaskIds = new Set<number>();
      const sourceOrderFileIds = new Set<number>();
      const affectedMatchResultIds = new Set<number>(details.map((item) => Number(item.matchResultId || 0)).filter(Boolean));
      for (let i = 0; i < sourceIds.length; i += 5000) {
        const sourceRows = await db.select({
          matchResultId: billDetails.matchResultId,
          taskId: billDetails.taskId,
          orderFileId: billDetails.orderFileId,
        })
          .from(billDetails)
          .where(inArray(billDetails.id, sourceIds.slice(i, i + 5000)));
        sourceRows.forEach((item) => {
          const taskId = Number(item.taskId || 0);
          const orderFileId = Number(item.orderFileId || 0);
          const resultId = Number(item.matchResultId || 0);
          if (taskId) sourceTaskIds.add(taskId);
          if (orderFileId) sourceOrderFileIds.add(orderFileId);
          if (resultId) affectedMatchResultIds.add(resultId);
        });
      }
      const detailIds = details.map((item) => Number(item.id)).filter(Boolean);
      const resultIds = await expandRelatedSplitMatchResultIds(Array.from(affectedMatchResultIds));
      await assertNoCreatedVoucherForResultIds(resultIds);

      await db.transaction(async (tx) => {
        for (let i = 0; i < sourceIds.length; i += 5000) {
          await tx.update(billDetails).set({
            matchStatus: "pending_split",
            matchResultId: sql`NULL`,
            ruleItemId: null,
            operationStatus: "active",
            ignoreReason: null,
          }).where(and(
            inArray(billDetails.id, sourceIds.slice(i, i + 5000)),
            sql`(
              ${billDetails.operationStatus} = 'split_replaced'
              OR (
                ${billDetails.operationStatus} = 'ignored'
                AND ${billDetails.ignoreReason} LIKE '已按明细分账拆分认账%'
              )
            )`,
          ));
        }

        for (let i = 0; i < resultIds.length; i += 5000) {
          const chunk = resultIds.slice(i, i + 5000);
          await clearBillDetailMatchResults(tx, chunk);
          await tx.delete(matchResults).where(inArray(matchResults.id, chunk));
        }

        for (let i = 0; i < detailIds.length; i += 5000) {
          await tx.delete(billDetails).where(inArray(billDetails.id, detailIds.slice(i, i + 5000)));
        }
        await tx.delete(detailSplitFiles).where(eq(detailSplitFiles.id, input.id));
      });
      const affectedTaskIds = Array.from(new Set([...taskIds, ...Array.from(sourceTaskIds)]));
      await resetTaskFlowStatus(affectedTaskIds);
      for (const orderFileId of sourceOrderFileIds) await refreshOrderFileSummary(orderFileId);
      for (const taskId of affectedTaskIds) await refreshTaskSummary(taskId);
      return { success: true, deletedCount: detailIds.length };
    }),
});
