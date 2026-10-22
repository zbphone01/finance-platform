import { eq } from "drizzle-orm";
import { systemStorageSnapshot } from "@db/schema";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { userHasPermission } from "./lib/permissions";

export const systemInfoRouter = createRouter({
  storage: authedQuery.query(async ({ ctx }) => {
    if (!(await userHasPermission(ctx.user, "account_management_menu_access"))) {
      throw new Error("权限不足");
    }

    const [row] = await getDb()
      .select()
      .from(systemStorageSnapshot)
      .where(eq(systemStorageSnapshot.id, 1))
      .limit(1);

    if (!row) {
      return {
        status: "unavailable" as const,
        requestDate: null,
        requestedArchiveDate: null,
        errorMessage: null,
        snapshot: null,
      };
    }

    const hasSnapshot = Boolean(
      row.snapshotDate &&
      row.mountPath &&
      row.totalBytes !== null &&
      row.usedBytes !== null &&
      row.availableBytes !== null &&
      row.usagePercent !== null &&
      row.capturedAt,
    );

    return {
      status: row.status,
      requestDate: row.requestDate,
      requestedArchiveDate: row.requestedArchiveDate,
      errorMessage: row.errorMessage,
      snapshot: hasSnapshot ? {
        snapshotDate: row.snapshotDate!,
        archiveDate: row.archiveDate,
        mountPath: row.mountPath!,
        totalBytes: Number(row.totalBytes),
        usedBytes: Number(row.usedBytes),
        availableBytes: Number(row.availableBytes),
        usagePercent: Number(row.usagePercent),
        capturedAt: row.capturedAt!,
      } : null,
    };
  }),
});
