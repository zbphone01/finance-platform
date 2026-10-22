import { sql } from "drizzle-orm";
import { billDetails, orderFilePartitions } from "@db/schema";

type PartitionDb = {
  execute: (query: any) => Promise<unknown>;
};

type PartitionDelta = {
  orderFileId: number;
  partitionDate: string;
  delta: number;
};

function rowsFromExecuteResult(result: any): any[] {
  if (Array.isArray(result)) {
    if (Array.isArray(result[0])) return result[0];
    return result;
  }
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
}

function normalizePartitionDate(value: string | null | undefined) {
  const text = String(value || "").trim().split(" ")[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

export async function listOrderFilePartitionDates(db: PartitionDb, orderFileId: number) {
  if (!Number(orderFileId)) return [];
  const result = await db.execute(sql`
    SELECT ${orderFilePartitions.partitionDate} AS partitionDate
    FROM ${orderFilePartitions}
    WHERE ${orderFilePartitions.orderFileId} = ${orderFileId}
      AND ${orderFilePartitions.detailCount} > 0
    ORDER BY ${orderFilePartitions.partitionDate}
  `);
  return rowsFromExecuteResult(result)
    .map((row) => normalizePartitionDate(String(row.partitionDate || "")))
    .filter(Boolean);
}

export async function syncOrderFilePartitionsByOrderFileId(db: PartitionDb, orderFileId: number) {
  if (!Number(orderFileId)) return;
  await db.execute(sql`
    INSERT INTO ${orderFilePartitions} (
      ${orderFilePartitions.orderFileId},
      ${orderFilePartitions.partitionDate},
      ${orderFilePartitions.detailCount},
      ${orderFilePartitions.updatedAt}
    )
    SELECT
      ${billDetails.orderFileId},
      ${billDetails.partitionDate},
      COUNT(*),
      NOW()
    FROM ${billDetails}
    WHERE ${billDetails.orderFileId} = ${orderFileId}
      AND ${billDetails.detailSplitFileId} IS NULL
    GROUP BY ${billDetails.orderFileId}, ${billDetails.partitionDate}
    ON DUPLICATE KEY UPDATE
      ${orderFilePartitions.detailCount} = VALUES(detail_count),
      ${orderFilePartitions.updatedAt} = NOW()
  `);
}

export async function clearOrderFilePartitionsByOrderFileIds(db: PartitionDb, orderFileIds: number[]) {
  const ids = Array.from(new Set(orderFileIds.map(Number).filter(Boolean)));
  if (ids.length === 0) return;
  for (let index = 0; index < ids.length; index += 5000) {
    const chunk = ids.slice(index, index + 5000);
    await db.execute(sql`
      DELETE FROM ${orderFilePartitions}
      WHERE ${orderFilePartitions.orderFileId} IN (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)})
    `);
  }
}

export async function applyOrderFilePartitionDeltas(db: PartitionDb, deltas: PartitionDelta[]) {
  const aggregated = new Map<string, PartitionDelta>();
  for (const item of deltas) {
    const orderFileId = Number(item.orderFileId || 0);
    const partitionDate = normalizePartitionDate(item.partitionDate);
    const delta = Number(item.delta || 0);
    if (!orderFileId || !partitionDate || !delta) continue;
    const key = `${orderFileId}|${partitionDate}`;
    const current = aggregated.get(key);
    if (current) {
      current.delta += delta;
    } else {
      aggregated.set(key, { orderFileId, partitionDate, delta });
    }
  }

  for (const item of aggregated.values()) {
    if (item.delta > 0) {
      await db.execute(sql`
        INSERT INTO ${orderFilePartitions} (
          ${orderFilePartitions.orderFileId},
          ${orderFilePartitions.partitionDate},
          ${orderFilePartitions.detailCount},
          ${orderFilePartitions.updatedAt}
        )
        VALUES (${item.orderFileId}, ${item.partitionDate}, ${item.delta}, NOW())
        ON DUPLICATE KEY UPDATE
          ${orderFilePartitions.detailCount} = ${orderFilePartitions.detailCount} + ${item.delta},
          ${orderFilePartitions.updatedAt} = NOW()
      `);
      continue;
    }

    const decrement = Math.abs(item.delta);
    await db.execute(sql`
      UPDATE ${orderFilePartitions}
      SET
        ${orderFilePartitions.detailCount} = GREATEST(${orderFilePartitions.detailCount} - ${decrement}, 0),
        ${orderFilePartitions.updatedAt} = NOW()
      WHERE ${orderFilePartitions.orderFileId} = ${item.orderFileId}
        AND ${orderFilePartitions.partitionDate} = ${item.partitionDate}
    `);
    await db.execute(sql`
      DELETE FROM ${orderFilePartitions}
      WHERE ${orderFilePartitions.orderFileId} = ${item.orderFileId}
        AND ${orderFilePartitions.partitionDate} = ${item.partitionDate}
        AND ${orderFilePartitions.detailCount} <= 0
    `);
  }
}

export async function moveOrderFilePartitionDetail(
  db: PartitionDb,
  input: {
    orderFileId: number;
    detailId?: number | null;
    fromPartitionDate?: string | null;
    toPartitionDate?: string | null;
  },
) {
  const orderFileId = Number(input.orderFileId || 0);
  if (!orderFileId) return;
  const fromPartitionDate = normalizePartitionDate(input.fromPartitionDate || "");
  const toPartitionDate = normalizePartitionDate(input.toPartitionDate || "");
  if (!fromPartitionDate || !toPartitionDate || fromPartitionDate === toPartitionDate) return;
  await applyOrderFilePartitionDeltas(db, [
    { orderFileId, partitionDate: fromPartitionDate, delta: -1 },
    { orderFileId, partitionDate: toPartitionDate, delta: 1 },
  ]);
}
