import { describe, expect, it } from "vitest";
import {
  ensureMysqlEvents,
  normalizeEventDefinition,
  resolveNextEventStart,
  resolveEventSpecs,
  validateEventRow,
} from "./ensure-mysql-events.mjs";

const completeBaseDependencies = {
  routineNames: [
    "ensure_bill_details_rolling_partitions",
    "archive_bill_details_daily",
  ],
  tableNames: [],
  hasFuturePartition: true,
  hasLatePartition: true,
};

describe("resolveEventSpecs", () => {
  it("uses the base archive procedure before the storage snapshot migration", () => {
    const specs = resolveEventSpecs(completeBaseDependencies);
    expect(specs.find((spec) => spec.scheduleTime === "03:10:00")?.procedureName)
      .toBe("archive_bill_details_daily");
  });

  it("uses the storage request wrapper when both v10.42 dependencies exist", () => {
    const specs = resolveEventSpecs({
      ...completeBaseDependencies,
      routineNames: [
        ...completeBaseDependencies.routineNames,
        "archive_bill_details_daily_with_storage_request",
      ],
      tableNames: ["system_storage_snapshot"],
    });
    expect(specs.find((spec) => spec.scheduleTime === "03:10:00")?.procedureName)
      .toBe("archive_bill_details_daily_with_storage_request");
  });

  it("rejects a partially applied storage snapshot migration", () => {
    expect(() => resolveEventSpecs({
      ...completeBaseDependencies,
      tableNames: ["system_storage_snapshot"],
    })).toThrow("存储空间快照迁移不完整");
  });

  it("rejects a missing future partition dependency", () => {
    expect(() => resolveEventSpecs({
      ...completeBaseDependencies,
      hasFuturePartition: false,
    })).toThrow("p_future");
  });

  it("rejects a missing late-order partition dependency", () => {
    expect(() => resolveEventSpecs({
      ...completeBaseDependencies,
      hasLatePartition: false,
    })).toThrow("p_late");
  });
});

describe("validateEventRow", () => {
  const rollingSpec = resolveEventSpecs(completeBaseDependencies)
    .find((spec) => spec.scheduleTime === "02:30:00");

  it("accepts the expected enabled rolling partition event", () => {
    expect(validateEventRow(rollingSpec, {
      status: "ENABLED",
      starts: "2026-08-05 02:30:00",
      intervalValue: "1",
      intervalField: "DAY",
      onCompletion: "PRESERVE",
      eventDefinition: "CALL `ensure_bill_details_rolling_partitions`()",
    })).toEqual([]);
  });

  it("reports schedule and procedure drift without normalizing it away", () => {
    const issues = validateEventRow(rollingSpec, {
      status: "DISABLED",
      starts: "2026-08-06 03:10:00",
      intervalValue: "2",
      intervalField: "MONTH",
      onCompletion: "NOT PRESERVE",
      eventDefinition: "CALL archive_bill_details_daily()",
    });
    expect(issues).toHaveLength(6);
    expect(issues.join(" ")).toContain("archive_bill_details_daily");
  });
});

describe("normalizeEventDefinition", () => {
  it("normalizes whitespace, case, backticks, and trailing semicolons", () => {
    expect(normalizeEventDefinition(" CALL  `some_proc` ( ) ; "))
      .toBe("call some_proc()");
  });
});

describe("resolveNextEventStart", () => {
  it("uses the current date before the scheduled time", () => {
    expect(resolveNextEventStart({
      currentDate: "2026-07-16",
      currentTime: "02:29:59",
      scheduleTime: "02:30:00",
    })).toBe("2026-07-16 02:30:00");
  });

  it("rolls to the next date at or after the scheduled time", () => {
    expect(resolveNextEventStart({
      currentDate: "2026-07-16",
      currentTime: "03:10:00",
      scheduleTime: "03:10:00",
    })).toBe("2026-07-17 03:10:00");
  });
});

function createFakeConnection() {
  const events = new Map();
  const queries = [];
  return {
    events,
    queries,
    async query(sql) {
      const statement = String(sql).replace(/\s+/g, " ").trim();
      queries.push(statement);
      if (statement.includes("@@event_scheduler")) return [[{ eventScheduler: "ON" }]];
      if (statement.includes("GET_LOCK")) return [[{ acquired: 1 }]];
      if (statement.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
      if (statement.includes("FROM information_schema.routines")) {
        return [[
          { routineName: "ensure_bill_details_rolling_partitions" },
          { routineName: "archive_bill_details_daily" },
        ]];
      }
      if (statement.includes("FROM information_schema.tables")) return [[]];
      if (statement.includes("FROM information_schema.partitions")) {
        return [[
          { partitionName: "p_late", partitionDescription: "2026-05-18" },
          { partitionName: "p_future", partitionDescription: "MAXVALUE" },
        ]];
      }
      if (statement.includes("FROM information_schema.events")) {
        return [[...events.values()]];
      }
      if (statement.includes("DATE_FORMAT(CURDATE()")) {
        return [[{
          currentDate: "2026-07-16",
          currentTime: "22:00:00",
        }]];
      }
      if (statement.startsWith("CREATE EVENT")) {
        const eventName = statement.match(/CREATE EVENT `([^`]+)`/)?.[1];
        const procedureName = statement.match(/DO CALL `([^`]+)`\(\)/)?.[1];
        const starts = statement.match(/STARTS '([^']+)'/)?.[1];
        const intervalField = statement.match(/EVERY 1 (DAY|MONTH)/)?.[1];
        events.set(eventName, {
          eventName,
          definer: "finance_user@localhost",
          status: "ENABLED",
          starts,
          intervalValue: "1",
          intervalField,
          onCompletion: "PRESERVE",
          eventDefinition: `CALL ${procedureName}()`,
        });
        return [{ affectedRows: 0 }];
      }
      throw new Error(`unexpected query: ${statement}`);
    },
  };
}

describe("ensureMysqlEvents", () => {
  it("creates missing events and is idempotent on the next run", async () => {
    const connection = createFakeConnection();
    const first = await ensureMysqlEvents({ connection });
    expect(first.map((item) => item.action)).toEqual(["created", "created"]);
    expect(connection.events.size).toBe(2);

    const createCountAfterFirstRun = connection.queries
      .filter((query) => query.startsWith("CREATE EVENT")).length;
    const second = await ensureMysqlEvents({ connection });
    expect(second.map((item) => item.action)).toEqual(["unchanged", "unchanged"]);
    expect(connection.queries.filter((query) => query.startsWith("CREATE EVENT")))
      .toHaveLength(createCountAfterFirstRun);
  });
});
