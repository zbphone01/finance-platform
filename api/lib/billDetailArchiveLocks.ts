import mysql from "mysql2/promise";
import { env } from "./env";

const ARCHIVE_LOCK_TIMEOUT_SECONDS = 10;

function normalizePartitionDate(value: string) {
  const date = String(value || "").trim().split(" ")[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("订单明细归档锁日期格式异常");
  }
  return date;
}

function addUtcDays(dateStr: string, days: number) {
  const [year, month, day] = normalizePartitionDate(dateStr).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function isBillDetailArchiveEligibleDate(partitionDate: string, today: string) {
  return normalizePartitionDate(partitionDate) <= addUtcDays(today, -60);
}

export async function createBillDetailArchiveLockSession(
  timeoutSeconds = ARCHIVE_LOCK_TIMEOUT_SECONDS,
) {
  const databaseUrl = String(env.databaseUrl || "").replace(/^mysql2:/, "mysql:");
  const connection = await mysql.createConnection({ uri: databaseUrl, dateStrings: true });
  const acquiredDates = new Set<string>();
  let released = false;

  return {
    async acquire(partitionDates: string[]) {
      if (released) throw new Error("订单明细归档锁会话已经关闭");
      const dates = Array.from(new Set(partitionDates.map(normalizePartitionDate))).sort();
      for (const partitionDate of dates) {
        if (acquiredDates.has(partitionDate)) continue;
        const [rows]: any = await connection.query(
          "SELECT GET_LOCK(CONCAT(DATABASE(), ':bill_details_archive:', ?), ?) AS acquired",
          [partitionDate, timeoutSeconds],
        );
        if (Number(rows?.[0]?.acquired || 0) !== 1) {
          throw new Error(`${partitionDate} 的订单明细正在归档，请稍后重试`);
        }
        acquiredDates.add(partitionDate);
      }
    },
    async release() {
      if (released) return;
      released = true;
      for (const partitionDate of Array.from(acquiredDates).sort().reverse()) {
        try {
          await connection.query(
            "SELECT RELEASE_LOCK(CONCAT(DATABASE(), ':bill_details_archive:', ?))",
            [partitionDate],
          );
        } catch {
          // Closing the dedicated connection also releases any remaining locks.
        }
      }
      await connection.end();
    },
  };
}

/**
 * Hold MySQL advisory locks on a dedicated connection while the callback uses
 * the normal application pool. This closes the archive-check / hot-table-check /
 * insert race without forcing a large upload batch onto one database transaction.
 */
export async function withBillDetailArchiveDateLocks<T>(
  partitionDates: string[],
  callback: () => Promise<T>,
  timeoutSeconds = ARCHIVE_LOCK_TIMEOUT_SECONDS,
) {
  const dates = Array.from(new Set(partitionDates.map(normalizePartitionDate))).sort();
  if (dates.length === 0) return callback();

  const session = await createBillDetailArchiveLockSession(timeoutSeconds);
  try {
    await session.acquire(dates);
    return await callback();
  } finally {
    await session.release();
  }
}
