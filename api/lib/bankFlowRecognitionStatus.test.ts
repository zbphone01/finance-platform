import { describe, expect, it } from "vitest";
import { deriveBankFlowDisplayStatus } from "./bankFlowRecognitionStatus";

describe("deriveBankFlowDisplayStatus", () => {
  it("uses the task processing state as the temporary display override", () => {
    expect(deriveBankFlowDisplayStatus({
      recognitionStatus: "recognized",
      taskStatus: "processing",
      hasRecognitionProgress: true,
    })).toBe("processing");
  });

  it("displays the persisted flow state without promoting it from result totals", () => {
    expect(deriveBankFlowDisplayStatus({
      recognitionStatus: "unrecognized",
      taskStatus: "completed",
      hasRecognitionProgress: true,
    })).toBe("unrecognized");
    expect(deriveBankFlowDisplayStatus({
      recognitionStatus: "partial_matched",
      taskStatus: "partial_matched",
      hasRecognitionProgress: true,
    })).toBe("partial_matched");
    expect(deriveBankFlowDisplayStatus({
      recognitionStatus: "recognized",
      taskStatus: "completed",
      hasRecognitionProgress: true,
    })).toBe("recognized");
  });

  it("keeps variance as a presentation variant of the persisted state", () => {
    expect(deriveBankFlowDisplayStatus({
      recognitionStatus: "large_variance",
      taskStatus: "large_variance",
      hasRecognitionProgress: false,
    })).toBe("variance_unrecognized");
    expect(deriveBankFlowDisplayStatus({
      recognitionStatus: "large_variance",
      taskStatus: "large_variance",
      hasRecognitionProgress: true,
    })).toBe("variance_partial_matched");
    expect(deriveBankFlowDisplayStatus({
      recognitionStatus: "partial_matched",
      taskStatus: "large_variance",
      hasRecognitionProgress: true,
    })).toBe("variance_partial_matched");
  });
});
