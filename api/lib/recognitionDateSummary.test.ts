import { describe, expect, it } from "vitest";
import { deriveSummaryStatus } from "./recognitionDateSummary";

describe("recognition date summary status", () => {
  it("does not keep an expense-only date pending recognition", () => {
    expect(deriveSummaryStatus([
      { status: "pending_details", bankFlowCount: 2, incomeBankFlowCount: 0 },
    ])).toBe("completed");
  });

  it("ignores expense-only tasks when income tasks are completed", () => {
    expect(deriveSummaryStatus([
      { status: "pending_details", bankFlowCount: 1, incomeBankFlowCount: 0 },
      { status: "completed", bankFlowCount: 2, incomeBankFlowCount: 2 },
    ])).toBe("completed");
  });

  it("preserves pending status for an unfinished income or empty detail task", () => {
    expect(deriveSummaryStatus([
      { status: "pending_details", bankFlowCount: 1, incomeBankFlowCount: 1 },
    ])).toBe("pending_recognition");
    expect(deriveSummaryStatus([
      { status: "pending_details", bankFlowCount: 0, incomeBankFlowCount: 0 },
    ])).toBe("pending_recognition");
  });
});
