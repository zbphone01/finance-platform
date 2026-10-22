import { config } from "dotenv";
import mysql from "mysql2/promise";
import { pathToFileURL } from "node:url";

config({ quiet: true });

const EVENT_LOCK_TIMEOUT_SECONDS = 10;
const EVENT_LOCK_SUFFIX = ":deploy:mysql-events";

export function normalizeEventDefinition(value) {
  return String(value || "")
    .replace(/`/g, "")
    .replace(/;/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*\(\s*\)/g, "()")
    .trim()
    .toLowerCase();
}

function hasScheduleAnchor(starts, scheduleTime) {
  const value = String(starts || "");
  return new RegExp(`^\\d{4}-\\d{2}-\\d{2} ${scheduleTime}$`).test(value);
}

export function validateEventRow(spec, row) {
  const issues = [];
  if (String(row?.status || "").toUpperCase() !== "ENABLED") {
    issues.push(`状态应为 ENABLED，实际为 ${row?.status || "空"}`);
  }
  if (String(row?.intervalValue || "") !== "1") {
    issues.push(`执行间隔值应为 1，实际为 ${row?.intervalValue || "空"}`);
  }
  if (String(row?.intervalField || "").toUpperCase() !== spec.intervalField) {
    issues.push(`执行间隔单位应为 ${spec.intervalField}，实际为 ${row?.intervalField || "空"}`);
  }
  if (String(row?.onCompletion || "").toUpperCase() !== "PRESERVE") {
    issues.push(`ON COMPLETION 应为 PRESERVE，实际为 ${row?.onCompletion || "空"}`);
  }
  if (!hasScheduleAnchor(row?.starts, spec.scheduleTime)) {
    issues.push(`开始时间不符合 ${spec.scheduleLabel}，实际为 ${row?.starts || "空"}`);
  }

  const expectedDefinition = normalizeEventDefinition(`CALL ${spec.procedureName}()`);
  const actualDefinition = normalizeEventDefinition(row?.eventDefinition);
  if (actualDefinition !== expectedDefinition) {
    issues.push(`调用过程应为 ${expectedDefinition}，实际为 ${actualDefinition || "空"}`);
  }
  return issues;
}

export function resolveEventSpecs({
  routineNames,
  tableNames,
  hasFuturePartition,
  hasLatePartition,
}) {
  const routines = new Set(routineNames || []);
  const tables = new Set(tableNames || []);
  const rollingPartitionProcedure = "ensure_bill_details_rolling_partitions";
  const baseArchiveProcedure = "archive_bill_details_daily";
  const storageArchiveProcedure = "archive_bill_details_daily_with_storage_request";
  const storageTable = "system_storage_snapshot";

  if (!routines.has(rollingPartitionProcedure)) {
    throw new Error(`缺少存储过程 ${rollingPartitionProcedure}，请先人工执行 v10.43 数据库迁移`);
  }
  if (!hasFuturePartition) {
    throw new Error("bill_details 缺少 p_future MAXVALUE 分区，请先人工修复分区结构");
  }
  if (!hasLatePartition) {
    throw new Error("bill_details 缺少 p_late 迟到订单处理分区，请先人工执行 v10.43 数据库迁移");
  }
  if (!routines.has(baseArchiveProcedure)) {
    throw new Error(`缺少存储过程 ${baseArchiveProcedure}，请先人工执行对应数据库迁移`);
  }

  const hasStorageProcedure = routines.has(storageArchiveProcedure);
  const hasStorageTable = tables.has(storageTable);
  if (hasStorageProcedure !== hasStorageTable) {
    throw new Error(
      `检测到存储空间快照迁移不完整：${storageArchiveProcedure} 与 ${storageTable} 必须同时存在`,
    );
  }

  const archiveProcedure = hasStorageProcedure ? storageArchiveProcedure : baseArchiveProcedure;
  return [
    {
      eventName: "ev_bill_details_rolling_partitions",
      procedureName: rollingPartitionProcedure,
      intervalField: "DAY",
      scheduleTime: "02:30:00",
      scheduleLabel: "每日 02:30:00",
    },
    {
      eventName: "ev_bill_details_archive_old_daily_partitions",
      procedureName: archiveProcedure,
      intervalField: "DAY",
      scheduleTime: "03:10:00",
      scheduleLabel: "每日 03:10:00",
    },
  ];
}

async function loadDependencies(connection) {
  const [routineRows] = await connection.query(`
    SELECT routine_name AS routineName
    FROM information_schema.routines
    WHERE routine_schema = DATABASE()
      AND routine_type = 'PROCEDURE'
      AND routine_name IN (
        'ensure_bill_details_rolling_partitions',
        'archive_bill_details_daily',
        'archive_bill_details_daily_with_storage_request'
      )
  `);
  const [tableRows] = await connection.query(`
    SELECT table_name AS tableName
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'system_storage_snapshot'
  `);
  const [partitionRows] = await connection.query(`
    SELECT
      partition_name AS partitionName,
      partition_description AS partitionDescription
    FROM information_schema.partitions
    WHERE table_schema = DATABASE()
      AND table_name = 'bill_details'
      AND partition_name IN ('p_late', 'p_future')
  `);
  const partitionByName = new Map(
    partitionRows.map((row) => [String(row.partitionName), String(row.partitionDescription || "")]),
  );
  return {
    routineNames: routineRows.map((row) => String(row.routineName)),
    tableNames: tableRows.map((row) => String(row.tableName)),
    hasFuturePartition: partitionByName.get("p_future") === "MAXVALUE",
    hasLatePartition: partitionByName.has("p_late"),
  };
}

async function loadEventRows(connection, eventNames) {
  const [rows] = await connection.query(
    `
      SELECT
        event_name AS eventName,
        definer AS definer,
        status AS status,
        starts AS starts,
        interval_value AS intervalValue,
        interval_field AS intervalField,
        on_completion AS onCompletion,
        event_definition AS eventDefinition
      FROM information_schema.events
      WHERE event_schema = DATABASE()
        AND event_name IN (?, ?)
    `,
    eventNames,
  );
  return new Map(rows.map((row) => [String(row.eventName), row]));
}

function addIsoDateDays(dateStr, days) {
  const [year, month, day] = String(dateStr).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function resolveNextEventStart({ currentDate, currentTime, scheduleTime }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(currentDate || ""))) {
    throw new Error(`非法数据库日期：${currentDate || "空"}`);
  }
  if (!/^\d{2}:\d{2}:\d{2}$/.test(String(currentTime || ""))) {
    throw new Error(`非法数据库时间：${currentTime || "空"}`);
  }
  if (!/^\d{2}:\d{2}:\d{2}$/.test(scheduleTime)) {
    throw new Error(`非法 Event 执行时间：${scheduleTime}`);
  }
  const startDate = currentTime < scheduleTime
    ? currentDate
    : addIsoDateDays(currentDate, 1);
  return `${startDate} ${scheduleTime}`;
}

async function nextStartAt(connection, scheduleTime) {
  const [rows] = await connection.query(`
    SELECT
      DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS currentDate,
      DATE_FORMAT(CURTIME(), '%H:%i:%s') AS currentTime
  `);
  return resolveNextEventStart({
    currentDate: String(rows[0]?.currentDate || ""),
    currentTime: String(rows[0]?.currentTime || ""),
    scheduleTime,
  });
}

function assertSafeIdentifier(value) {
  if (!/^[a-z0-9_]+$/.test(value)) {
    throw new Error(`非法 MySQL 标识符：${value}`);
  }
  return `\`${value}\``;
}

async function createEvent(connection, spec) {
  const eventName = assertSafeIdentifier(spec.eventName);
  const procedureName = assertSafeIdentifier(spec.procedureName);
  const nextStart = await nextStartAt(connection, spec.scheduleTime);
  await connection.query(`
    CREATE EVENT ${eventName}
    ON SCHEDULE EVERY 1 ${spec.intervalField}
    STARTS '${nextStart}'
    ON COMPLETION PRESERVE ENABLE
    DO CALL ${procedureName}()
  `);
  return nextStart;
}

export async function ensureMysqlEvents({ connection, checkOnly = false }) {
  const [schedulerRows] = await connection.query("SELECT @@event_scheduler AS eventScheduler");
  const scheduler = String(schedulerRows[0]?.eventScheduler || "").toUpperCase();
  if (scheduler !== "ON") {
    throw new Error(`MySQL event_scheduler 必须为 ON，当前为 ${scheduler || "未知"}`);
  }

  const [lockRows] = await connection.query(
    "SELECT GET_LOCK(CONCAT(DATABASE(), ?), ?) AS acquired",
    [EVENT_LOCK_SUFFIX, EVENT_LOCK_TIMEOUT_SECONDS],
  );
  if (Number(lockRows[0]?.acquired || 0) !== 1) {
    throw new Error("无法取得 MySQL Event 部署锁，可能有其他部署正在执行");
  }

  const createdEventNames = [];
  try {
    const specs = resolveEventSpecs(await loadDependencies(connection));
    const eventNames = specs.map((spec) => spec.eventName);
    const existingEvents = await loadEventRows(connection, eventNames);

    for (const spec of specs) {
      const existing = existingEvents.get(spec.eventName);
      if (!existing) continue;
      const issues = validateEventRow(spec, existing);
      if (issues.length > 0) {
        throw new Error(
          `${spec.eventName} 定义与当前数据库依赖不一致：${issues.join("；")}。请人工执行对应迁移，不会自动覆盖`,
        );
      }
    }

    const missingSpecs = specs.filter((spec) => !existingEvents.has(spec.eventName));
    if (checkOnly && missingSpecs.length > 0) {
      throw new Error(`缺少 MySQL Event：${missingSpecs.map((spec) => spec.eventName).join("、")}`);
    }

    const createdStarts = new Map();
    for (const spec of missingSpecs) {
      const starts = await createEvent(connection, spec);
      createdEventNames.push(spec.eventName);
      createdStarts.set(spec.eventName, starts);
    }

    const verifiedEvents = await loadEventRows(connection, eventNames);
    for (const spec of specs) {
      const verified = verifiedEvents.get(spec.eventName);
      if (!verified) {
        throw new Error(`${spec.eventName} 补建后仍不存在`);
      }
      const issues = validateEventRow(spec, verified);
      if (issues.length > 0) {
        throw new Error(`${spec.eventName} 补建后校验失败：${issues.join("；")}`);
      }
    }

    return specs.map((spec) => {
      const row = verifiedEvents.get(spec.eventName);
      return {
        eventName: spec.eventName,
        action: createdStarts.has(spec.eventName) ? "created" : "unchanged",
        starts: String(row.starts),
        scheduleLabel: spec.scheduleLabel,
        procedureName: spec.procedureName,
        definer: String(row.definer || ""),
      };
    });
  } catch (error) {
    for (const eventName of createdEventNames.reverse()) {
      try {
        await connection.query(`DROP EVENT IF EXISTS ${assertSafeIdentifier(eventName)}`);
      } catch (cleanupError) {
        console.error(`[mysql-events] 清理本轮新建 Event 失败：${eventName}`, cleanupError);
      }
    }
    throw error;
  } finally {
    await connection.query("SELECT RELEASE_LOCK(CONCAT(DATABASE(), ?))", [EVENT_LOCK_SUFFIX]);
  }
}

async function main() {
  const databaseUrl = String(process.env.DATABASE_URL || "").replace(/^mysql2:/, "mysql:");
  if (!databaseUrl) {
    throw new Error("DATABASE_URL 未配置");
  }
  const checkOnly = process.argv.includes("--check-only");
  const connection = await mysql.createConnection({ uri: databaseUrl, dateStrings: true });
  try {
    const results = await ensureMysqlEvents({ connection, checkOnly });
    console.log(`[mysql-events] event_scheduler=ON，数据库 Event 校验通过`);
    for (const result of results) {
      const action = result.action === "created" ? "已补建" : "已存在";
      console.log(
        `[mysql-events] ${result.eventName} ${action}：${result.scheduleLabel}，调用 ${result.procedureName}()，STARTS ${result.starts}，DEFINER ${result.definer}`,
      );
    }
  } finally {
    await connection.end();
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(`[mysql-events] ${error?.message || error}`);
    process.exitCode = 1;
  });
}
