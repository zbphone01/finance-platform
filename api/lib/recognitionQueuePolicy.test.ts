import { describe, expect, it } from "vitest";
import {
  getRecognitionQueueKey,
  mergeRecognitionOptions,
} from "./recognitionQueuePolicy";

describe("recognitionQueuePolicy", () => {
  it("keeps standard and detail-split recognition in separate queue entries", () => {
    expect(getRecognitionQueueKey(695)).toBe("695:standard");
    expect(getRecognitionQueueKey(695, { detailSplitFileId: 10 }))
      .toBe("695:detail-split:10");
    expect(getRecognitionQueueKey(695, { detailSplitFileId: 11 }))
      .toBe("695:detail-split:11");
  });

  it("merges flags only when the recognition scope is identical", () => {
    expect(mergeRecognitionOptions(
      { detailSplitFileId: 10, refreshUnmatchedMatches: true },
      { detailSplitFileId: 10, useSummaryDeltas: true },
    )).toEqual({
      detailSplitFileId: 10,
      refreshUnmatchedMatches: true,
      useSummaryDeltas: true,
    });

    expect(() => mergeRecognitionOptions(
      undefined,
      { detailSplitFileId: 10 },
    )).toThrow("不同认账范围不能合并到同一个队列任务");
  });
});
