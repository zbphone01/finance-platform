import { sql } from "drizzle-orm";

type ArchiveWriteDb = {
  execute: (query: any) => Promise<unknown>;
};

export type ArchivedPackageScope = {
  billDate: string;
  ruleId: number;
  detailPackageType: "T+1" | "打包明细";
  orderFileId?: number;
};

export const BILL_DETAIL_COLUMN_NAMES = [
  "id",
  "task_id",
  "rule_id",
  "order_file_id",
  "detail_split_file_id",
  "split_source_detail_id",
  "bill_no",
  "invoice_other_order_no_1",
  "invoice_other_order_no_2",
  "bill_date",
  "partition_date",
  "description",
  "total_amount",
  "refund_amount_snapshot",
  "raw_data",
  "match_status",
  "match_result_id",
  "operation_status",
  "lifecycle_status",
  "original_task_id",
  "original_recognition_date",
  "rule_item_id",
  "ignore_reason",
  "created_at",
] as const;

function rowsFromExecuteResult(result: any): any[] {
  if (Array.isArray(result)) {
    if (Array.isArray(result[0])) return result[0];
    return result;
  }
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
}

export function isBillDetailArchiveTableName(value: string) {
  return /^bill_details_archive_\d{6}$/.test(String(value || ""));
}

function archiveTableSql(tableName: string) {
  if (!isBillDetailArchiveTableName(tableName)) {
    throw new Error("订单明细归档表名称异常");
  }
  return sql.raw(`\`${tableName}\``);
}

function billDetailColumnList(alias?: string) {
  const prefix = alias ? `\`${alias}\`.` : "";
  return sql.raw(BILL_DETAIL_COLUMN_NAMES.map((name) => `${prefix}\`${name}\``).join(", "));
}

function matchResultIdList(matchResultIds: number[]) {
  const ids = Array.from(new Set(matchResultIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)));
  return ids.length > 0 ? sql.join(ids.map((id) => sql`${id}`), sql`, `) : null;
}

function packageScopeCondition(scope: ArchivedPackageScope, detailAlias: string, fileAlias: string) {
  const detail = sql.raw(`\`${detailAlias}\``);
  const file = sql.raw(`\`${fileAlias}\``);
  const packageCondition = scope.detailPackageType === "打包明细"
    ? sql`${file}.detail_package_type = '打包明细' AND ${file}.upload_date = ${scope.billDate}`
    : sql`${detail}.bill_date = ${scope.billDate} AND COALESCE(${file}.detail_package_type, 'T+1') = 'T+1'`;
  return sql.join([
    packageCondition,
    sql`COALESCE(${detail}.rule_id, ${file}.rule_id, 0) = ${scope.ruleId}`,
    sql`${detail}.detail_split_file_id IS NULL`,
    scope.orderFileId ? sql`${detail}.order_file_id = ${scope.orderFileId}` : undefined,
  ].filter(Boolean) as any[], sql` AND `);
}

export async function listBillDetailArchiveTableNames(db: ArchiveWriteDb) {
  const result = await db.execute(sql`
    SELECT table_name AS tableName
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name REGEXP '^bill_details_archive_[0-9]{6}$'
    ORDER BY table_name
  `);
  return rowsFromExecuteResult(result)
    .map((row) => String(row.tableName || row.TABLE_NAME || ""))
    .filter(isBillDetailArchiveTableName);
}

export async function acquireBillDetailArchiveDateLock(db: ArchiveWriteDb, partitionDate: string, timeoutSeconds = 10) {
  const result = await db.execute(sql`
    SELECT GET_LOCK(
      CONCAT(DATABASE(), ':bill_details_archive:', ${partitionDate}),
      ${timeoutSeconds}
    ) AS acquired
  `);
  return Number(rowsFromExecuteResult(result)[0]?.acquired || 0) === 1;
}

export async function releaseBillDetailArchiveDateLock(db: ArchiveWriteDb, partitionDate: string) {
  await db.execute(sql`
    SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':bill_details_archive:', ${partitionDate}))
  `);
}

export async function listArchivedRecognitionPartitionDates(
  db: ArchiveWriteDb,
  archiveTableNames: string[],
  matchResultIds: number[],
) {
  const idList = matchResultIdList(matchResultIds);
  if (!idList) return [];

  const dates = new Set<string>();
  const sourceDetailIds = new Set<number>();
  const hotResult = await db.execute(sql`
    SELECT
      hot_detail.id AS id,
      hot_detail.split_source_detail_id AS splitSourceDetailId,
      hot_detail.partition_date AS partitionDate
    FROM bill_details hot_detail
    WHERE hot_detail.match_result_id IN (${idList})
  `);
  for (const row of rowsFromExecuteResult(hotResult)) {
    const sourceDetailId = Number(row.splitSourceDetailId || row.split_source_detail_id || row.id || 0);
    if (sourceDetailId) sourceDetailIds.add(sourceDetailId);
    const partitionDate = String(row.partitionDate || row.partition_date || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(partitionDate)) dates.add(partitionDate);
  }

  const validTables = Array.from(new Set(archiveTableNames.filter(isBillDetailArchiveTableName)));
  for (const tableName of validTables) {
    const archiveTable = archiveTableSql(tableName);
    const result = await db.execute(sql`
      SELECT
        archived_detail.id AS id,
        archived_detail.split_source_detail_id AS splitSourceDetailId,
        archived_detail.partition_date AS partitionDate
      FROM ${archiveTable} archived_detail
      WHERE archived_detail.match_result_id IN (${idList})
    `);
    for (const row of rowsFromExecuteResult(result)) {
      const sourceDetailId = Number(row.splitSourceDetailId || row.split_source_detail_id || row.id || 0);
      if (sourceDetailId) sourceDetailIds.add(sourceDetailId);
      const partitionDate = String(row.partitionDate || row.partition_date || "");
      if (/^\d{4}-\d{2}-\d{2}$/.test(partitionDate)) dates.add(partitionDate);
    }
  }

  const sourceIdList = matchResultIdList(Array.from(sourceDetailIds));
  if (sourceIdList) {
    for (const tableName of validTables) {
      const archiveTable = archiveTableSql(tableName);
      const result = await db.execute(sql`
        SELECT DISTINCT archived_detail.partition_date AS partitionDate
        FROM ${archiveTable} archived_detail
        WHERE archived_detail.id IN (${sourceIdList})
           OR archived_detail.split_source_detail_id IN (${sourceIdList})
      `);
      for (const row of rowsFromExecuteResult(result)) {
        const partitionDate = String(row.partitionDate || row.partition_date || "");
        if (/^\d{4}-\d{2}-\d{2}$/.test(partitionDate)) dates.add(partitionDate);
      }
    }
  }
  return Array.from(dates).sort();
}

/**
 * Move archived order details linked to a recognition result back to the hot
 * table. The caller clears match_result_id before committing, so cancelled
 * details stay available for a later recognition run instead of becoming
 * unrecognized rows inside an archive table.
 */
export async function restoreArchivedRecognitionDetailsToHotTable(
  db: ArchiveWriteDb,
  archiveTableNames: string[],
  matchResultIds: number[],
) {
  const idList = matchResultIdList(matchResultIds);
  if (!idList) return;

  const validTables = Array.from(new Set(archiveTableNames.filter(isBillDetailArchiveTableName)));
  for (const tableName of validTables) {
    const archiveTable = archiveTableSql(tableName);
    await db.execute(sql`
      INSERT INTO bill_details (${billDetailColumnList()})
      SELECT ${billDetailColumnList("archived_detail")}
      FROM ${archiveTable} archived_detail
      LEFT JOIN bill_details existing_detail
        ON existing_detail.id = archived_detail.id
       AND existing_detail.partition_date = archived_detail.partition_date
      WHERE archived_detail.match_result_id IN (${idList})
        AND existing_detail.id IS NULL
    `);
  }

  // If the cancelled result belongs to a split detail, restore its source row.
  // The source may point at a different remaining split result and therefore
  // would not be covered by the direct match_result_id condition above.
  for (const tableName of validTables) {
    const archiveTable = archiveTableSql(tableName);
    await db.execute(sql`
      INSERT INTO bill_details (${billDetailColumnList()})
      SELECT ${billDetailColumnList("archived_source")}
      FROM ${archiveTable} archived_source
      INNER JOIN bill_details target_split
        ON target_split.split_source_detail_id = archived_source.id
       AND target_split.match_result_id IN (${idList})
      LEFT JOIN bill_details existing_detail
        ON existing_detail.id = archived_source.id
       AND existing_detail.partition_date = archived_source.partition_date
      WHERE existing_detail.id IS NULL
    `);
  }

  // Restore every linked split for the affected source. This lets the caller
  // recompute the source's surviving match_result_id without overlooking a
  // sibling split that was already archived.
  for (const tableName of validTables) {
    const archiveTable = archiveTableSql(tableName);
    await db.execute(sql`
      INSERT INTO bill_details (${billDetailColumnList()})
      SELECT ${billDetailColumnList("archived_split")}
      FROM ${archiveTable} archived_split
      INNER JOIN bill_details source_detail
        ON source_detail.id = archived_split.split_source_detail_id
      LEFT JOIN bill_details existing_detail
        ON existing_detail.id = archived_split.id
       AND existing_detail.partition_date = archived_split.partition_date
      WHERE (
          source_detail.match_result_id IN (${idList})
          OR EXISTS (
            SELECT 1
            FROM bill_details target_split
            WHERE target_split.split_source_detail_id = source_detail.id
              AND target_split.match_result_id IN (${idList})
          )
        )
        AND existing_detail.id IS NULL
    `);
  }

  for (const tableName of validTables) {
    const archiveTable = archiveTableSql(tableName);
    await db.execute(sql`
      DELETE archived_detail
      FROM ${archiveTable} archived_detail
      INNER JOIN bill_details restored_detail
        ON restored_detail.id = archived_detail.id
       AND restored_detail.partition_date = archived_detail.partition_date
      WHERE archived_detail.match_result_id IN (${idList})
        OR EXISTS (
          SELECT 1
          FROM bill_details target_split
          WHERE target_split.split_source_detail_id = archived_detail.id
            AND target_split.match_result_id IN (${idList})
        )
        OR EXISTS (
          SELECT 1
          FROM bill_details source_detail
          WHERE source_detail.id = archived_detail.split_source_detail_id
            AND (
              source_detail.match_result_id IN (${idList})
              OR EXISTS (
                SELECT 1
                FROM bill_details target_split
                WHERE target_split.split_source_detail_id = source_detail.id
                  AND target_split.match_result_id IN (${idList})
              )
            )
        )
    `);
  }
}

/**
 * Restore one archived detail to bill_details inside the caller's transaction.
 * The caller must hold the matching archive date lock before invoking this
 * helper. The archived row is deleted only after an identical hot-table row
 * exists, so any insert or uniqueness failure keeps the archive copy intact.
 */
export async function restoreArchivedDetailToHotTable(
  db: ArchiveWriteDb,
  input: {
    detailId: number;
    partitionDate: string;
  },
) {
  const detailId = Number(input.detailId || 0);
  const partitionDate = String(input.partitionDate || "").trim().split(" ")[0];
  if (!detailId || !/^\d{4}-\d{2}-\d{2}$/.test(partitionDate)) {
    throw new Error("归档订单明细定位信息异常");
  }

  const tableName = `bill_details_archive_${partitionDate.slice(0, 7).replace("-", "")}`;
  if (!isBillDetailArchiveTableName(tableName)) {
    throw new Error("订单明细归档表名称异常");
  }
  const [tableExists] = rowsFromExecuteResult(await db.execute(sql`
    SELECT COUNT(*) AS count
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = ${tableName}
  `));
  if (Number(tableExists?.count || 0) === 0) return false;

  const archiveTable = archiveTableSql(tableName);
  await db.execute(sql`
    INSERT INTO bill_details (${billDetailColumnList()})
    SELECT ${billDetailColumnList("archived_detail")}
    FROM ${archiveTable} archived_detail
    LEFT JOIN bill_details existing_detail
      ON existing_detail.id = archived_detail.id
     AND existing_detail.partition_date = archived_detail.partition_date
    WHERE archived_detail.id = ${detailId}
      AND archived_detail.partition_date = ${partitionDate}
      AND existing_detail.id IS NULL
  `);

  const [restored] = rowsFromExecuteResult(await db.execute(sql`
    SELECT COUNT(*) AS count
    FROM bill_details restored_detail
    WHERE restored_detail.id = ${detailId}
      AND restored_detail.partition_date = ${partitionDate}
  `));
  if (Number(restored?.count || 0) === 0) return false;

  await db.execute(sql`
    DELETE archived_detail
    FROM ${archiveTable} archived_detail
    INNER JOIN bill_details restored_detail
      ON restored_detail.id = archived_detail.id
     AND restored_detail.partition_date = archived_detail.partition_date
    WHERE archived_detail.id = ${detailId}
      AND archived_detail.partition_date = ${partitionDate}
  `);
  return true;
}

/**
 * Move the selected archived source package and its linked split details back to
 * bill_details inside the caller's transaction. The package delete path then
 * reuses the normal hot-table rollback logic, while the transaction makes the
 * restore + rollback + delete sequence atomic.
 */
export async function restoreArchivedPackageToHotTable(
  db: ArchiveWriteDb,
  archiveTableNames: string[],
  scope: ArchivedPackageScope,
) {
  const validTables = Array.from(new Set(archiveTableNames.filter(isBillDetailArchiveTableName)));
  if (validTables.length === 0) return;

  // Restore source order details first so linked split rows can find their
  // split_source_detail_id in the hot table regardless of their archive month.
  for (const tableName of validTables) {
    const archiveTable = archiveTableSql(tableName);
    const sourceScope = packageScopeCondition(scope, "archived_source", "source_file");
    await db.execute(sql`
      INSERT INTO bill_details (${billDetailColumnList()})
      SELECT ${billDetailColumnList("archived_source")}
      FROM ${archiveTable} archived_source
      INNER JOIN order_files source_file ON source_file.id = archived_source.order_file_id
      LEFT JOIN bill_details existing_detail
        ON existing_detail.id = archived_source.id
       AND existing_detail.partition_date = archived_source.partition_date
      WHERE ${sourceScope}
        AND existing_detail.id IS NULL
    `);
  }

  // Restore linked split details from every archive month. Their order_file_id
  // can be NULL, so they must be located through split_source_detail_id.
  for (const tableName of validTables) {
    const archiveTable = archiveTableSql(tableName);
    const sourceScope = packageScopeCondition(scope, "source_detail", "source_file");
    await db.execute(sql`
      INSERT INTO bill_details (${billDetailColumnList()})
      SELECT ${billDetailColumnList("archived_split")}
      FROM ${archiveTable} archived_split
      INNER JOIN bill_details source_detail
        ON source_detail.id = archived_split.split_source_detail_id
      INNER JOIN order_files source_file ON source_file.id = source_detail.order_file_id
      LEFT JOIN bill_details existing_detail
        ON existing_detail.id = archived_split.id
       AND existing_detail.partition_date = archived_split.partition_date
      WHERE ${sourceScope}
        AND archived_split.detail_split_file_id IS NOT NULL
        AND existing_detail.id IS NULL
    `);
  }

  // Remove only rows that now have an identical hot-table copy. Any insert or
  // uniqueness failure aborts the transaction before archived data is deleted.
  for (const tableName of validTables) {
    const archiveTable = archiveTableSql(tableName);
    const sourceScope = packageScopeCondition(scope, "source_detail", "source_file");
    await db.execute(sql`
      DELETE archived_split
      FROM ${archiveTable} archived_split
      INNER JOIN bill_details restored_split
        ON restored_split.id = archived_split.id
       AND restored_split.partition_date = archived_split.partition_date
      INNER JOIN bill_details source_detail
        ON source_detail.id = archived_split.split_source_detail_id
      INNER JOIN order_files source_file ON source_file.id = source_detail.order_file_id
      WHERE ${sourceScope}
        AND archived_split.detail_split_file_id IS NOT NULL
    `);
  }

  for (const tableName of validTables) {
    const archiveTable = archiveTableSql(tableName);
    const sourceScope = packageScopeCondition(scope, "archived_source", "source_file");
    await db.execute(sql`
      DELETE archived_source
      FROM ${archiveTable} archived_source
      INNER JOIN order_files source_file ON source_file.id = archived_source.order_file_id
      INNER JOIN bill_details restored_source
        ON restored_source.id = archived_source.id
       AND restored_source.partition_date = archived_source.partition_date
      WHERE ${sourceScope}
    `);
  }
}

export async function refreshArchiveRunSnapshots(
  db: ArchiveWriteDb,
  archiveTableNames: string[],
  partitionDates: string[],
) {
  const tables = new Set(archiveTableNames.filter(isBillDetailArchiveTableName));
  const dates = Array.from(new Set(partitionDates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))));
  for (const partitionDate of dates) {
    const tableName = `bill_details_archive_${partitionDate.slice(0, 7).replace("-", "")}`;
    if (!tables.has(tableName)) continue;
    const archiveTable = archiveTableSql(tableName);
    const summaryResult = await db.execute(sql`
      SELECT
        COUNT(*) AS detailCount,
        COALESCE(SUM(CAST(archived_detail.total_amount AS DECIMAL(18,2))), 0.00) AS detailTotal
      FROM ${archiveTable} archived_detail
      WHERE archived_detail.partition_date = ${partitionDate}
    `);
    const summary = rowsFromExecuteResult(summaryResult)[0] || {};
    const detailCount = Number(summary.detailCount || 0);
    const detailTotal = Number(summary.detailTotal || 0).toFixed(2);
    await db.execute(sql`
      UPDATE bill_detail_archive_runs archive_run
      SET
        archive_run.source_count = ${detailCount},
        archive_run.archive_count = ${detailCount},
        archive_run.source_total = ${detailTotal},
        archive_run.archive_total = ${detailTotal}
      WHERE archive_run.archive_date = ${partitionDate}
        AND archive_run.archive_table = ${tableName}
    `);
  }
}
