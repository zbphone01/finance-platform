import { sql } from "drizzle-orm";
import { listOrderFilePartitionDates } from "./orderFilePartitions";

type DetailPackageType = "T+1" | "打包明细";

type DetailReadDb = {
  execute: (query: any) => Promise<unknown>;
};

type TaskDetailStatus =
  | "recognized"
  | "unrecognized"
  | "unrecognized_all"
  | "pending_split"
  | "transferred_in";

type OrderFileDetailStatus = "matched" | "unmatched" | "pending_split" | "unmatched_with_pending_split";

export function normalizeArchiveDate(dateStr: string): string {
  let value = String(dateStr || "").replace(/\//g, "-").trim();
  value = value.split(" ")[0];
  const parts = value.split("-");
  if (parts.length === 3) {
    value = `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("日期格式异常");
  }
  return value;
}

export function addArchiveDays(dateStr: string, days: number): string {
  const normalized = normalizeArchiveDate(dateStr);
  const [year, month, day] = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function rowsFromExecuteResult(result: any): any[] {
  if (Array.isArray(result)) {
    if (Array.isArray(result[0])) return result[0];
    return result;
  }
  if (Array.isArray(result?.rows)) return result.rows;
  return [];
}

async function executeRows(db: DetailReadDb, query: any) {
  const result = await db.execute(query);
  return rowsFromExecuteResult(result);
}

async function listAllDetailSources(db: DetailReadDb) {
  const archiveTableRows = await executeRows(db, sql`
    SELECT table_name AS tableName
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name REGEXP '^bill_details_archive_[0-9]{6}$'
    ORDER BY table_name
  `);
  return [
    { tableName: "bill_details", archived: false },
    ...archiveTableRows
      .map((row) => String(row.tableName || ""))
      .filter((tableName) => /^bill_details_archive_\d{6}$/.test(tableName))
      .map((tableName) => ({ tableName, archived: true })),
  ];
}

export async function getDetailSourceTables(db: DetailReadDb, partitionDate: string) {
  const normalizedDate = normalizeArchiveDate(partitionDate);
  const sources = [{ tableName: "bill_details", archived: false }];
  try {
    const rows = await executeRows(db, sql`
      SELECT archive_table AS archiveTable
      FROM bill_detail_archive_runs
      WHERE archive_date = ${normalizedDate}
        AND status = 'completed'
      ORDER BY id DESC
      LIMIT 1
    `);
    const archiveTable = String(rows[0]?.archiveTable || "");
    if (/^bill_details_archive_\d{6}$/.test(archiveTable)) {
      sources.push({ tableName: archiveTable, archived: true });
    }
  } catch (error: any) {
    if (error?.code !== "ER_NO_SUCH_TABLE" && error?.errno !== 1146) {
      throw error;
    }
  }
  return sources;
}

export async function hasArchivedOrderPackage(db: DetailReadDb, input: {
  partitionDate: string;
  packageBillDate: string;
  detailPackageType: DetailPackageType;
  ruleId: number;
}) {
  const partitionDate = normalizeArchiveDate(input.partitionDate);
  const packageBillDate = normalizeArchiveDate(input.packageBillDate);
  const sources = await getDetailSourceTables(db, partitionDate);
  for (const source of sources) {
    if (!source.archived) continue;
    const tableSql = sql.raw(source.tableName);
    const packageCondition = input.detailPackageType === "打包明细"
      ? sql`ofl.detail_package_type = '打包明细' AND ofl.upload_date = ${packageBillDate}`
      : sql`bd.bill_date = ${packageBillDate} AND COALESCE(ofl.detail_package_type, 'T+1') = 'T+1'`;
    const rows = await executeRows(db, sql`
      SELECT 1 AS packageExists
      FROM ${tableSql} bd
      LEFT JOIN order_files ofl ON ofl.id = bd.order_file_id
      WHERE bd.partition_date = ${partitionDate}
        AND bd.detail_split_file_id IS NULL
        AND bd.rule_id = ${input.ruleId}
        AND ${packageCondition}
      LIMIT 1
    `);
    if (rows.length > 0) return true;
    const legacyRows = await executeRows(db, sql`
      SELECT 1 AS packageExists
      FROM ${tableSql} bd
      LEFT JOIN order_files ofl ON ofl.id = bd.order_file_id
      WHERE bd.partition_date = ${partitionDate}
        AND bd.detail_split_file_id IS NULL
        AND bd.rule_id IS NULL
        AND ofl.rule_id = ${input.ruleId}
        AND ${packageCondition}
      LIMIT 1
    `);
    if (legacyRows.length > 0) return true;
  }
  return false;
}

export async function getBillDetailForManualRecognition(db: DetailReadDb, input: {
  detailId: number;
  partitionDate: string;
}) {
  const detailId = Number(input.detailId || 0);
  if (!detailId) throw new Error("订单明细 ID 异常");
  const partitionDate = normalizeArchiveDate(input.partitionDate);
  const sources = await getDetailSourceTables(db, partitionDate);

  for (const source of sources) {
    const tableSql = sql.raw(source.tableName);
    const rows = await executeRows(db, sql`
      SELECT
        bd.id AS id,
        bd.task_id AS taskId,
        bd.order_file_id AS orderFileId,
        bd.detail_split_file_id AS detailSplitFileId,
        bd.bill_no AS billNo,
        rr.rule_name AS ruleName,
        bd.description AS description,
        bd.total_amount AS amount,
        bd.total_amount AS totalAmount,
        bd.refund_amount_snapshot AS refundAmountSnapshot,
        bd.raw_data AS rawData,
        ofl.raw_columns AS rawColumns,
        ofl.file_name AS orderFileName,
        ofl.upload_status AS orderFileUploadStatus,
        bd.operation_status AS operationStatus,
        bd.bill_date AS billDate,
        bd.partition_date AS partitionDate,
        ofl.detail_package_type AS detailPackageType,
        ofl.upload_date AS uploadDate,
        COALESCE(bd.rule_id, ofl.rule_id) AS ruleId,
        bd.rule_item_id AS ruleItemId,
        rt.bill_date AS taskBillDate,
        bd.match_result_id AS matchResultId,
        bd.match_status AS matchStatus,
        bd.ignore_reason AS ignoreReason,
        EXISTS (
          SELECT 1 FROM match_results mr_manual_detail
          WHERE mr_manual_detail.id = bd.match_result_id
            AND mr_manual_detail.bank_flow_id IS NOT NULL
            AND mr_manual_detail.rule_item_id IS NULL
            AND mr_manual_detail.income_rule_id IS NULL
            AND COALESCE(mr_manual_detail.order_detail_count_snapshot, 0) = 1
        ) AS manualRecognition
      FROM ${tableSql} bd
      LEFT JOIN order_files ofl ON ofl.id = bd.order_file_id
      LEFT JOIN recognition_tasks rt ON rt.id = bd.task_id
      LEFT JOIN recognition_rules rr ON rr.id = COALESCE(bd.rule_id, ofl.rule_id)
      WHERE bd.id = ${detailId}
        AND bd.partition_date = ${partitionDate}
      LIMIT 1
    `);
    if (rows.length > 0) {
      return {
        ...rows[0],
        archived: source.archived,
      };
    }
  }
  return null;
}

export async function hasArchivedDetailSplitFileRows(db: DetailReadDb, detailSplitFileId: number) {
  const id = Number(detailSplitFileId || 0);
  if (!id) return false;
  const sources = await listAllDetailSources(db);
  for (const source of sources) {
    if (!source.archived) continue;
    const tableSql = sql.raw(source.tableName);
    const rows = await executeRows(db, sql`
      SELECT 1 AS rowExists
      FROM ${tableSql} bd
      WHERE bd.detail_split_file_id = ${id}
      LIMIT 1
    `);
    if (rows.length > 0) return true;
  }
  return false;
}

export async function listDetailSplitFileBillDetails(db: DetailReadDb, input: {
  detailSplitFileId: number;
  matchStatus?: "matched" | "unmatched" | "recognized" | "unrecognized";
  page: number;
  pageSize: number;
}) {
  const detailSplitFileId = Number(input.detailSplitFileId || 0);
  if (!detailSplitFileId) throw new Error("明细分账上传批次 ID 异常");
  const conditions = [sql`bd.detail_split_file_id = ${detailSplitFileId}`];
  if (input.matchStatus === "recognized") conditions.push(sql`bd.match_result_id IS NOT NULL`);
  if (input.matchStatus === "unrecognized") conditions.push(sql`bd.match_result_id IS NULL`);
  if (input.matchStatus === "matched") {
    conditions.push(sql`bd.match_status = 'matched' AND bd.match_result_id IS NULL`);
  }
  if (input.matchStatus === "unmatched") conditions.push(sql`bd.match_status = 'unmatched'`);
  const whereSql = sql.join(conditions, sql` AND `);
  const sources = await listAllDetailSources(db);
  const offset = (input.page - 1) * input.pageSize;
  const itemLimit = offset + input.pageSize;
  const itemCandidates: any[] = [];
  let total = 0;

  for (const source of sources) {
    const tableSql = sql.raw(source.tableName);
    const items = await executeRows(db, sql`
      SELECT
        bd.id AS id,
        bd.bill_date AS billDate,
        bd.bill_no AS billNo,
        bd.description AS description,
        bd.total_amount AS totalAmount,
        bd.raw_data AS rawData,
        bd.match_status AS matchStatus,
        bd.match_result_id AS matchResultId,
        bd.partition_date AS partitionDate
      FROM ${tableSql} bd
      WHERE ${whereSql}
      ORDER BY bd.id
      LIMIT ${itemLimit}
    `);
    itemCandidates.push(...items.map((item) => ({ ...item, archived: source.archived })));
    const [countRow] = await executeRows(db, sql`
      SELECT COUNT(*) AS detailCount
      FROM ${tableSql} bd
      WHERE ${whereSql}
    `);
    total += Number(countRow?.detailCount || 0);
  }

  return {
    items: dedupeDetailsById(itemCandidates)
      .sort((left, right) => Number(left.id || 0) - Number(right.id || 0))
      .slice(offset, offset + input.pageSize),
    total,
    page: input.page,
    pageSize: input.pageSize,
  };
}

function dedupeDetailsById(items: any[]) {
  const byId = new Map<number, any>();
  for (const item of items) {
    const id = Number(item?.id || 0);
    if (!id || !byId.has(id)) byId.set(id, item);
  }
  return Array.from(byId.values());
}

function numberInListSql(values: number[]) {
  const uniqueValues = Array.from(new Set(values.map(Number).filter((value) => Number.isFinite(value) && value > 0)));
  if (uniqueValues.length === 0) return undefined;
  return sql.raw(uniqueValues.join(","));
}

function dateInListSql(values: string[]) {
  const uniqueValues = Array.from(new Set(values.map(normalizeArchiveDate)));
  if (uniqueValues.length === 0) return undefined;
  return sql.join(uniqueValues.map((value) => sql`${value}`), sql`, `);
}

function taskStatusCondition(status?: TaskDetailStatus) {
  if (status === "recognized") return sql`bd.match_result_id IS NOT NULL`;
  if (status === "unrecognized_all") {
    return sql`bd.match_result_id IS NULL AND COALESCE(bd.operation_status, 'active') IN ('active', 'transferred')`;
  }
  if (status === "unrecognized") {
    return sql`bd.match_result_id IS NULL AND COALESCE(bd.operation_status, 'active') IN ('active', 'transferred') AND bd.match_status <> 'pending_split'`;
  }
  if (status === "pending_split") {
    return sql`bd.match_result_id IS NULL AND COALESCE(bd.operation_status, 'active') IN ('active', 'transferred') AND bd.match_status = 'pending_split'`;
  }
  if (status === "transferred_in") return sql`bd.operation_status = 'transferred'`;
  return undefined;
}

function orderFileStatusCondition(status?: OrderFileDetailStatus) {
  if (status === "unmatched_with_pending_split") return sql`bd.match_status IN ('unmatched', 'pending_split')`;
  if (status === "matched") return sql`bd.match_status = 'matched'`;
  if (status === "unmatched") return sql`bd.match_status = 'unmatched'`;
  if (status === "pending_split") return sql`bd.match_status = 'pending_split'`;
  return undefined;
}

export async function listTaskDateBillDetails(db: DetailReadDb, input: {
  summaryDate: string;
  orderDate: string;
  detailPackageType: DetailPackageType;
  targetRuleIds: number[];
  status?: TaskDetailStatus;
  amountSearch?: string;
  page: number;
  pageSize: number;
}) {
  const summaryDate = normalizeArchiveDate(input.summaryDate);
  const orderDate = normalizeArchiveDate(input.orderDate);
  const sources = await getDetailSourceTables(db, summaryDate);
  const conditions = [
    sql`bd.partition_date = ${summaryDate}`,
    sql`bd.detail_split_file_id IS NULL`,
    sql`COALESCE(bd.operation_status, 'active') <> 'ignored'`,
    input.detailPackageType === "打包明细"
      ? sql`ofl.detail_package_type = '打包明细' AND ofl.upload_date = ${summaryDate}`
      : sql`COALESCE(ofl.detail_package_type, 'T+1') = 'T+1' AND (bd.bill_date = ${orderDate} OR bd.operation_status = 'transferred')`,
  ];
  const ruleList = numberInListSql(input.targetRuleIds);
  if (ruleList) conditions.push(sql`bd.rule_id IN (${ruleList})`);
  const statusSql = taskStatusCondition(input.status);
  if (statusSql) conditions.push(statusSql);
  const amountSearch = input.amountSearch?.trim();
  if (amountSearch) conditions.push(sql`CAST(bd.total_amount AS CHAR) LIKE ${`%${amountSearch}%`}`);
  const whereSql = sql.join(conditions, sql` AND `);
  const offset = (input.page - 1) * input.pageSize;
  const itemLimit = offset + input.pageSize;
  const itemCandidates: any[] = [];
  let total = 0;
  let archived = false;
  for (const source of sources) {
    const tableSql = sql.raw(source.tableName);
    const items = await executeRows(db, sql`
      SELECT
        bd.id AS id,
        bd.bill_no AS billNo,
        rr.rule_name AS ruleName,
        bd.description AS description,
        bd.total_amount AS amount,
        bd.operation_status AS operationStatus,
        bd.bill_date AS billDate,
        ofl.detail_package_type AS detailPackageType,
        ofl.upload_date AS uploadDate,
        bd.original_task_id AS originalTaskId,
        bd.match_result_id AS matchResultId,
        bd.match_status AS matchStatus,
        EXISTS (
          SELECT 1 FROM match_results mr_manual_detail
          WHERE mr_manual_detail.id = bd.match_result_id
            AND mr_manual_detail.bank_flow_id IS NOT NULL
            AND mr_manual_detail.rule_item_id IS NULL
            AND mr_manual_detail.income_rule_id IS NULL
            AND COALESCE(mr_manual_detail.order_detail_count_snapshot, 0) = 1
        ) AS manualRecognition
      FROM ${tableSql} bd
      LEFT JOIN order_files ofl ON bd.order_file_id = ofl.id
      LEFT JOIN recognition_rules rr ON rr.id = COALESCE(bd.rule_id, ofl.rule_id)
      WHERE ${whereSql}
      ORDER BY bd.id
      LIMIT ${itemLimit}
    `);
    itemCandidates.push(...items.map((item) => ({
      ...item,
      partitionDate: summaryDate,
      archived: source.archived,
    })));
    const countRows = await executeRows(db, sql`
      SELECT COUNT(*) AS count
      FROM ${tableSql} bd
      LEFT JOIN order_files ofl ON bd.order_file_id = ofl.id
      WHERE ${whereSql}
    `);
    total += Number(countRows[0]?.count || 0);
    archived = archived || source.archived;
  }
  const items = dedupeDetailsById(itemCandidates)
    .sort((left, right) => Number(left.id || 0) - Number(right.id || 0))
    .slice(offset, offset + input.pageSize);

  return {
    items,
    total,
    page: input.page,
    pageSize: input.pageSize,
    archived,
  };
}

export async function listOrderFilePackageBillDetails(db: DetailReadDb, input: {
  partitionDate: string;
  packageBillDate: string;
  detailPackageType: DetailPackageType;
  ruleId: number;
  matchStatus?: OrderFileDetailStatus;
  page: number;
  pageSize: number;
}) {
  const partitionDate = normalizeArchiveDate(input.partitionDate);
  const packageBillDate = normalizeArchiveDate(input.packageBillDate);
  const sources = await getDetailSourceTables(db, partitionDate);
  const conditions = [
    sql`bd.partition_date = ${partitionDate}`,
    sql`bd.detail_split_file_id IS NULL`,
    sql`COALESCE(bd.rule_id, ofl.rule_id, 0) = ${input.ruleId}`,
    input.detailPackageType === "打包明细"
      ? sql`ofl.detail_package_type = '打包明细' AND ofl.upload_date = ${packageBillDate}`
      : sql`bd.bill_date = ${packageBillDate} AND COALESCE(ofl.detail_package_type, 'T+1') = 'T+1'`,
  ];
  const statusSql = orderFileStatusCondition(input.matchStatus);
  if (statusSql) conditions.push(statusSql);
  const whereSql = sql.join(conditions, sql` AND `);
  const summaryWhereSql = sql.join(conditions.slice(0, 4), sql` AND `);
  const offset = (input.page - 1) * input.pageSize;

  const itemLimit = offset + input.pageSize;
  const itemCandidates: any[] = [];
  let total = 0;
  let archived = false;
  const summary = {
    entryCount: 0,
    orderTotalAmount: 0,
    refundAmount: 0,
    matchedCount: 0,
    unmatchedCount: 0,
    pendingSplitCount: 0,
  };
  for (const source of sources) {
    const tableSql = sql.raw(source.tableName);
    const items = await executeRows(db, sql`
      SELECT
        bd.id AS id,
        bd.bill_date AS billDate,
        bd.description AS description,
        bd.total_amount AS totalAmount,
        bd.raw_data AS rawData,
        bd.match_status AS matchStatus,
        bd.operation_status AS operationStatus,
        bd.ignore_reason AS ignoreReason
      FROM ${tableSql} bd
      LEFT JOIN order_files ofl ON bd.order_file_id = ofl.id
      WHERE ${whereSql}
      ORDER BY bd.id
      LIMIT ${itemLimit}
    `);
    itemCandidates.push(...items.map((item) => ({
      ...item,
      partitionDate,
      archived: source.archived,
    })));
    const countRows = await executeRows(db, sql`
      SELECT COUNT(*) AS count
      FROM ${tableSql} bd
      LEFT JOIN order_files ofl ON bd.order_file_id = ofl.id
      WHERE ${whereSql}
    `);
    total += Number(countRows[0]?.count || 0);
    const summaryRows = await executeRows(db, sql`
      SELECT
        COUNT(*) AS entryCount,
        COALESCE(SUM(CASE WHEN CAST(bd.refund_amount_snapshot AS DECIMAL(18,2)) > 0 THEN 0 ELSE CAST(bd.total_amount AS DECIMAL(18,2)) END), 0.00) AS orderTotalAmount,
        COALESCE(SUM(CAST(bd.refund_amount_snapshot AS DECIMAL(18,2))), 0.00) AS refundAmount,
        SUM(CASE WHEN bd.match_status = 'matched' THEN 1 ELSE 0 END) AS matchedCount,
        SUM(CASE WHEN bd.match_status = 'unmatched' THEN 1 ELSE 0 END) AS unmatchedCount,
        SUM(CASE WHEN bd.match_status = 'pending_split' THEN 1 ELSE 0 END) AS pendingSplitCount
      FROM ${tableSql} bd
      LEFT JOIN order_files ofl ON bd.order_file_id = ofl.id
      WHERE ${summaryWhereSql}
    `);
    const groupSummary = summaryRows[0] || {};
    summary.entryCount += Number(groupSummary.entryCount || 0);
    summary.orderTotalAmount += Number(groupSummary.orderTotalAmount || 0);
    summary.refundAmount += Number(groupSummary.refundAmount || 0);
    summary.matchedCount += Number(groupSummary.matchedCount || 0);
    summary.unmatchedCount += Number(groupSummary.unmatchedCount || 0);
    summary.pendingSplitCount += Number(groupSummary.pendingSplitCount || 0);
    archived = archived || source.archived;
  }
  const items = dedupeDetailsById(itemCandidates)
    .sort((left, right) => Number(left.id || 0) - Number(right.id || 0))
    .slice(offset, offset + input.pageSize);

  return {
    items,
    total,
    summary: {
      entryCount: summary.entryCount,
      orderTotalAmount: summary.orderTotalAmount.toFixed(2),
      refundAmount: summary.refundAmount.toFixed(2),
      matchedCount: summary.matchedCount,
      unmatchedCount: summary.unmatchedCount,
      pendingSplitCount: summary.pendingSplitCount,
    },
    page: input.page,
    pageSize: input.pageSize,
    archived,
  };
}

export async function listOrderFileBillDetails(db: DetailReadDb, input: {
  orderFileId: number;
  matchStatus?: OrderFileDetailStatus;
  page: number;
  pageSize: number;
}) {
  const orderFileId = Number(input.orderFileId || 0);
  if (!orderFileId) throw new Error("订单文件 ID 异常");

  const partitionDates = await listOrderFilePartitionDates(db, orderFileId);

  const sourceGroups = new Map<string, { tableName: string; archived: boolean; partitionDates: string[] | null }>();
  if (partitionDates.length === 0) {
    sourceGroups.set("bill_details", { tableName: "bill_details", archived: false, partitionDates: null });
  } else {
    for (const partitionDate of partitionDates) {
      const sources = await getDetailSourceTables(db, partitionDate);
      for (const source of sources) {
        const current = sourceGroups.get(source.tableName) || {
          tableName: source.tableName,
          archived: source.archived,
          partitionDates: [],
        };
        current.partitionDates?.push(normalizeArchiveDate(partitionDate));
        sourceGroups.set(source.tableName, current);
      }
    }
  }

  const statusSql = orderFileStatusCondition(input.matchStatus);
  const offset = (input.page - 1) * input.pageSize;
  const itemLimit = offset + input.pageSize;
  let total = 0;
  let archived = false;
  const itemCandidates: any[] = [];
  const summary = {
    entryCount: 0,
    orderTotalAmount: 0,
    refundAmount: 0,
    matchedCount: 0,
    unmatchedCount: 0,
    pendingSplitCount: 0,
  };

  for (const source of sourceGroups.values()) {
    const tableSql = sql.raw(source.tableName);
    const partitionList = source.partitionDates ? dateInListSql(source.partitionDates) : undefined;
    const baseConditions = [
      sql`bd.order_file_id = ${orderFileId}`,
      sql`bd.detail_split_file_id IS NULL`,
    ];
    if (partitionList) {
      baseConditions.push(sql`bd.partition_date IN (${partitionList})`);
    }
    const itemConditions = [...baseConditions];
    if (statusSql) itemConditions.push(statusSql);
    const whereSql = sql.join(itemConditions, sql` AND `);
    const summaryWhereSql = sql.join(baseConditions, sql` AND `);

    const rows = await executeRows(db, sql`
      SELECT
        bd.id AS id,
        bd.bill_date AS billDate,
        bd.description AS description,
        bd.total_amount AS totalAmount,
        bd.raw_data AS rawData,
        bd.match_status AS matchStatus,
        bd.operation_status AS operationStatus,
        bd.ignore_reason AS ignoreReason
      FROM ${tableSql} bd
      WHERE ${whereSql}
      ORDER BY bd.id
      LIMIT ${itemLimit}
    `);
    itemCandidates.push(...rows.map((item) => ({
      ...item,
      archived: source.archived,
    })));

    const countRows = await executeRows(db, sql`
      SELECT COUNT(*) AS count
      FROM ${tableSql} bd
      WHERE ${whereSql}
    `);
    total += Number(countRows[0]?.count || 0);

    const summaryRows = await executeRows(db, sql`
      SELECT
        COUNT(*) AS entryCount,
        COALESCE(SUM(CASE WHEN CAST(bd.refund_amount_snapshot AS DECIMAL(18,2)) > 0 THEN 0 ELSE CAST(bd.total_amount AS DECIMAL(18,2)) END), 0.00) AS orderTotalAmount,
        COALESCE(SUM(CAST(bd.refund_amount_snapshot AS DECIMAL(18,2))), 0.00) AS refundAmount,
        SUM(CASE WHEN bd.match_status = 'matched' THEN 1 ELSE 0 END) AS matchedCount,
        SUM(CASE WHEN bd.match_status = 'unmatched' THEN 1 ELSE 0 END) AS unmatchedCount,
        SUM(CASE WHEN bd.match_status = 'pending_split' THEN 1 ELSE 0 END) AS pendingSplitCount
      FROM ${tableSql} bd
      WHERE ${summaryWhereSql}
    `);
    const groupSummary = summaryRows[0] || {};
    summary.entryCount += Number(groupSummary.entryCount || 0);
    summary.orderTotalAmount += Number(groupSummary.orderTotalAmount || 0);
    summary.refundAmount += Number(groupSummary.refundAmount || 0);
    summary.matchedCount += Number(groupSummary.matchedCount || 0);
    summary.unmatchedCount += Number(groupSummary.unmatchedCount || 0);
    summary.pendingSplitCount += Number(groupSummary.pendingSplitCount || 0);
    archived = archived || source.archived;
  }

  const items = dedupeDetailsById(itemCandidates)
    .sort((left, right) => Number(left.id || 0) - Number(right.id || 0))
    .slice(offset, offset + input.pageSize);

  return {
    items,
    total,
    summary: {
      entryCount: summary.entryCount,
      orderTotalAmount: summary.orderTotalAmount.toFixed(2),
      refundAmount: summary.refundAmount.toFixed(2),
      matchedCount: summary.matchedCount,
      unmatchedCount: summary.unmatchedCount,
      pendingSplitCount: summary.pendingSplitCount,
    },
    page: input.page,
    pageSize: input.pageSize,
    archived,
  };
}

export function getPackageScopePartitionDate(input: {
  billDate: string;
  detailPackageType: DetailPackageType;
}) {
  const billDate = normalizeArchiveDate(input.billDate);
  return input.detailPackageType === "打包明细" ? billDate : addArchiveDays(billDate, 1);
}
