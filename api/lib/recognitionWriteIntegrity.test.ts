import { describe, expect, it } from "vitest";
import {
  DETAIL_SPLIT_RECOGNITION_WRITE_INDEX,
  RECOGNITION_DETAILS_CHANGED_MESSAGE,
  summarizeRecognitionWriteCoverage,
} from "./recognitionWriteIntegrity";

describe("recognition result write integrity", () => {
  it("keeps detail-split writes on the dedicated recognition index", () => {
    expect(DETAIL_SPLIT_RECOGNITION_WRITE_INDEX).toBe(
      "bd_rule_detail_split_status_idx",
    );
  });

  it("accepts a complete bulk assignment", () => {
    expect(summarizeRecognitionWriteCoverage([
      { detailCount: 37 },
      { detailCount: 55 },
      { detailCount: 2 },
    ], 94)).toEqual({
      expectedDetailCount: 94,
      updatedDetailCount: 94,
      isComplete: true,
    });
  });

  it("detects deleted details before residual results can survive", () => {
    expect(summarizeRecognitionWriteCoverage([
      { detailCount: 37 },
      { detailCount: 55 },
      { detailCount: 2 },
    ], 0)).toEqual({
      expectedDetailCount: 94,
      updatedDetailCount: 0,
      isComplete: false,
    });
    expect(RECOGNITION_DETAILS_CHANGED_MESSAGE).toContain("本次入账结果已回滚");
  });
});
