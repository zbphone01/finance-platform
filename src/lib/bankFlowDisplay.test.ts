import { describe, expect, it } from "vitest";
import { getBankFlowDisplayColumns } from "./bankFlowDisplay";

function fields(bankName: "广发银行" | "工商银行" | "中国银行", direction: "income" | "expense" = "income") {
  return getBankFlowDisplayColumns(bankName, direction).map((column) => column.field);
}

function labels(bankName: "广发银行" | "工商银行" | "中国银行", direction: "income" | "expense" = "income") {
  return getBankFlowDisplayColumns(bankName, direction).map((column) => column.label);
}

describe("bank flow display columns", () => {
  it("uses Guangfa labels and switches the signed amount heading", () => {
    expect(labels("广发银行")).toEqual([
      "ID", "流水号", "交易时间", "收入", "对方账号", "对方户名", "摘要", "备注", "附言",
    ]);
    expect(labels("广发银行", "expense")[3]).toBe("支出");
  });

  it("uses ICBC labels and column order", () => {
    expect(labels("工商银行")).toEqual([
      "ID", "流水号", "交易时间", "转入金额", "对方单位", "对方账号", "用途", "摘要", "附言",
    ]);
  });

  it("uses Bank of China labels and column order", () => {
    expect(labels("中国银行")).toEqual([
      "ID", "付款人账号", "付款人名称", "交易时间", "交易金额", "交易流水号", "摘要", "用途", "交易附言",
    ]);
  });

  it("maps bank-specific headings to the shared bank_flows fields", () => {
    expect(fields("工商银行")).toEqual([
      "id", "referenceNo", "transactionTime", "amount", "counterpartyName",
      "counterpartyAccount", "purpose", "summary", "postScript",
    ]);
    expect(fields("中国银行")).toEqual([
      "id", "counterpartyAccount", "counterpartyName", "transactionTime", "amount",
      "referenceNo", "summary", "purpose", "postScript",
    ]);
  });
});
