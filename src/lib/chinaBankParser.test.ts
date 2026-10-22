import { describe, expect, it } from "vitest";
import {
  buildChinaBankTransactionTime,
  hasChinaBankHeaders,
  mapChinaBankRows,
  normalizeChinaBankHeader,
} from "./chinaBankParser";

const headers = [
  "交易流水号[ Transaction reference number ]",
  "交易日期[ Transaction Date ]",
  "交易时间[ Transaction time ]",
  "交易金额[ Trade Amount ]",
  "付款人账号[ Debit Account No. ]",
  "付款人名称[ Payer's Name ]",
  "付款人开户行名[ Payer account bank ]",
  "摘要[ Reference ]",
  "用途[ Purpose ]",
  "交易附言[ Remark ]",
  "备注[ Remarks ]",
  "业务类型[ Business type ]",
];

describe("China Bank flow parser", () => {
  it("recognizes bilingual headers regardless of bracket spacing", () => {
    expect(hasChinaBankHeaders(headers)).toBe(true);
    expect(normalizeChinaBankHeader("交易金额［ Trade Amount ］")).toBe("交易金额");
  });

  it("joins compact transaction dates and times", () => {
    expect(buildChinaBankTransactionTime("20260620", "22:53:23"))
      .toBe("2026-06-20 22:53:23");
  });

  it("maps only positive rows using the configured source columns", () => {
    const positive = {
      [headers[0]]: "625005331099",
      [headers[1]]: "20260620",
      [headers[2]]: "22:53:23",
      [headers[3]]: "883.40",
      [headers[4]]: "001234567890",
      [headers[5]]: "付款人名称",
      [headers[6]]: "付款人开户行",
      [headers[7]]: "不应写入系统摘要",
      [headers[8]]: "指定用途",
      [headers[9]]: "指定交易附言",
      [headers[10]]: "指定备注",
      [headers[11]]: "备用业务类型",
    };
    const negative = { ...positive, [headers[0]]: "negative", [headers[3]]: "-10.00" };

    expect(mapChinaBankRows([negative, positive])).toEqual([{
      bankName: "中国银行",
      referenceNo: "625005331099",
      transactionTime: "2026-06-20 22:53:23",
      income: "883.4",
      counterpartyAccount: "001234567890",
      counterpartyName: "付款人名称",
      counterpartyBank: "付款人开户行",
      branch: "",
      summary: "指定备注",
      purpose: "指定用途",
      postScript: "指定交易附言",
    }]);
  });

  it("uses business type as the summary when remarks are empty", () => {
    const row: Record<string, unknown> = Object.fromEntries(headers.map((header) => [header, ""]));
    row[headers[0]] = "625005331100";
    row[headers[1]] = "20260620";
    row[headers[2]] = "22:53:24";
    row[headers[3]] = "10.00";
    row[headers[10]] = "   ";
    row[headers[11]] = "来账/结息";

    expect(mapChinaBankRows([row])[0]?.summary).toBe("来账/结息");
  });

  it("keeps a positive interest row when payer fields are empty", () => {
    const row: Record<string, unknown> = Object.fromEntries(headers.map((header) => [header, ""]));
    row[headers[0]] = "625005331099";
    row[headers[1]] = "20260620";
    row[headers[2]] = "22:53:23";
    row[headers[3]] = 883.4;

    expect(mapChinaBankRows([row])).toHaveLength(1);
  });
});
