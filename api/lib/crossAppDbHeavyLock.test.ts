import { describe, expect, it } from "vitest";
import {
  getCrossAppDbHeavyLockNames,
  runWithCrossAppDbHeavyLock,
  type NamedLockConnection,
} from "./crossAppDbHeavyLock";

function createFakeConnection(events: string[], priorityStates: number[] = [1]): NamedLockConnection {
  return {
    async query(sql, values) {
      const lockName = String(values?.[0] || "");
      const action = sql.includes("GET_LOCK")
        ? "acquire"
        : sql.includes("IS_FREE_LOCK")
          ? "is-free"
          : "release";
      events.push(`${action}:${lockName}`);
      const lockResult = action === "is-free"
        ? priorityStates.shift() ?? 1
        : 1;
      return [[{ lockResult }], []];
    },
    async end() {
      events.push("end");
    },
  };
}

const databaseUrl = "mysql://test:test@127.0.0.1:3306/finance_recon_test";

describe("crossAppDbHeavyLock", () => {
  it("同一数据库不受账号变化影响并生成稳定的环境隔离锁名", () => {
    const first = getCrossAppDbHeavyLockNames(databaseUrl);
    const sameDatabase = getCrossAppDbHeavyLockNames(
      "mysql://another:secret@db.example.com:3307/finance_recon_test",
    );
    const otherDatabase = getCrossAppDbHeavyLockNames(
      "mysql://test:test@127.0.0.1:3306/finance_recon_prod",
    );

    expect(first).toEqual(sameDatabase);
    expect(first).not.toEqual(otherDatabase);
    expect(first.shared.length).toBeLessThanOrEqual(64);
    expect(first.recognitionPriority.length).toBeLessThanOrEqual(64);
  });

  it("普通数据库重任务只取得共享互斥锁", async () => {
    const events: string[] = [];
    const lockNames = getCrossAppDbHeavyLockNames(databaseUrl);

    const result = await runWithCrossAppDbHeavyLock(
      "order-upload-import",
      async () => {
        events.push("run");
        return "done";
      },
      {
        databaseUrl,
        createConnection: async () => {
          events.push("connect");
          return createFakeConnection(events);
        },
      },
    );

    expect(result).toBe("done");
    expect(events).toEqual([
      "connect",
      `acquire:${lockNames.shared}`,
      `is-free:${lockNames.recognitionPriority}`,
      "run",
      `release:${lockNames.shared}`,
      "end",
    ]);
  });

  it("普通重任务发现认账优先锁被占用时释放共享锁并重试", async () => {
    const events: string[] = [];
    const lockNames = getCrossAppDbHeavyLockNames(databaseUrl);

    await runWithCrossAppDbHeavyLock(
      "order-upload-import",
      async () => {
        events.push("run");
      },
      {
        databaseUrl,
        priorityRetryDelayMs: 0,
        createConnection: async () => createFakeConnection(events, [0, 1]),
      },
    );

    expect(events).toEqual([
      `acquire:${lockNames.shared}`,
      `is-free:${lockNames.recognitionPriority}`,
      `release:${lockNames.shared}`,
      `acquire:${lockNames.shared}`,
      `is-free:${lockNames.recognitionPriority}`,
      "run",
      `release:${lockNames.shared}`,
      "end",
    ]);
  });

  it("认账任务先声明优先级，再取得共享互斥锁", async () => {
    const events: string[] = [];
    const lockNames = getCrossAppDbHeavyLockNames(databaseUrl);

    await runWithCrossAppDbHeavyLock(
      "recognition",
      async () => {
        events.push("run");
      },
      {
        databaseUrl,
        createConnection: async () => createFakeConnection(events),
      },
    );

    expect(events).toEqual([
      `acquire:${lockNames.recognitionPriority}`,
      `acquire:${lockNames.shared}`,
      "run",
      `release:${lockNames.shared}`,
      `release:${lockNames.recognitionPriority}`,
      "end",
    ]);
  });

  it("任务失败时按相反顺序释放锁并保留原始错误", async () => {
    const events: string[] = [];
    const lockNames = getCrossAppDbHeavyLockNames(databaseUrl);
    const expectedError = new Error("recognition failed");

    await expect(runWithCrossAppDbHeavyLock(
      "recognition",
      async () => {
        events.push("run");
        throw expectedError;
      },
      {
        databaseUrl,
        createConnection: async () => createFakeConnection(events),
      },
    )).rejects.toBe(expectedError);

    expect(events).toEqual([
      `acquire:${lockNames.recognitionPriority}`,
      `acquire:${lockNames.shared}`,
      "run",
      `release:${lockNames.shared}`,
      `release:${lockNames.recognitionPriority}`,
      "end",
    ]);
  });
});
