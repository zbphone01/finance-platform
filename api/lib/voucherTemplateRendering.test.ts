import { describe, expect, it } from "vitest";
import {
  buildInterestSummaryPreview,
  formatVoucherQuarter,
  renderVoucherSummary,
  renderVoucherTemplateRow,
  renderVoucherTemplateText,
} from "./voucherTemplateRendering";

describe("voucher template rendering", () => {
  it("renders bank and quarter variables", () => {
    expect(renderVoucherTemplateText("【银行】-【季度】", {
      "【银行】": "中国银行",
      "【季度】": "第二季度",
    })).toBe("中国银行-第二季度");
  });

  it("removes the retired interest information variable from legacy templates", () => {
    expect(renderVoucherTemplateText("收到【利息信息】", {})).toBe("收到");
  });

  it.each([
    ["2026-01-01 00:00:00", "第一季度"],
    ["2026-04-30", "第二季度"],
    ["2026-09-01", "第三季度"],
    ["2026-12-31", "第四季度"],
    ["", "-"],
    ["2026-13-01", "-"],
  ])("maps %s to %s", (transactionTime, expected) => {
    expect(formatVoucherQuarter(transactionTime)).toBe(expected);
  });

  it("uses custom content only for the interest summary", () => {
    const variables = { "【银行】": "工商银行" };
    expect(renderVoucherSummary("收到【银行】利息", variables, "利息", "自定义摘要"))
      .toBe("自定义摘要");
    expect(renderVoucherSummary("收到【银行】利息", variables, "利息", ""))
      .toBe("收到工商银行利息");
    expect(renderVoucherSummary("收到【银行】捐赠", variables, "捐赠收入", "自定义摘要"))
      .toBe("收到工商银行捐赠");
  });

  it("builds the interest summary preview from rendered template rows", () => {
    expect(buildInterestSummaryPreview([
      { incomeType: "利息", summary: "收到中国银行第二季度利息" },
      { incomeType: "利息", summary: "收到中国银行第二季度利息" },
      { incomeType: "捐赠收入", summary: "收到捐赠收入" },
      { incomeType: "利息", summary: "利息收入结转" },
      { incomeType: "利息", summary: "  " },
    ])).toBe("收到中国银行第二季度利息；利息收入结转");
  });

  it("keeps every non-summary interest template field", () => {
    expect(renderVoucherTemplateRow({
      摘要: "收到【银行】利息",
      科目编码: "1002-【季度】",
      科目名称: "银行存款-【银行】",
      借方金额: "【入账金额】",
      贷方金额: "0.00",
    }, {
      "【银行】": "中国银行",
      "【季度】": "第二季度",
      "【入账金额】": "883.40",
    }, "利息", "自定义摘要")).toEqual({
      summary: "自定义摘要",
      subjectCode: "1002-第二季度",
      subjectName: "银行存款-中国银行",
      debitAmount: "883.40",
      creditAmount: "0.00",
    });
  });
});
