import { describe, expect, it } from "vitest";
import {
  getDeleteTargetTaskDate,
  getOrderFileDeleteDbHeavyJobKey,
} from "./orderFileDeletion";

describe("order file package deletion date scope", () => {
  it("does not query recognition tasks for an unmatched multi-day package", () => {
    expect(getDeleteTargetTaskDate("-", true)).toBeNull();
  });

  it.each([
    ["dated multi-day package", "2026-05-19"],
    ["T+1 package", "2026-05-20"],
  ])("keeps the recognition task date for a %s", (_kind, packageDate) => {
    expect(getDeleteTargetTaskDate(packageDate, false)).toBe(packageDate);
  });

  it("rejects invalid non-placeholder dates before they reach MySQL", () => {
    expect(() => getDeleteTargetTaskDate("-", false)).toThrow("订单日期/匹配日期格式异常");
  });

  it("keeps whole-package and single-file deletion jobs separate", () => {
    const packageInput = {
      billDate: "2026-06-10",
      ruleId: 27,
      detailPackageType: "T+1" as const,
    };
    expect(getOrderFileDeleteDbHeavyJobKey(packageInput)).toBe(
      "order-file-delete:2026-06-10:T+1:27:all",
    );
    expect(getOrderFileDeleteDbHeavyJobKey({ ...packageInput, orderFileId: 88 })).toBe(
      "order-file-delete:2026-06-10:T+1:27:file-88",
    );
  });
});
