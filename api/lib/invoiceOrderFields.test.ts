import { describe, expect, it } from "vitest";
import {
  buildInvoiceOrderFieldSnapshot,
  readConfiguredInvoiceOrderNoValue,
} from "./invoiceOrderFields";

describe("invoice order fields", () => {
  it("固化上传时使用的三个订单号字段名，空配置保持为空", () => {
    expect(buildInvoiceOrderFieldSnapshot({
      orderNoField: " 订单号 ",
      invoiceOtherOrderNo1Field: " 商户订单号 ",
      invoiceOtherOrderNo2Field: null,
    })).toEqual({
      version: 1,
      orderNo: "订单号",
      otherOrderNo1: "商户订单号",
      otherOrderNo2: "",
    });
  });

  it("按配置的原始列名精确读取单号值，不使用同义字段", () => {
    const row = {
      商户订单号: " MERCHANT-1 ",
      业务流水号: "BUSINESS-1",
    };

    expect(readConfiguredInvoiceOrderNoValue(row, "商户订单号")).toBe("MERCHANT-1");
    expect(readConfiguredInvoiceOrderNoValue(row, "订单号")).toBeNull();
    expect(readConfiguredInvoiceOrderNoValue(row, "业务流水号")).toBe("BUSINESS-1");
  });

  it("空字段名或空单元格保存为空值", () => {
    expect(readConfiguredInvoiceOrderNoValue({ 商户订单号: "   " }, "商户订单号")).toBeNull();
    expect(readConfiguredInvoiceOrderNoValue({ 商户订单号: "M-1" }, null)).toBeNull();
  });
});
