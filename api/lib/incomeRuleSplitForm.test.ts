import { describe, expect, it } from "vitest";
import {
  normalizeIncomeRuleSplitForm,
  resolveIncomeRuleSplitForm,
  validateIncomeRuleRecognitionAmounts,
} from "./incomeRuleSplitForm";

describe("income rule split form", () => {
  it("keeps historical rows in percentage mode", () => {
    expect(normalizeIncomeRuleSplitForm(undefined)).toBe("百分比");
    expect(resolveIncomeRuleSplitForm([{ splitForm: null }, { splitForm: "百分比" }])).toBe("百分比");
  });

  it("requires every row to use the same split form", () => {
    expect(() => resolveIncomeRuleSplitForm([
      { splitForm: "百分比" },
      { splitForm: "认账时填写" },
    ])).toThrow("各分账的分账形式必须一致");
  });
});

describe("income rule amount recognition", () => {
  it("allows blank rows and returns only non-zero rows", () => {
    expect(validateIncomeRuleRecognitionAmounts("100.00", [
      { recognitionAmount: "35.50" },
      { recognitionAmount: "" },
      { recognitionAmount: "64.50" },
    ])).toEqual({
      totalAmount: "100.00",
      amounts: ["35.50", "0.00", "64.50"],
      nonZeroIndexes: [0, 2],
    });
  });

  it("accepts negative recognition rows for a negative bank flow", () => {
    expect(validateIncomeRuleRecognitionAmounts("-100.00", [
      { recognitionAmount: "-35.50" },
      { recognitionAmount: "" },
      { recognitionAmount: "-64.50" },
    ])).toEqual({
      totalAmount: "-100.00",
      amounts: ["-35.50", "0.00", "-64.50"],
      nonZeroIndexes: [0, 2],
    });
  });

  it("rejects recognition rows in the opposite direction", () => {
    expect(() => validateIncomeRuleRecognitionAmounts("-100.00", [
      { recognitionAmount: "100.00" },
    ])).toThrow("分账认账金额必须与银行流水金额方向一致");
  });

  it("rejects a total different from the latest available amount", () => {
    expect(() => validateIncomeRuleRecognitionAmounts("100.00", [
      { recognitionAmount: "35.50" },
      { recognitionAmount: "60.00" },
    ])).toThrow("认账金额合计必须等于可认账金额 100.00，当前为 95.50");
  });

  it("rejects amounts with more than two decimal places", () => {
    expect(() => validateIncomeRuleRecognitionAmounts("1.00", [
      { recognitionAmount: "1.001" },
    ])).toThrow("分账 1 认账金额格式不正确");
  });
});
