import { describe, expect, it } from "vitest";
import { extractGuangfaBankAccountNo, normalizeBankAccountNo } from "./bankAccountParser";

describe("bank account parser", () => {
  it("extracts the Guangfa account number before the transaction header", () => {
    expect(extractGuangfaBankAccountNo([
      ["账户交易明细表"],
      ["户名：", null, "北京市企业家环保基金会"],
      ["账号：", null, "137041518010041333", null, "币种：", "人民币"],
    ])).toBe("137041518010041333");
  });

  it("supports an inline account label and removes whitespace", () => {
    expect(extractGuangfaBankAccountNo([["账号： 1370 4151 8010 0413 33"]]))
      .toBe("137041518010041333");
  });

  it("keeps account identifiers as strings", () => {
    expect(normalizeBankAccountNo("0012 3400")).toBe("00123400");
  });
});
