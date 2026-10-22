import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { manualOrderWorkItems } from "@db/schema";

type ManualOrderWorkItemDb = {
  execute: (query: any) => Promise<unknown>;
  select: (...args: any[]) => any;
  delete: (...args: any[]) => any;
};

export type ManualOrderDisplayStatus = "ignored" | "transferred" | "transferred_recognized";

const DETAIL_SYNC_CHUNK_SIZE = 1000;

function uniquePositiveIds(values: number[]) {
  return Array.from(new Set(
    values
      .map(Number)
      .filter((value) => Number.isSafeInteger(value) && value > 0),
  ));
}

function manualOrderDetailCondition() {
  return sql`
    bd.detail_split_file_id IS NULL
    AND (
      (
        bd.operation_status = 'ignored'
        AND bd.match_result_id IS NULL
        AND COALESCE(bd.ignore_reason, '') NOT LIKE '已拆分%'
        AND COALESCE(bd.ignore_reason, '') NOT LIKE '已按明细分账拆分认账%'
      )
      OR bd.operation_status = 'transferred'
    )
  `;
}

export async function syncManualOrderWorkItemsByDetailIds(
  db: ManualOrderWorkItemDb,
  detailIds: number[],
) {
  const ids = uniquePositiveIds(detailIds);
  if (ids.length === 0) return;
  for (let offset = 0; offset < ids.length; offset += DETAIL_SYNC_CHUNK_SIZE) {
    const chunk = ids.slice(offset, offset + DETAIL_SYNC_CHUNK_SIZE);
    const idList = sql.join(chunk.map((id) => sql`${id}`), sql`, `);

    await db.execute(sql`
    INSERT INTO manual_order_work_items (
      detail_id,
      task_id,
      original_task_id,
      order_file_id,
      rule_id,
      summary_date,
      partition_date,
      bill_date,
      upload_date,
      bill_no,
      rule_name,
      description,
      total_amount,
      detail_package_type,
      operation_status,
      display_status,
      match_result_id,
      operation_reason,
      storage_location,
      archive_table,
      created_at,
      updated_at
    )
    SELECT
      bd.id,
      bd.task_id,
      bd.original_task_id,
      bd.order_file_id,
      COALESCE(bd.rule_id, ofl.rule_id, rt.rule_id, 0),
      COALESCE(rt.bill_date, bd.partition_date),
      bd.partition_date,
      bd.bill_date,
      ofl.upload_date,
      bd.bill_no,
      COALESCE(rr.rule_name, ''),
      bd.description,
      bd.total_amount,
      COALESCE(ofl.detail_package_type, 'T+1'),
      bd.operation_status,
      CASE
        WHEN bd.operation_status = 'transferred' AND bd.match_result_id IS NOT NULL
          THEN 'transferred_recognized'
        WHEN bd.operation_status = 'transferred'
          THEN 'transferred'
        ELSE 'ignored'
      END,
      bd.match_result_id,
      bd.ignore_reason,
      'hot',
      NULL,
      NOW(),
      NOW()
    FROM bill_details bd
    LEFT JOIN order_files ofl ON ofl.id = bd.order_file_id
    LEFT JOIN recognition_tasks rt ON rt.id = bd.task_id
    LEFT JOIN recognition_rules rr
      ON rr.id = COALESCE(bd.rule_id, ofl.rule_id, rt.rule_id)
    WHERE bd.id IN (${idList})
      AND ${manualOrderDetailCondition()}
    ON DUPLICATE KEY UPDATE
      task_id = VALUES(task_id),
      original_task_id = VALUES(original_task_id),
      order_file_id = VALUES(order_file_id),
      rule_id = VALUES(rule_id),
      summary_date = VALUES(summary_date),
      partition_date = VALUES(partition_date),
      bill_date = VALUES(bill_date),
      upload_date = VALUES(upload_date),
      bill_no = VALUES(bill_no),
      rule_name = VALUES(rule_name),
      description = VALUES(description),
      total_amount = VALUES(total_amount),
      detail_package_type = VALUES(detail_package_type),
      operation_status = VALUES(operation_status),
      display_status = VALUES(display_status),
      match_result_id = VALUES(match_result_id),
      operation_reason = VALUES(operation_reason),
      storage_location = 'hot',
      archive_table = NULL,
      updated_at = NOW()
    `);

    // 只在热表中已明确恢复为普通状态时删除投影；热表找不到时可能仍在归档表，不能误删。
    await db.execute(sql`
      DELETE work_item
      FROM manual_order_work_items work_item
      INNER JOIN bill_details bd ON bd.id = work_item.detail_id
      WHERE work_item.detail_id IN (${idList})
        AND NOT (${manualOrderDetailCondition()})
    `);
  }
}

export async function syncManualOrderWorkItemsByTaskIds(
  db: ManualOrderWorkItemDb,
  taskIds: number[],
) {
  const ids = uniquePositiveIds(taskIds);
  if (ids.length === 0) return;
  const rows = await db
    .select({ detailId: manualOrderWorkItems.detailId })
    .from(manualOrderWorkItems)
    .where(inArray(manualOrderWorkItems.taskId, ids));
  await syncManualOrderWorkItemsByDetailIds(db, rows.map((row: any) => Number(row.detailId)));
}

export async function deleteManualOrderWorkItemsByOrderFileIds(
  db: ManualOrderWorkItemDb,
  orderFileIds: number[],
) {
  const ids = uniquePositiveIds(orderFileIds);
  if (ids.length === 0) return;
  await db
    .delete(manualOrderWorkItems)
    .where(inArray(manualOrderWorkItems.orderFileId, ids));
}

export async function getManualOrderWorkItemLocators(
  db: ManualOrderWorkItemDb,
  detailIds: number[],
) {
  const ids = uniquePositiveIds(detailIds);
  if (ids.length === 0) return [];
  return db
    .select({
      detailId: manualOrderWorkItems.detailId,
      partitionDate: manualOrderWorkItems.partitionDate,
      storageLocation: manualOrderWorkItems.storageLocation,
      archiveTable: manualOrderWorkItems.archiveTable,
    })
    .from(manualOrderWorkItems)
    .where(inArray(manualOrderWorkItems.detailId, ids));
}

export async function listManualOrderWorkItems(
  db: ManualOrderWorkItemDb,
  input: {
    ruleId?: number;
    status?: ManualOrderDisplayStatus;
    page: number;
    pageSize: number;
  },
) {
  const summaryConditions = [];
  if (input.ruleId) {
    summaryConditions.push(eq(manualOrderWorkItems.ruleId, input.ruleId));
  }
  const itemConditions = [...summaryConditions];
  if (input.status) {
    itemConditions.push(eq(manualOrderWorkItems.displayStatus, input.status));
  }
  const summaryWhere = summaryConditions.length > 0 ? and(...summaryConditions) : undefined;
  const itemWhere = itemConditions.length > 0 ? and(...itemConditions) : undefined;
  const offset = (input.page - 1) * input.pageSize;

  const [items, [totalRow], [summaryRow], ruleOptions] = await Promise.all([
    db
      .select({
        id: manualOrderWorkItems.detailId,
        taskId: manualOrderWorkItems.taskId,
        summaryDate: manualOrderWorkItems.summaryDate,
        billNo: manualOrderWorkItems.billNo,
        ruleId: manualOrderWorkItems.ruleId,
        ruleName: manualOrderWorkItems.ruleName,
        description: manualOrderWorkItems.description,
        amount: manualOrderWorkItems.totalAmount,
        operationStatus: manualOrderWorkItems.operationStatus,
        billDate: manualOrderWorkItems.billDate,
        partitionDate: manualOrderWorkItems.partitionDate,
        detailPackageType: manualOrderWorkItems.detailPackageType,
        uploadDate: manualOrderWorkItems.uploadDate,
        ignoreReason: manualOrderWorkItems.operationReason,
        matchResultId: manualOrderWorkItems.matchResultId,
        storageLocation: manualOrderWorkItems.storageLocation,
      })
      .from(manualOrderWorkItems)
      .where(itemWhere)
      .orderBy(desc(manualOrderWorkItems.summaryDate), desc(manualOrderWorkItems.detailId))
      .limit(input.pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(manualOrderWorkItems)
      .where(itemWhere),
    db
      .select({
        ignoredCount: sql<number>`COALESCE(SUM(CASE WHEN ${manualOrderWorkItems.displayStatus} = 'ignored' THEN 1 ELSE 0 END), 0)`,
        transferredCount: sql<number>`COALESCE(SUM(CASE WHEN ${manualOrderWorkItems.displayStatus} = 'transferred' THEN 1 ELSE 0 END), 0)`,
        transferredRecognizedCount: sql<number>`COALESCE(SUM(CASE WHEN ${manualOrderWorkItems.displayStatus} = 'transferred_recognized' THEN 1 ELSE 0 END), 0)`,
      })
      .from(manualOrderWorkItems)
      .where(summaryWhere),
    db
      .select({
        ruleId: manualOrderWorkItems.ruleId,
        ruleName: manualOrderWorkItems.ruleName,
      })
      .from(manualOrderWorkItems)
      .groupBy(manualOrderWorkItems.ruleId, manualOrderWorkItems.ruleName)
      .orderBy(asc(manualOrderWorkItems.ruleName), asc(manualOrderWorkItems.ruleId)),
  ]);

  return {
    items: items.map((item: any) => ({
      ...item,
      archived: item.storageLocation === "archive",
    })),
    total: Number(totalRow?.total || 0),
    summary: {
      ignoredCount: Number(summaryRow?.ignoredCount || 0),
      transferredCount: Number(summaryRow?.transferredCount || 0),
      transferredRecognizedCount: Number(summaryRow?.transferredRecognizedCount || 0),
    },
    ruleOptions: ruleOptions
      .map((item: any) => ({
        id: Number(item.ruleId || 0),
        name: String(item.ruleName || "").trim() || `规则 ${item.ruleId}`,
      }))
      .filter((item: any) => item.id > 0),
    page: input.page,
    pageSize: input.pageSize,
  };
}
