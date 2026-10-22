import { sql } from "drizzle-orm";
import { orderFiles, orderRecognitionSummaryDeltas } from "@db/schema";
import { orderRecognitionSummaryKey, type OrderRecognitionSummaryGroup } from "./orderRecognitionSummary";
import { toCents } from "./splitAmounts";

type RecognitionDeltaDb = {
  execute: (query: any) => Promise<unknown>;
};

export type RecognitionSummaryDeltaDetail = {
  taskId: number | null;
  ruleId: number | null;
  orderFileId: number | null;
  partitionDate?: string | null;
  detailSplitFileId: number | null;
  operationStatus: string | null;
  matchResultId: number | null;
  matchStatus: string | null;
  ruleItemId: number | null;
  totalAmount: string | number | null;
  refundAmountSnapshot: string | number | null;
  orderFileUploadStatus?: string | null;
  detailPackageType?: string | null;
  recognitionSummaryValid?: boolean | null;
};

export type RecognitionSummaryDeltaRow = {
  deltaType: "source_deduction" | "target_transfer_in";
  orderFileId: number;
  taskId: number;
  ruleId: number;
  partitionDate: string;
  summaryKind: "file_total" | "rule_item";
  ruleItemId: number;
  isRefund: boolean;
  detailCount: number;
  totalCents: number;
};

export type RecognitionSummaryDeltaAggregate = {
  count: number;
  totalCents: number;
  groups: Map<string, OrderRecognitionSummaryGroup>;
};

function normalizeDate(value: unknown) {
  const text = String(value || "").trim().split(" ")[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function getAffectedRows(result: any) {
  return Number(result?.[0]?.affectedRows ?? result?.affectedRows ?? 0);
}

function isEligibleT1Detail(detail: RecognitionSummaryDeltaDetail) {
  return !detail.detailSplitFileId
    && detail.detailPackageType !== "打包明细"
    && detail.orderFileUploadStatus !== "abnormal"
    && Number(detail.orderFileId || 0) > 0
    && Number(detail.taskId || 0) > 0
    && Number(detail.ruleId || 0) > 0
    && Boolean(normalizeDate(detail.partitionDate));
}

export function buildRecognitionSummaryDeltaRows(
  detail: RecognitionSummaryDeltaDetail,
  direction: 1 | -1,
) {
  if (!isEligibleT1Detail(detail)) return [];

  const operationStatus = String(detail.operationStatus || "active");
  let deltaType: RecognitionSummaryDeltaRow["deltaType"];
  let storedDirection: 1 | -1;
  if (operationStatus === "active" && detail.recognitionSummaryValid) {
    deltaType = "source_deduction";
    storedDirection = direction === -1 ? 1 : -1;
  } else if (operationStatus === "transferred" && !detail.matchResultId) {
    deltaType = "target_transfer_in";
    storedDirection = direction;
  } else {
    return [];
  }

  const base = {
    deltaType,
    orderFileId: Number(detail.orderFileId),
    taskId: Number(detail.taskId),
    ruleId: Number(detail.ruleId),
    partitionDate: normalizeDate(detail.partitionDate),
  };
  const totalCents = toCents(detail.totalAmount || 0) * storedDirection;
  const rows: RecognitionSummaryDeltaRow[] = [{
    ...base,
    summaryKind: "file_total",
    ruleItemId: 0,
    isRefund: false,
    detailCount: storedDirection,
    totalCents,
  }];
  const ruleItemId = Number(detail.ruleItemId || 0);
  if (detail.matchStatus === "matched" && ruleItemId > 0) {
    rows.push({
      ...base,
      summaryKind: "rule_item",
      ruleItemId,
      isRefund: toCents(detail.refundAmountSnapshot || 0) > 0,
      detailCount: storedDirection,
      totalCents,
    });
  }
  return rows;
}

async function applyDeltaRow(db: RecognitionDeltaDb, row: RecognitionSummaryDeltaRow) {
  const amount = (row.totalCents / 100).toFixed(2);
  if (row.detailCount > 0) {
    await db.execute(sql`
      INSERT INTO ${orderRecognitionSummaryDeltas} (
        ${orderRecognitionSummaryDeltas.deltaType},
        ${orderRecognitionSummaryDeltas.orderFileId},
        ${orderRecognitionSummaryDeltas.taskId},
        ${orderRecognitionSummaryDeltas.ruleId},
        ${orderRecognitionSummaryDeltas.partitionDate},
        ${orderRecognitionSummaryDeltas.summaryKind},
        ${orderRecognitionSummaryDeltas.ruleItemId},
        ${orderRecognitionSummaryDeltas.isRefund},
        ${orderRecognitionSummaryDeltas.detailCount},
        ${orderRecognitionSummaryDeltas.totalAmount},
        ${orderRecognitionSummaryDeltas.updatedAt}
      )
      VALUES (
        ${row.deltaType},
        ${row.orderFileId},
        ${row.taskId},
        ${row.ruleId},
        ${row.partitionDate},
        ${row.summaryKind},
        ${row.ruleItemId},
        ${row.isRefund ? 1 : 0},
        ${row.detailCount},
        ${amount},
        NOW()
      )
      ON DUPLICATE KEY UPDATE
        ${orderRecognitionSummaryDeltas.detailCount} =
          ${orderRecognitionSummaryDeltas.detailCount} + VALUES(detail_count),
        ${orderRecognitionSummaryDeltas.totalAmount} =
          CAST(${orderRecognitionSummaryDeltas.totalAmount} AS DECIMAL(18,2)) + VALUES(total_amount),
        ${orderRecognitionSummaryDeltas.updatedAt} = NOW()
    `);
    return true;
  }

  const result = await db.execute(sql`
    UPDATE ${orderRecognitionSummaryDeltas}
    SET
      ${orderRecognitionSummaryDeltas.detailCount} =
        ${orderRecognitionSummaryDeltas.detailCount} + ${row.detailCount},
      ${orderRecognitionSummaryDeltas.totalAmount} =
        CAST(${orderRecognitionSummaryDeltas.totalAmount} AS DECIMAL(18,2)) + ${amount},
      ${orderRecognitionSummaryDeltas.updatedAt} = NOW()
    WHERE ${orderRecognitionSummaryDeltas.deltaType} = ${row.deltaType}
      AND ${orderRecognitionSummaryDeltas.orderFileId} = ${row.orderFileId}
      AND ${orderRecognitionSummaryDeltas.taskId} = ${row.taskId}
      AND ${orderRecognitionSummaryDeltas.ruleId} = ${row.ruleId}
      AND ${orderRecognitionSummaryDeltas.partitionDate} = ${row.partitionDate}
      AND ${orderRecognitionSummaryDeltas.summaryKind} = ${row.summaryKind}
      AND ${orderRecognitionSummaryDeltas.ruleItemId} = ${row.ruleItemId}
      AND ${orderRecognitionSummaryDeltas.isRefund} = ${row.isRefund ? 1 : 0}
      AND ${orderRecognitionSummaryDeltas.detailCount} >= ${Math.abs(row.detailCount)}
  `);
  if (getAffectedRows(result) === 0) return false;
  await db.execute(sql`
    DELETE FROM ${orderRecognitionSummaryDeltas}
    WHERE ${orderRecognitionSummaryDeltas.deltaType} = ${row.deltaType}
      AND ${orderRecognitionSummaryDeltas.orderFileId} = ${row.orderFileId}
      AND ${orderRecognitionSummaryDeltas.taskId} = ${row.taskId}
      AND ${orderRecognitionSummaryDeltas.ruleId} = ${row.ruleId}
      AND ${orderRecognitionSummaryDeltas.partitionDate} = ${row.partitionDate}
      AND ${orderRecognitionSummaryDeltas.summaryKind} = ${row.summaryKind}
      AND ${orderRecognitionSummaryDeltas.ruleItemId} = ${row.ruleItemId}
      AND ${orderRecognitionSummaryDeltas.isRefund} = ${row.isRefund ? 1 : 0}
      AND ${orderRecognitionSummaryDeltas.detailCount} = 0
      AND CAST(${orderRecognitionSummaryDeltas.totalAmount} AS DECIMAL(18,2)) = 0.00
  `);
  return true;
}

export async function applyRecognitionSummaryDelta(
  db: RecognitionDeltaDb,
  detail: RecognitionSummaryDeltaDetail,
  direction: 1 | -1,
) {
  const rows = buildRecognitionSummaryDeltaRows(detail, direction);
  if (rows.length === 0) return { applied: false, complete: true };

  let complete = true;
  for (const row of rows) {
    complete = await applyDeltaRow(db, row) && complete;
  }
  if (complete) return { applied: true, complete: true };

  const first = rows[0];
  if (first.deltaType === "source_deduction") {
    await db.execute(sql`
      UPDATE ${orderFiles}
      SET ${orderFiles.recognitionSummaryValid} = 0
      WHERE ${orderFiles.id} = ${first.orderFileId}
    `);
    await db.execute(sql`
      DELETE FROM ${orderRecognitionSummaryDeltas}
      WHERE ${orderRecognitionSummaryDeltas.deltaType} = 'source_deduction'
        AND ${orderRecognitionSummaryDeltas.orderFileId} = ${first.orderFileId}
    `);
  } else {
    await deleteTargetRecognitionSummaryDeltas(
      db,
      first.taskId,
      first.ruleId,
      first.partitionDate,
    );
  }
  return { applied: true, complete: false };
}

export async function deleteSourceRecognitionSummaryDeltas(
  db: RecognitionDeltaDb,
  orderFileIds: number[],
) {
  const ids = Array.from(new Set(orderFileIds.map(Number).filter(Boolean)));
  if (ids.length === 0) return;
  await db.execute(sql`
    DELETE FROM ${orderRecognitionSummaryDeltas}
    WHERE ${orderRecognitionSummaryDeltas.deltaType} = 'source_deduction'
      AND ${orderRecognitionSummaryDeltas.orderFileId}
        IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
  `);
}

export async function deleteTargetRecognitionSummaryDeltas(
  db: RecognitionDeltaDb,
  taskId: number,
  ruleId: number,
  partitionDate: string,
) {
  await db.execute(sql`
    DELETE FROM ${orderRecognitionSummaryDeltas}
    WHERE ${orderRecognitionSummaryDeltas.deltaType} = 'target_transfer_in'
      AND ${orderRecognitionSummaryDeltas.taskId} = ${taskId}
      AND ${orderRecognitionSummaryDeltas.ruleId} = ${ruleId}
      AND ${orderRecognitionSummaryDeltas.partitionDate} = ${partitionDate}
  `);
}

export function aggregateRecognitionSummaryDeltaRows(
  rows: Array<{
    summaryKind: string | null | undefined;
    ruleItemId: number | null | undefined;
    isRefund: boolean | number | null | undefined;
    detailCount: number | string | null | undefined;
    totalAmount: number | string | null | undefined;
  }>,
): RecognitionSummaryDeltaAggregate {
  const result: RecognitionSummaryDeltaAggregate = {
    count: 0,
    totalCents: 0,
    groups: new Map(),
  };
  for (const row of rows) {
    const detailCount = Number(row.detailCount || 0);
    const totalCents = toCents(row.totalAmount || 0);
    if (row.summaryKind === "file_total") {
      result.count += detailCount;
      result.totalCents += totalCents;
      continue;
    }
    const ruleItemId = Number(row.ruleItemId || 0);
    if (row.summaryKind !== "rule_item" || !ruleItemId) continue;
    const isRefund = Number(row.isRefund || 0) === 1;
    const key = orderRecognitionSummaryKey(ruleItemId, isRefund);
    const current = result.groups.get(key) || {
      ruleItemId,
      isRefund,
      detailCount: 0,
      totalCents: 0,
    };
    current.detailCount += detailCount;
    current.totalCents += totalCents;
    result.groups.set(key, current);
  }
  return result;
}

export function subtractRecognitionSummaryDeltaGroups(
  baseGroups: Map<string, OrderRecognitionSummaryGroup>,
  deductions: Map<string, OrderRecognitionSummaryGroup>,
) {
  const result = new Map<string, OrderRecognitionSummaryGroup>();
  for (const [key, group] of baseGroups) {
    const deduction = deductions.get(key);
    const detailCount = group.detailCount - Number(deduction?.detailCount || 0);
    const totalCents = group.totalCents - Number(deduction?.totalCents || 0);
    if (detailCount < 0) return null;
    if (detailCount === 0 && totalCents !== 0) return null;
    if (detailCount === 0 && totalCents === 0) continue;
    result.set(key, {
      ruleItemId: group.ruleItemId,
      isRefund: group.isRefund,
      detailCount,
      totalCents,
    });
  }
  for (const key of deductions.keys()) {
    if (!baseGroups.has(key)) return null;
  }
  return result;
}
