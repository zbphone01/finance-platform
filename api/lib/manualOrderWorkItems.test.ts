import { describe, expect, it } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import {
  listManualOrderWorkItems,
  syncManualOrderWorkItemsByDetailIds,
} from "./manualOrderWorkItems";

describe("manual order work item synchronization", () => {
  const dialect = new MySqlDialect();

  it("upserts only manual-processing rows and removes rows restored to active", async () => {
    const statements: string[] = [];
    const db = {
      execute: async (query: any) => {
        statements.push(dialect.sqlToQuery(query).sql);
        return [[]];
      },
      select: () => {
        throw new Error("unexpected select");
      },
      delete: () => {
        throw new Error("unexpected delete");
      },
    };

    await syncManualOrderWorkItemsByDetailIds(db, [12, 12, 34]);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("INSERT INTO manual_order_work_items");
    expect(statements[0]).toContain("bd.id IN (?, ?)");
    expect(statements[0]).toContain("bd.detail_split_file_id IS NULL");
    expect(statements[0]).toContain("bd.operation_status = 'transferred'");
    expect(statements[0]).toContain("THEN 'transferred_recognized'");
    expect(statements[0]).toContain("ON DUPLICATE KEY UPDATE");
    expect(statements[0]).toContain("storage_location = 'hot'");
    expect(statements[1]).toContain("DELETE work_item");
    expect(statements[1]).toContain("INNER JOIN bill_details bd");
    expect(statements[1]).toContain("AND NOT (");
  });

  it("does not query the database when there are no valid detail ids", async () => {
    let executeCount = 0;
    const db = {
      execute: async () => {
        executeCount += 1;
        return [[]];
      },
      select: () => {
        throw new Error("unexpected select");
      },
      delete: () => {
        throw new Error("unexpected delete");
      },
    };

    await syncManualOrderWorkItemsByDetailIds(db, [0, -1, Number.NaN]);
    expect(executeCount).toBe(0);
  });

  it("returns archived state, independent-table summaries and rule options", async () => {
    const responses = [
      [{
        id: 123,
        operationStatus: "transferred",
        matchResultId: 456,
        storageLocation: "archive",
      }],
      [{ total: 1 }],
      [{ ignoredCount: 2, transferredCount: 3, transferredRecognizedCount: 4 }],
      [{ ruleId: 20, ruleName: "支付宝 T+1" }],
    ];
    const createBuilder = (result: any) => {
      const builder: any = {
        from: () => builder,
        where: () => builder,
        orderBy: () => builder,
        limit: () => builder,
        offset: () => builder,
        groupBy: () => builder,
        then: (resolve: (value: any) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject),
      };
      return builder;
    };
    const db = {
      execute: async () => {
        throw new Error("unexpected execute");
      },
      select: () => createBuilder(responses.shift()),
      delete: () => {
        throw new Error("unexpected delete");
      },
    };

    await expect(listManualOrderWorkItems(db, {
      ruleId: 20,
      status: "transferred_recognized",
      page: 1,
      pageSize: 20,
    })).resolves.toMatchObject({
      items: [{
        id: 123,
        archived: true,
      }],
      total: 1,
      summary: {
        ignoredCount: 2,
        transferredCount: 3,
        transferredRecognizedCount: 4,
      },
      ruleOptions: [{ id: 20, name: "支付宝 T+1" }],
    });
  });
});
