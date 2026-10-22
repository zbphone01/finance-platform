import { createHash } from "node:crypto";
import mysql from "mysql2/promise";
import { env } from "./env";

const WAIT_FOREVER_SECONDS = -1;
const PRIORITY_RETRY_DELAY_MS = 100;

export type NamedLockConnection = {
  query: (sql: string, values?: unknown[]) => Promise<[unknown, unknown]>;
  end: () => Promise<void>;
};

type LockConnectionFactory = (databaseUrl: string) => Promise<NamedLockConnection>;

export type CrossAppDbHeavyLockOptions = {
  databaseUrl?: string;
  lockTimeoutSeconds?: number;
  priorityRetryDelayMs?: number;
  createConnection?: LockConnectionFactory;
};

const defaultCreateConnection: LockConnectionFactory = async (databaseUrl) => {
  const connection = await mysql.createConnection({
    uri: databaseUrl.replace(/^mysql2:/, "mysql:"),
  });
  return {
    query: (sql, values) => connection.query(sql, values as any) as Promise<[unknown, unknown]>,
    end: () => connection.end(),
  };
};

function databaseScopeHash(databaseUrl: string) {
  const normalizedUrl = databaseUrl.replace(/^mysql2:/, "mysql:");
  const databaseName = decodeURIComponent(new URL(normalizedUrl).pathname.replace(/^\/+/, ""));
  if (!databaseName) throw new Error("DATABASE_URL 缺少数据库名称，无法生成跨应用任务锁");
  return createHash("sha256").update(databaseName).digest("hex").slice(0, 16);
}

export function getCrossAppDbHeavyLockNames(databaseUrl: string) {
  const scope = databaseScopeHash(databaseUrl);
  return {
    shared: `finance-db:${scope}:heavy:v1`,
    recognitionPriority: `finance-db:${scope}:recognition:v1`,
  };
}

function readLockResult(rows: unknown) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const value = (rows[0] as { lockResult?: unknown } | undefined)?.lockResult;
  return value === null || value === undefined ? null : Number(value);
}

async function acquireNamedLock(
  connection: NamedLockConnection,
  lockName: string,
  timeoutSeconds: number,
) {
  const [rows] = await connection.query(
    "SELECT GET_LOCK(?, ?) AS lockResult",
    [lockName, timeoutSeconds],
  );
  if (readLockResult(rows) !== 1) {
    throw new Error(`无法取得数据库重任务锁：${lockName}`);
  }
}

async function releaseNamedLock(connection: NamedLockConnection, lockName: string) {
  const [rows] = await connection.query(
    "SELECT RELEASE_LOCK(?) AS lockResult",
    [lockName],
  );
  if (readLockResult(rows) !== 1) {
    throw new Error(`无法释放数据库重任务锁：${lockName}`);
  }
}

async function isNamedLockFree(connection: NamedLockConnection, lockName: string) {
  const [rows] = await connection.query(
    "SELECT IS_FREE_LOCK(?) AS lockResult",
    [lockName],
  );
  const result = readLockResult(rows);
  if (result === null) {
    throw new Error(`无法检查数据库重任务锁：${lockName}`);
  }
  return result === 1;
}

async function wait(milliseconds: number) {
  if (milliseconds <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runWithCrossAppDbHeavyLock<T>(
  jobType: string,
  run: () => Promise<T>,
  options: CrossAppDbHeavyLockOptions = {},
): Promise<T> {
  const databaseUrl = options.databaseUrl ?? env.databaseUrl;
  if (!databaseUrl) throw new Error("DATABASE_URL 未配置，无法执行数据库重任务");

  const lockNames = getCrossAppDbHeavyLockNames(databaseUrl);
  const acquiredLocks: string[] = [];
  const createConnection = options.createConnection ?? defaultCreateConnection;
  const timeoutSeconds = options.lockTimeoutSeconds ?? WAIT_FOREVER_SECONDS;
  const priorityRetryDelayMs = options.priorityRetryDelayMs ?? PRIORITY_RETRY_DELAY_MS;

  let connection: NamedLockConnection | undefined;
  let result: T | undefined;
  let operationError: unknown;

  try {
    connection = await createConnection(databaseUrl);
    if (jobType === "recognition") {
      await acquireNamedLock(connection, lockNames.recognitionPriority, timeoutSeconds);
      acquiredLocks.push(lockNames.recognitionPriority);
      await acquireNamedLock(connection, lockNames.shared, timeoutSeconds);
      acquiredLocks.push(lockNames.shared);
    } else {
      while (true) {
        await acquireNamedLock(connection, lockNames.shared, timeoutSeconds);
        acquiredLocks.push(lockNames.shared);
        if (await isNamedLockFree(connection, lockNames.recognitionPriority)) break;
        await releaseNamedLock(connection, lockNames.shared);
        acquiredLocks.pop();
        await wait(priorityRetryDelayMs);
      }
    }
    result = await run();
  } catch (error) {
    operationError = error;
  }

  let cleanupError: unknown;
  if (connection) {
    for (const lockName of acquiredLocks.reverse()) {
      try {
        await releaseNamedLock(connection, lockName);
      } catch (error) {
        cleanupError ??= error;
      }
    }
    try {
      await connection.end();
    } catch (error) {
      cleanupError ??= error;
    }
  }

  if (operationError) {
    if (cleanupError) {
      console.error("[CrossAppDbHeavyLock] 任务失败后的锁清理同时失败:", cleanupError);
    }
    throw operationError;
  }
  if (cleanupError) throw cleanupError;
  return result as T;
}
