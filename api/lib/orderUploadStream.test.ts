import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { cleanDecimalString, parseLooseDecimal } from "./amountParsing";
import { createDetailRuleItemMatcher } from "./detailRuleMatcher";
import {
  createRefundOrderClassifier,
  isExcludedOrder,
  isRefundOrder,
  shouldDirectlyMarkOrderUnmatched,
} from "./orderRuleClassification";
import {
  buildOrderRawData,
  getConfiguredInvoiceOrderNoFields,
  parseCsvRows,
  parseUtf8CsvStream,
  parseXlsxRows,
} from "./orderUploadStream";
import { calculateManagementFeeAmount, splitAmountByRatios } from "./splitAmounts";

describe("order row classification", () => {
  it("drops a row when any exclude condition matches by equals or contains", () => {
    const row = { 订单状态: "交易成功", 备注: "用户申请退款后已关闭" };
    const readField = (field: string) => row[field as keyof typeof row];

    expect(isExcludedOrder([
      { field: "订单状态", matchType: "等于", keyword: "已关闭" },
      { field: "备注", matchType: "包含", keyword: "申请退款" },
    ], readField)).toBe(true);

    expect(isExcludedOrder([
      { field: "订单状态", matchType: "等于", keyword: "关闭" },
    ], readField)).toBe(false);
  });

  it("classifies a direct refund by one configured judge value", () => {
    const readRefundField = (field: string) => ({
      业务类型: "交易退款",
      退款金额: "-20.00",
    })[field as "业务类型" | "退款金额"];
    const readIncomeField = (field: string) => ({
      业务类型: "交易收款",
      退款金额: "20.00",
    })[field as "业务类型" | "退款金额"];

    expect(isRefundOrder({
      enabled: true,
      judgeField: "业务类型",
      judgeValue: "交易退款",
      amountField: "退款金额",
    }, readRefundField)).toBe(true);
    expect(isRefundOrder({
      enabled: true,
      judgeField: "业务类型",
      judgeValue: "交易退款",
      amountField: "退款金额",
    }, readIncomeField)).toBe(false);
  });

  it("uses one shared field and one direction value to distinguish transfer income and expense", () => {
    const classifyRefundOrder = createRefundOrderClassifier({
      enabled: true,
      judgeField: "业务类型",
      judgeValue: "交易退款",
      directionJudgeValue: "转账",
      incomeField: "收入金额",
      amountField: "支出金额",
    });

    expect(classifyRefundOrder((field) => ({
      业务类型: "转账",
      收入金额: "10.00",
      支出金额: "0.00",
    })[field as "业务类型" | "收入金额" | "支出金额"])).toEqual({ kind: "normal" });
    expect(classifyRefundOrder((field) => ({
      业务类型: "转账",
      收入金额: "0.00",
      支出金额: "-5.00",
    })[field as "业务类型" | "收入金额" | "支出金额"])).toEqual({ kind: "refund" });
    expect(classifyRefundOrder((field) => ({
      业务类型: "转账",
      收入金额: "0.00",
      支出金额: "0.00",
    })[field as "业务类型" | "收入金额" | "支出金额"])).toEqual({ kind: "unmatched" });
  });

  it("rejects ambiguous directions and direct refunds without a nonzero refund amount", () => {
    const classifyRefundOrder = createRefundOrderClassifier({
      enabled: true,
      judgeField: "业务类型",
      judgeValue: "交易退款",
      directionJudgeValue: "转账",
      incomeField: "收入金额",
      amountField: "支出金额",
    });

    const ambiguous = classifyRefundOrder((field) => ({
      业务类型: "转账",
      收入金额: "10.00",
      支出金额: "-5.00",
    })[field as "业务类型" | "收入金额" | "支出金额"]);
    const zeroRefund = classifyRefundOrder((field) => ({
      业务类型: "交易退款",
      收入金额: "0.00",
      支出金额: "0.00",
    })[field as "业务类型" | "收入金额" | "支出金额"]);

    expect(ambiguous.kind).toBe("invalid");
    expect(ambiguous.reason).toContain("不能同时非0");
    expect(zeroRefund.kind).toBe("invalid");
    expect(zeroRefund.reason).toContain("必须为非0数字");
  });

  it("directly marks non-refund rows with empty or zero income as unmatched", () => {
    expect(shouldDirectlyMarkOrderUnmatched(false, "")).toBe(true);
    expect(shouldDirectlyMarkOrderUnmatched(false, "0.00")).toBe(true);
    expect(shouldDirectlyMarkOrderUnmatched(false, "￥0.00")).toBe(true);
    expect(shouldDirectlyMarkOrderUnmatched(false, "10.00")).toBe(false);
    expect(shouldDirectlyMarkOrderUnmatched(true, "0.00")).toBe(false);
  });

  it("keeps an unclassified Alipay expense row out of the multi-split path", () => {
    const row = {
      业务类型: "其它",
      收入金额: "0.00",
      支出金额: "-5.00",
      商品名称: "顺手公益 SEE濒危物种保护行动 保护生物多样性 爱心捐赠环境保护 等多件",
    };
    const readField = (field: string) => row[field as keyof typeof row];
    const isRefund = isRefundOrder({
      enabled: true,
      judgeField: "业务类型",
      judgeValue: "交易退款",
      incomeField: "收入金额",
      amountField: "支出金额",
    }, readField);
    const matcher = createDetailRuleItemMatcher<typeof row>([
      {
        id: 6734,
        keywordField: "商品名称",
        detailKeyword: "顺手公益 SEE濒危物种保护行动 保护生物多样性 爱心捐赠环境保护",
        keywordMatchType: "等于",
      },
    ], (detail, field) => detail[field as keyof typeof detail], {
      enabled: true,
      keywordField: "商品名称",
      keyword: "等多件",
    });

    const rowMatch = shouldDirectlyMarkOrderUnmatched(isRefund, row.收入金额)
      ? null
      : matcher(row);

    expect(isRefund).toBe(false);
    expect(rowMatch?.status || "unmatched").toBe("unmatched");
  });
});

describe("getConfiguredInvoiceOrderNoFields", () => {
  it("does not add raw_data fields when the ticket configuration is empty", () => {
    expect(getConfiguredInvoiceOrderNoFields({})).toEqual([]);
  });

  it("returns trimmed configured fields and removes duplicates", () => {
    expect(getConfiguredInvoiceOrderNoFields({
      invoiceOtherOrderNo1Field: " 商户订单号 ",
      invoiceOtherOrderNo2Field: "业务流水号",
    })).toEqual(["商户订单号", "业务流水号"]);

    expect(getConfiguredInvoiceOrderNoFields({
      invoiceOtherOrderNo1Field: "商户订单号",
      invoiceOtherOrderNo2Field: "商户订单号",
    })).toEqual(["商户订单号"]);
  });

  it("writes configured ticket values into raw_data and omits empty values", () => {
    const fields = getConfiguredInvoiceOrderNoFields({
      invoiceOtherOrderNo1Field: "商户订单号",
      invoiceOtherOrderNo2Field: "业务流水号",
    });

    expect(buildOrderRawData({
      业务流水号: "BUS-1",
      商户订单号: "MERCHANT-1",
      未配置字段: "不应保存",
    }, fields)).toEqual({
      商户订单号: "MERCHANT-1",
      业务流水号: "BUS-1",
    });
  });
});

describe("amount parsing", () => {
  it("keeps decimal values that omit the leading zero", () => {
    expect(cleanDecimalString(".99")).toBe("0.99");
    expect(cleanDecimalString("￥.02")).toBe("0.02");
    expect(parseLooseDecimal("-.50")).toBe(-0.5);
  });

  it("splits refund amounts and calculates negative management fees", () => {
    expect(splitAmountByRatios("-100.00", ["60", "40"])).toEqual(["-60.00", "-40.00"]);
    expect(calculateManagementFeeAmount("-60.00", "5")).toBe("-3.00");
  });

  it("truncates management fees above one cent and rounds fees below one cent", () => {
    expect(calculateManagementFeeAmount("0.16", "10")).toBe("0.01");
    expect(calculateManagementFeeAmount("0.10", "5")).toBe("0.01");
    expect(calculateManagementFeeAmount("0.08", "5")).toBe("0.00");
    expect(calculateManagementFeeAmount("-0.16", "10")).toBe("-0.01");
  });
});

describe("createDetailRuleItemMatcher", () => {
  it("matches exact rules before contains rules regardless of input order", () => {
    const matcher = createDetailRuleItemMatcher([
      { id: 1, keywordField: "备注", detailKeyword: "公益宝贝捐赠", keywordMatchType: "包含" },
      { id: 2, keywordField: "备注", detailKeyword: "公益宝贝捐赠=项目A", keywordMatchType: "等于" },
    ], (row: Record<string, string>, field) => row[field]);

    expect(matcher({ 备注: "公益宝贝捐赠=项目A" })?.item?.id).toBe(2);
  });

  it("falls back to contains rules when no exact rule matches", () => {
    const matcher = createDetailRuleItemMatcher([
      { id: 1, keywordField: "备注", detailKeyword: "公益宝贝捐赠", keywordMatchType: "包含" },
      { id: 2, keywordField: "备注", detailKeyword: "公益宝贝捐赠=项目A", keywordMatchType: "等于" },
    ], (row: Record<string, string>, field) => row[field]);

    expect(matcher({ 备注: "公益宝贝捐赠=项目B" })?.item?.id).toBe(1);
  });

  it("marks combined exact multi-split rows after exact rules and before contains rules", () => {
    const matcher = createDetailRuleItemMatcher([
      { id: 1, keywordField: "备注", detailKeyword: "公益宝贝捐赠", keywordMatchType: "包含" },
      { id: 2, keywordField: "备注", detailKeyword: "公益宝贝捐赠=项目A", keywordMatchType: "等于" },
    ], (row: Record<string, string>, field) => row[field], {
      enabled: true,
      keywordField: "备注",
      keyword: "等多件",
    });

    const result = matcher({ 备注: "公益宝贝捐赠=项目A  等多件" });
    expect(result?.status).toBe("pending_split");
    expect(result?.item).toBeNull();
  });

  it("only marks multi-split rows when the split keyword combines with a rule keyword", () => {
    const readFields: string[] = [];
    const matcher = createDetailRuleItemMatcher([
      { id: 1, keywordField: "详情", detailKeyword: "公益宝贝捐赠", keywordMatchType: "包含" },
      { id: 2, keywordField: "备注", detailKeyword: "项目A", keywordMatchType: "等于" },
    ], (row: Record<string, string>, field) => {
      readFields.push(field);
      return row[field];
    }, {
      enabled: true,
      keywordField: "备注",
      keyword: "等多件",
    });

    const result = matcher({ 备注: "项目A  等多件", 详情: "公益宝贝捐赠" });
    expect(result?.status).toBe("pending_split");
    expect(readFields).toEqual(["备注", "备注"]);
  });

  it("does not mark arbitrary suffix rows as multi-split", () => {
    const matcher = createDetailRuleItemMatcher([
      { id: 1, keywordField: "详情", detailKeyword: "公益宝贝捐赠", keywordMatchType: "包含" },
      { id: 2, keywordField: "备注", detailKeyword: "项目A", keywordMatchType: "等于" },
    ], (row: Record<string, string>, field) => row[field], {
      enabled: true,
      keywordField: "备注",
      keyword: "等多件",
    });

    const result = matcher({ 备注: "任意内容等多件", 详情: "公益宝贝捐赠" });
    expect(result?.status).toBe("matched");
    expect(result?.item?.id).toBe(1);
  });

  it("does not mark multi-split rows when detail split is disabled", () => {
    const matcher = createDetailRuleItemMatcher([
      { id: 1, keywordField: "备注", detailKeyword: "公益宝贝捐赠", keywordMatchType: "包含" },
    ], (row: Record<string, string>, field) => row[field], {
      enabled: false,
      keywordField: "备注",
      keyword: "等多件",
    });

    const result = matcher({ 备注: "公益宝贝捐赠等多件" });
    expect(result?.status).toBe("matched");
    expect(result?.item?.id).toBe(1);
  });

  it("matches every row to the package split item when condition recognition is disabled", () => {
    const readFields: string[] = [];
    const matcher = createDetailRuleItemMatcher([
      { id: 1, keywordField: "__整包认账__", detailKeyword: "__整包认账__", keywordMatchType: "等于" },
    ], (row: Record<string, string>, field) => {
      readFields.push(field);
      return row[field];
    }, {
      conditionRecognitionEnabled: false,
    });

    const result = matcher({ 备注: "不需要匹配关键字" });
    expect(result?.status).toBe("matched");
    expect(result?.item?.id).toBe(1);
    expect(readFields).toEqual([]);
  });
});

describe("parseUtf8CsvStream", () => {
  it("preserves UTF-8 product names split across stream chunks", async () => {
    const csv = "商品名称,订单号\n留住长江的微笑,1\n蔚海行动,2\n";
    const bytes = Buffer.from(csv, "utf8");
    const splitAt = bytes.indexOf(Buffer.from("住", "utf8")) + 1;
    const stream = Readable.toWeb(Readable.from([
      bytes.subarray(0, splitAt),
      bytes.subarray(splitAt),
    ])) as ReadableStream<Uint8Array>;

    const rows = [];
    for await (const row of parseUtf8CsvStream(stream) as AsyncIterable<Record<string, string>>) {
      rows.push(row);
    }

    expect(rows).toEqual([
      { 商品名称: "留住长江的微笑", 订单号: "1" },
      { 商品名称: "蔚海行动", 订单号: "2" },
    ]);
  });
});

describe("parseCsvRows", () => {
  it("skips provider preamble rows and reads the real CSV header", async () => {
    const csv = [
      "#支付宝账务明细查询,,,,",
      "#账号：[20886114106397930156],,,,",
      "#-----------------------------------------账务明细列表----------------------------------------,,,,",
      "账务流水号,商户订单号,商品名称,发生时间,收入金额（+元）,备注",
      "\"1570792780580579071\t\",\"T200P3298686925406031890\t\",\"水培植物\t\",\"2026-05-08 00:00:00\t\",\"0.02\t\",\"公益宝贝捐赠=带豹回家=百花村定一花木\t\"",
    ].join("\n");
    const stream = Readable.toWeb(Readable.from([Buffer.from(csv, "utf8")])) as ReadableStream<Uint8Array>;

    const rows = [];
    for await (const row of parseCsvRows(stream)) {
      rows.push(row);
    }

    expect(rows).toEqual([
      {
        lineNumber: 5,
        row: {
          账务流水号: "1570792780580579071",
          商户订单号: "T200P3298686925406031890",
          商品名称: "水培植物",
          发生时间: "2026-05-08 00:00:00",
          "收入金额（+元）": "0.02",
          备注: "公益宝贝捐赠=带豹回家=百花村定一花木",
        },
      },
    ]);
  });

  it("decodes GB18030 CSV exports", async () => {
    const bytes = Buffer.from(
      "23d6a7b8b6b1a6d5cbcef1c3f7cfb8b2e9d1af2c2c2c2c0ad5cbcef1c1f7cbaebac52cc9ccbba7b6a9b5a5bac52cc9ccc6b7c3fbb3c62cb7a2c9facab1bce42ccad5c8ebbdf0b6eea3a82bd4aaa3a92cb1b8d7a20a312c5432303050312cb2e2cad4c9ccc6b72c323032362d30352d30382030303a30303a30302c302e30322cb9abd2e6b1a6b1b4bee8d4f93db4f8b1aabbd8bcd23db0d9bba8b4e5",
      "hex",
    );
    const stream = Readable.toWeb(Readable.from([bytes])) as ReadableStream<Uint8Array>;

    const rows = [];
    for await (const row of parseCsvRows(stream)) {
      rows.push(row);
    }

    expect(rows[0]).toMatchObject({
      lineNumber: 3,
      row: {
        商户订单号: "T200P1",
        商品名称: "测试商品",
        发生时间: "2026-05-08 00:00:00",
        "收入金额（+元）": "0.02",
        备注: "公益宝贝捐赠=带豹回家=百花村",
      },
    });
  });
});

describe("parseXlsxRows", () => {
  it("reads the first worksheet as header keyed rows", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("订单");
    sheet.addRow(["下单时间", "商户订单号", "订单金额", "商品信息"]);
    sheet.addRow(["2026-05-10 21:57:32", "YBGY-1", "20.00", "易宝公益-大自然合伙人计划"]);
    sheet.addRow(["2026-05-10 20:41:06", "YBGY-2", "1.00", "易宝公益-黑山秀水守护行动"]);
    workbook.addWorksheet("汇总").addRow(["不应读取"]);

    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const stream = Readable.toWeb(Readable.from([bytes])) as ReadableStream<Uint8Array>;
    const rows = [];
    for await (const row of parseXlsxRows(stream)) {
      rows.push(row);
    }

    expect(rows).toEqual([
      {
        lineNumber: 2,
        row: {
          下单时间: "2026-05-10 21:57:32",
          商户订单号: "YBGY-1",
          订单金额: "20.00",
          商品信息: "易宝公益-大自然合伙人计划",
        },
      },
      {
        lineNumber: 3,
        row: {
          下单时间: "2026-05-10 20:41:06",
          商户订单号: "YBGY-2",
          订单金额: "1.00",
          商品信息: "易宝公益-黑山秀水守护行动",
        },
      },
    ]);
  });

  it("skips preamble rows before the worksheet header", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("订单");
    sheet.addRow(["#支付宝账务明细查询"]);
    sheet.addRow(["#账号：[20886114106397930156]"]);
    sheet.addRow(["账务流水号", "商户订单号", "商品名称", "发生时间", "收入金额（+元）", "备注"]);
    sheet.addRow(["1", "T200P1", "测试商品", "2026-05-08 00:00:00", "0.02", "公益宝贝捐赠=带豹回家=百花村"]);

    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const stream = Readable.toWeb(Readable.from([bytes])) as ReadableStream<Uint8Array>;
    const rows = [];
    for await (const row of parseXlsxRows(stream)) {
      rows.push(row);
    }

    expect(rows).toEqual([
      {
        lineNumber: 4,
        row: {
          账务流水号: "1",
          商户订单号: "T200P1",
          商品名称: "测试商品",
          发生时间: "2026-05-08 00:00:00",
          "收入金额（+元）": "0.02",
          备注: "公益宝贝捐赠=带豹回家=百花村",
        },
      },
    ]);
  });
});
