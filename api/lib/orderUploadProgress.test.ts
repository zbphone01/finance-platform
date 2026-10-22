import { describe, expect, it } from "vitest";
import { getOrderImportPhaseProgress, getOrderUploadOverallProgress } from "./orderUploadProgress";

describe("order upload progress", () => {
  it("calculates import progress independently from parsing", () => {
    expect(getOrderImportPhaseProgress(0)).toBe(0);
    expect(getOrderImportPhaseProgress(750_000)).toBe(50);
    expect(getOrderImportPhaseProgress(1_500_000)).toBe(99);
  });

  it("keeps the compatible overall progress weighted by both phases", () => {
    expect(getOrderUploadOverallProgress(50, 0)).toBe(15);
    expect(getOrderUploadOverallProgress(100, 50)).toBe(65);
    expect(getOrderUploadOverallProgress(100, 100)).toBe(100);
  });

  it("clamps unexpected progress input", () => {
    expect(getOrderUploadOverallProgress(-10, 200)).toBe(70);
  });
});
