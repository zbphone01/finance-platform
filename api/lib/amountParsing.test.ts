import { describe, expect, it } from "vitest";
import { parseExactCents } from "./amountParsing";

describe("parseExactCents", () => {
  it("parses supported currency and omitted-integer cent values exactly", () => {
    expect(parseExactCents("￥1,234.50")).toBe(123450);
    expect(parseExactCents("-.50")).toBe(-50);
    expect(parseExactCents(".01")).toBe(1);
  });

  it("rejects values below cent precision instead of rounding", () => {
    expect(parseExactCents("1.001")).toBeNaN();
    expect(parseExactCents("1.999")).toBeNaN();
    expect(parseExactCents("金额1.00")).toBeNaN();
  });
});
