import { describe, expect, it } from "vitest";
import { buildVoucherOverviewLineExplanation } from "./voucherOverviewExplanation";

describe("voucher overview explanation", () => {
  it("uses the bank account alias", () => {
    expect(buildVoucherOverviewLineExplanation("广发银行工资账户")).toEqual({
      结算方式: "203_网上银行",
      银行账户: "广发银行工资账户",
    });
  });

  it("trims the bank account alias", () => {
    expect(buildVoucherOverviewLineExplanation("  工商银行捐赠账户  ")).toEqual({
      结算方式: "203_网上银行",
      银行账户: "工商银行捐赠账户",
    });
  });

  it.each([undefined, null, "", "   "])("uses a placeholder when the account alias is %s", (accountAlias) => {
    expect(buildVoucherOverviewLineExplanation(accountAlias)).toEqual({
      结算方式: "203_网上银行",
      银行账户: "-",
    });
  });
});
