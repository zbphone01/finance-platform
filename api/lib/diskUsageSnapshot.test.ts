import { describe, expect, it, vi } from "vitest";
import { calculateDiskUsage, readDiskUsage } from "./diskUsageSnapshot";

describe("diskUsageSnapshot", () => {
  it("按总容量和可用容量计算已占用及使用率", () => {
    expect(calculateDiskUsage({
      bsize: 1024n,
      blocks: 100n,
      bavail: 40n,
    })).toEqual({
      totalBytes: 102400,
      usedBytes: 61440,
      availableBytes: 40960,
      usagePercent: 60,
    });
  });

  it("使用指定路径读取文件系统统计", async () => {
    const reader = vi.fn(async () => ({
      bsize: 4096n,
      blocks: 200n,
      bavail: 50n,
    }));

    await expect(readDiskUsage("/data", reader)).resolves.toEqual({
      totalBytes: 819200,
      usedBytes: 614400,
      availableBytes: 204800,
      usagePercent: 75,
    });
    expect(reader).toHaveBeenCalledWith("/data", { bigint: true });
  });

  it("拒绝异常的可用容量", () => {
    expect(() => calculateDiskUsage({
      bsize: 1024n,
      blocks: 10n,
      bavail: 11n,
    })).toThrow("data disk available capacity is invalid");
  });
});
