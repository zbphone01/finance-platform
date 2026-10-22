import { and, count, eq, inArray, sql } from "drizzle-orm";
import { billDetails, detailSplitFiles } from "@db/schema";
import { getDb } from "../queries/connection";

export async function refreshDetailSplitFileSummary(detailSplitFileId: number) {
  const db = getDb();
  const [summary] = await db.select({
    entryCount: count(),
    unmatchedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'unmatched' THEN 1 ELSE 0 END)`,
    pendingRecognitionCount: sql<number>`SUM(CASE WHEN ${billDetails.matchStatus} = 'matched' AND ${billDetails.matchResultId} IS NULL THEN 1 ELSE 0 END)`,
    recognizedCount: sql<number>`SUM(CASE WHEN ${billDetails.matchResultId} IS NOT NULL THEN 1 ELSE 0 END)`,
  }).from(billDetails).where(eq(billDetails.detailSplitFileId, detailSplitFileId));

  await db.update(detailSplitFiles).set({
    entryCount: Number(summary?.entryCount || 0),
    processedCount: Number(summary?.entryCount || 0),
    unmatchedCount: Number(summary?.unmatchedCount || 0),
    matchedCount: Number(summary?.pendingRecognitionCount || 0) + Number(summary?.recognizedCount || 0),
    pendingRecognitionCount: Number(summary?.pendingRecognitionCount || 0),
    recognizedCount: Number(summary?.recognizedCount || 0),
  }).where(eq(detailSplitFiles.id, detailSplitFileId));
}

export async function refreshDetailSplitFileSummaries(detailSplitFileIds: number[]) {
  const uniqueIds = Array.from(new Set(detailSplitFileIds.map(Number).filter(Boolean)));
  for (const id of uniqueIds) await refreshDetailSplitFileSummary(id);
}

export async function getDetailSplitFileIdsForTaskIds(taskIds: number[]) {
  const uniqueTaskIds = Array.from(new Set(taskIds.map(Number).filter(Boolean)));
  if (uniqueTaskIds.length === 0) return [];
  const db = getDb();
  const rows = await db.select({ detailSplitFileId: billDetails.detailSplitFileId })
    .from(billDetails)
    .where(and(
      inArray(billDetails.taskId, uniqueTaskIds),
      sql`${billDetails.detailSplitFileId} IS NOT NULL`,
    ))
    .groupBy(billDetails.detailSplitFileId);
  return rows.map((row) => Number(row.detailSplitFileId || 0)).filter(Boolean);
}
