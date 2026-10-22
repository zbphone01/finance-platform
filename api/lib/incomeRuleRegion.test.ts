import { describe, expect, it } from "vitest";
import { resolveIncomeRuleRecognitionRegion } from "./incomeRuleRegion";

describe("income rule recognition region", () => {
  it("uses the matched arrival region for a bank direct donation", () => {
    expect(resolveIncomeRuleRecognitionRegion({
      splitMode: "direct",
      bankDirectDonation: true,
      arrivalRegion: "外省市",
      configuredRegion: "北京市",
    })).toBe("外省市");
  });

  it("keeps the configured region for other direct income", () => {
    expect(resolveIncomeRuleRecognitionRegion({
      splitMode: "direct",
      bankDirectDonation: false,
      arrivalRegion: "外省市",
      configuredRegion: "北京市",
    })).toBe("北京市");
  });

  it("keeps using the channel region for platform income", () => {
    expect(resolveIncomeRuleRecognitionRegion({
      splitMode: "platform",
      bankDirectDonation: false,
      arrivalRegion: "境外",
      channelRegion: "港澳台",
      configuredRegion: "北京市",
    })).toBe("港澳台");
  });
});
