import { describe, expect, it } from "vitest";
import {
  extractProjectCenterCode,
  isBankDirectDonation,
  normalizeProjectCenters,
  validateMemberProjectCenterRequirement,
} from "./projectCenter";

describe("projectCenter", () => {
  it("把捐赠收入和订单退款的银行直捐识别为目标场景", () => {
    expect(isBankDirectDonation({ incomeType: "捐赠收入", donationSource: "银行直捐" })).toBe(true);
    expect(isBankDirectDonation({ incomeType: "订单退款", donationSource: "银行直捐" })).toBe(true);
    expect(isBankDirectDonation({ incomeType: "捐赠收入", donationSource: "拍卖" })).toBe(false);
    expect(isBankDirectDonation({ incomeType: "会费收入", donationSource: "银行直捐" })).toBe(false);
  });

  it("填写会员姓名后要求所属项目中心", () => {
    expect(() => validateMemberProjectCenterRequirement({
      incomeType: "捐赠收入",
      donationSource: "银行直捐",
      memberName: "张三",
      projectCenter: "",
    }, "分账 1 ")).toThrow("分账 1 填写会员姓名时所属项目中心不能为空");

    expect(() => validateMemberProjectCenterRequirement({
      incomeType: "捐赠收入",
      donationSource: "银行直捐",
      memberName: "",
      projectCenter: "",
    }, "分账 1 ")).not.toThrow();
  });

  it("从展示值中提取项目中心编码", () => {
    expect(extractProjectCenterCode("0101_东海项目中心")).toBe("0101");
  });

  it("按当前部门名称规范化项目中心快照", async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: async () => [{ code: "0101", name: "东海项目中心" }],
        }),
      }),
    };
    await expect(normalizeProjectCenters(db, [{
      incomeType: "捐赠收入",
      donationSource: "银行直捐",
      memberName: "张三",
      projectCenter: "0101_历史名称",
    }])).resolves.toEqual(["0101_东海项目中心"]);
  });
});
