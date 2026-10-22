import { describe, expect, it } from "vitest";
import { filterIngestibleBankFlows } from "./bankFlowUpload";

describe("bank flow upload filtering", () => {
  it("keeps only positive China Bank flows", () => {
    const flows = [
      { bankName: "中国银行", income: "10.00", referenceNo: "positive" },
      { bankName: "中国银行", income: "0", referenceNo: "zero" },
      { bankName: "中国银行", income: "-1.00", referenceNo: "negative" },
      { bankName: "广发银行", income: "-1.00", referenceNo: "existing-bank-behavior" },
      { bankName: "广发银行", income: "0.00", referenceNo: "guangfa-zero" },
      { bankName: "广发银行", income: "invalid", referenceNo: "guangfa-invalid" },
    ];

    expect(filterIngestibleBankFlows(flows).map((flow) => flow.referenceNo)).toEqual([
      "positive",
      "existing-bank-behavior",
    ]);
  });
});
