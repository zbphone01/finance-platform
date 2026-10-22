import { describe, expect, it } from "vitest";
import { resolveBankFlowCounterparty, type BankFlowCounterparty } from "./bankFlowCounterpartyMatching";

const flow = {
  bankName: "广发银行",
  counterpartyAccount: "62220001",
  counterpartyName: "测试付款方",
  summary: "公益项目捐赠款",
  purpose: "项目善款",
  postScript: "春季活动",
};

function counterparty(id: number, alias: string, matchAccounts: any[]): BankFlowCounterparty {
  return {
    id,
    alias,
    recognitionType: "明细认账",
    detailMatchingMode: "单笔匹配",
    arrivalRegion: null,
    detailPackageType: "T+1",
    voucherSummaryText: null,
    voucherIncomeName: null,
    createdAt: new Date(),
    matchAccounts,
  };
}

describe("resolveBankFlowCounterparty", () => {
  it("returns unmatched when no arrival information matches", () => {
    const result = resolveBankFlowCounterparty(flow, [
      counterparty(1, "其他到账", [{ accountNo: "999", isActive: 1 }]),
    ]);
    expect(result.kind).toBe("unmatched");
  });

  it("does not treat an empty matcher group as a catch-all", () => {
    const result = resolveBankFlowCounterparty(flow, [
      counterparty(1, "空条件到账", [{ accountNo: "", accountName: "", summary: "", isActive: 1 }]),
    ]);
    expect(result.kind).toBe("unmatched");
  });

  it("selects the uniquely most-specific arrival information", () => {
    const result = resolveBankFlowCounterparty(flow, [
      counterparty(1, "宽泛到账", [{ accountNo: "62220001", isActive: 1 }]),
      counterparty(2, "精确到账", [{ accountNo: "62220001", accountName: "测试付款方", summary: "公益项目", isActive: 1 }]),
    ]);
    expect(result.kind).toBe("matched");
    expect(result.counterparty?.id).toBe(2);
  });

  it("does not choose when highest-specificity matches are tied", () => {
    const result = resolveBankFlowCounterparty(flow, [
      counterparty(1, "到账A", [{ accountNo: "62220001", summary: "公益项目", isActive: 1 }]),
      counterparty(2, "到账B", [{ accountNo: "62220001", purpose: "善款", isActive: 1 }]),
    ]);
    expect(result.kind).toBe("ambiguous");
    expect(result.aliases).toEqual(["到账A", "到账B"]);
  });
});
