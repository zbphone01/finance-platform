import { statfs } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { systemStorageSnapshot } from "@db/schema";
import { getDb } from "../queries/connection";
import { env } from "./env";

const SNAPSHOT_ID = 1;
const COLLECT_INTERVAL_MS = 5 * 60 * 1000;
const MAX_SAFE_BYTES = BigInt(Number.MAX_SAFE_INTEGER);

export type DiskStatFs = {
  bsize: bigint;
  blocks: bigint;
  bavail: bigint;
};

export type DiskUsageMetrics = {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usagePercent: number;
};

type StatFsReader = (path: string, options: { bigint: true }) => Promise<DiskStatFs>;

function safeByteNumber(value: bigint, fieldName: string) {
  if (value < 0n || value > MAX_SAFE_BYTES) {
    throw new Error(`${fieldName} exceeds the supported range`);
  }
  return Number(value);
}

export function calculateDiskUsage(stats: DiskStatFs): DiskUsageMetrics {
  const totalBytes = stats.bsize * stats.blocks;
  const availableBytes = stats.bsize * stats.bavail;
  if (totalBytes <= 0n) throw new Error("data disk capacity is unavailable");
  if (availableBytes < 0n || availableBytes > totalBytes) {
    throw new Error("data disk available capacity is invalid");
  }

  // 已占用口径为总容量 - 普通用户可用容量，包含文件系统保留空间。
  const usedBytes = totalBytes - availableBytes;
  const usageHundredths = (usedBytes * 10_000n + totalBytes / 2n) / totalBytes;

  return {
    totalBytes: safeByteNumber(totalBytes, "totalBytes"),
    usedBytes: safeByteNumber(usedBytes, "usedBytes"),
    availableBytes: safeByteNumber(availableBytes, "availableBytes"),
    usagePercent: Number(usageHundredths) / 100,
  };
}

export async function readDiskUsage(
  mountPath: string,
  statFsReader: StatFsReader = (path, options) => statfs(path, options),
) {
  const stats = await statFsReader(mountPath, { bigint: true });
  return calculateDiskUsage(stats);
}

let collectionPromise: Promise<StorageCollectionResult> | null = null;

export type StorageCollectionResult = {
  processed: boolean;
  status?: "completed" | "failed";
  requestDate?: string;
  message?: string;
};

async function collectPendingStorageSnapshotInternal(): Promise<StorageCollectionResult> {
  const db = getDb();
  const [request] = await db
    .select()
    .from(systemStorageSnapshot)
    .where(eq(systemStorageSnapshot.id, SNAPSHOT_ID))
    .limit(1);

  if (!request || (request.status !== "pending" && request.status !== "capturing")) {
    return { processed: false };
  }

  const requestDate = request.requestDate;
  const requestDateLabel = requestDate instanceof Date
    ? requestDate.toISOString().slice(0, 10)
    : String(requestDate);
  await db
    .update(systemStorageSnapshot)
    .set({
      status: "capturing",
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(systemStorageSnapshot.id, SNAPSHOT_ID));

  try {
    const metrics = await readDiskUsage(env.dataDiskPath);
    await db
      .update(systemStorageSnapshot)
      .set({
        status: "completed",
        snapshotDate: requestDate,
        archiveDate: request.requestedArchiveDate,
        mountPath: env.dataDiskPath,
        totalBytes: metrics.totalBytes,
        usedBytes: metrics.usedBytes,
        availableBytes: metrics.availableBytes,
        usagePercent: metrics.usagePercent.toFixed(2),
        capturedAt: new Date(),
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(systemStorageSnapshot.id, SNAPSHOT_ID));
    return { processed: true, status: "completed", requestDate: requestDateLabel };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(systemStorageSnapshot)
      .set({
        status: "failed",
        errorMessage: message.slice(0, 1000),
        updatedAt: new Date(),
      })
      .where(eq(systemStorageSnapshot.id, SNAPSHOT_ID));
    return { processed: true, status: "failed", requestDate: requestDateLabel, message };
  }
}

export function collectPendingStorageSnapshot(): Promise<StorageCollectionResult> {
  if (!collectionPromise) {
    collectionPromise = collectPendingStorageSnapshotInternal().finally(() => {
      collectionPromise = null;
    });
  }
  return collectionPromise;
}

async function runCollectorOnce() {
  try {
    const result = await collectPendingStorageSnapshot();
    if (result.status === "completed") {
      console.log(`[diskUsageSnapshot] captured for ${result.requestDate}`);
    } else if (result.status === "failed") {
      console.error(`[diskUsageSnapshot] failed for ${result.requestDate}: ${result.message}`);
    }
  } catch (error) {
    console.error("[diskUsageSnapshot] collector failed:", error);
  }
}

export function startDiskUsageSnapshotCollector() {
  const initialTimer = setTimeout(() => void runCollectorOnce(), 30_000);
  const interval = setInterval(() => void runCollectorOnce(), COLLECT_INTERVAL_MS);
  return () => {
    clearTimeout(initialTimer);
    clearInterval(interval);
  };
}
