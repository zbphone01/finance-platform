import { describe, expect, it } from "vitest";
import {
  combineInvoiceOnlyOrderDateTime,
  normalizeInvoiceOnlyOrderDate,
  normalizeInvoiceOnlyOrderDateTime,
  normalizeInvoiceOnlyOrderTime,
} from "./invoiceOnlyOrderUpload";

describe("不认账明细日期时间字段", () => {
  it("日期支持常见分隔符和紧凑格式", () => {
    expect(normalizeInvoiceOnlyOrderDate("2026/08/14")).toBe("2026-08-14");
    expect(normalizeInvoiceOnlyOrderDate("20260814")).toBe("2026-08-14");
    expect(normalizeInvoiceOnlyOrderDate("2026年8月14日")).toBe("2026-08-14");
    expect(normalizeInvoiceOnlyOrderDate("2026-02-30")).toBe("");
  });

  it("时间支持时分秒和无秒格式", () => {
    expect(normalizeInvoiceOnlyOrderTime("9:05")).toBe("09:05:00");
    expect(normalizeInvoiceOnlyOrderTime("09:05:07.000")).toBe("09:05:07");
    expect(normalizeInvoiceOnlyOrderTime("090507")).toBe("09:05:07");
    expect(normalizeInvoiceOnlyOrderTime("24:00")).toBe("");
  });

  it("日期与时间均有效时才合并为订单时间", () => {
    expect(combineInvoiceOnlyOrderDateTime("2026-08-14", "9:05:07"))
      .toBe("2026-08-14 09:05:07");
    expect(combineInvoiceOnlyOrderDateTime("2026-08-14", "")).toBe("");
  });

  it("日期字段为空时支持从时间字段读取完整日期时间", () => {
    expect(normalizeInvoiceOnlyOrderDateTime("2026-08-19 9:05:07"))
      .toBe("2026-08-19 09:05:07");
    expect(normalizeInvoiceOnlyOrderDateTime("2026/8/19 9:05"))
      .toBe("2026-08-19 09:05:00");
    expect(normalizeInvoiceOnlyOrderDateTime("2026年8月19日 9时05分07秒"))
      .toBe("2026-08-19 09:05:07");
    expect(normalizeInvoiceOnlyOrderDateTime("20260819090507"))
      .toBe("2026-08-19 09:05:07");
    expect(normalizeInvoiceOnlyOrderDateTime("202608190905"))
      .toBe("2026-08-19 09:05:00");
  });

  it("完整日期时间会拒绝无时间或非法日期时间", () => {
    expect(normalizeInvoiceOnlyOrderDateTime("2026-08-19")).toBe("");
    expect(normalizeInvoiceOnlyOrderDateTime("2026-02-30 09:05:07")).toBe("");
    expect(normalizeInvoiceOnlyOrderDateTime("2026-08-19 24:00:00")).toBe("");
  });

  it("支持 Excel 解析得到的日期时间值", () => {
    expect(normalizeInvoiceOnlyOrderDateTime(new Date(2026, 7, 19, 9, 5, 7)))
      .toBe("2026-08-19 09:05:07");
  });
});
