import { describe, expect, it } from "vitest";
import {
  buildRecognitionResultAttributeUpdate,
  validateRecognitionResultAttributes,
  type RecognitionResultAttributesInput,
} from "./recognitionResultAttributes";

function attributes(patch: Partial<RecognitionResultAttributesInput> = {}): RecognitionResultAttributesInput {
  return {
    incomeType: "捐赠收入",
    donationSource: "银行直捐",
    incomeAttr: "限定性收入",
    incomeDept: "01_项目部",
    budgetCode: "1.1-测试预算",
    incomeProject: "PM001_测试项目",
    feedbackType: "反馈",
    memberName: "",
    projectCenter: "",
    membershipPaymentYears: null,
    region: "北京市",
    isAnonymous: false,
    managementFeeType: "比例",
    managementFeeValue: "5",
    expenseFundSource: "限定性_反馈_[到账户名]_测试活动",
    voucherReceiptChannelCode: null,
    ...patch,
  };
}

describe("recognition result attribute editing", () => {
  it("rebuilds editable attributes without changing immutable amounts", () => {
    const update = buildRecognitionResultAttributeUpdate({
      attributes: attributes({
        memberName: "张三",
        projectCenter: "0101_项目中心",
        isAnonymous: true,
      }),
      splitAmount: "100.00",
      normalizedProjectCenter: "0101_项目中心",
      bankCounterpartyName: "测试捐赠人",
    });

    expect(update).toMatchObject({
      recognitionType: "银行直捐",
      incomeType: "捐赠收入",
      memberName: "张三",
      projectCenter: "0101_项目中心",
      isAnonymous: 1,
      managementFeeAmount: "5.00",
      expenseFundSource: "限定性_反馈_测试捐赠人_测试活动",
    });
    expect(update).not.toHaveProperty("splitAmount");
    expect(update).not.toHaveProperty("entryTime");
    expect(update).not.toHaveProperty("bankFlowId");
  });

  it("keeps refund management fees negative while preserving refund attributes", () => {
    const update = buildRecognitionResultAttributeUpdate({
      attributes: attributes({
        incomeType: "订单退款",
        donationSource: null,
        platformProjectName: "PP001_平台项目",
        platformProjectDetail: "PD001_项目详情",
        feedbackType: null,
        managementFeeType: "金额",
        managementFeeValue: "3.20",
      }),
      splitAmount: "-100.00",
    });

    expect(update).toMatchObject({
      incomeType: "订单退款",
      donationSource: null,
      platformProjectName: "PP001_平台项目",
      region: "北京市",
      managementFeeAmount: "-3.20",
    });
  });

  it("keeps manually recognized refund donation attributes editable", () => {
    const update = buildRecognitionResultAttributeUpdate({
      attributes: attributes({
        incomeType: "订单退款",
        donationSource: "银行直捐",
      }),
      splitAmount: "-100.00",
      bankCounterpartyName: "退款方",
    });

    expect(update).toMatchObject({
      recognitionType: "银行直捐",
      incomeType: "订单退款",
      donationSource: "银行直捐",
      feedbackType: "反馈",
      region: "北京市",
      managementFeeAmount: "-5.00",
      expenseFundSource: "限定性_反馈_退款方_测试活动",
    });
  });

  it("clears fields that do not apply to remark-only income types", () => {
    const update = buildRecognitionResultAttributeUpdate({
      attributes: attributes({
        incomeType: "其他收入",
        donationSource: null,
        incomeDept: null,
        budgetCode: null,
        incomeProject: null,
        feedbackType: null,
        region: null,
        managementFeeValue: null,
        expenseFundSource: null,
        remark: "修正说明",
      }),
      splitAmount: "50.00",
    });

    expect(update).toMatchObject({
      incomeType: "其他收入",
      incomeDept: null,
      managementFeeAmount: "0.00",
      expenseFundSource: null,
      remark: "修正说明",
    });
  });

  it("rejects incomplete editable attributes", () => {
    expect(() => validateRecognitionResultAttributes(attributes({ budgetCode: "" })))
      .toThrow("预算编码不能为空");
    expect(() => validateRecognitionResultAttributes(attributes({
      incomeType: "会费收入",
      donationSource: null,
      memberName: "",
      membershipPaymentYears: "",
    }))).toThrow("会员姓名不能为空");
    expect(() => validateRecognitionResultAttributes(attributes({
      managementFeeValue: "not-a-number",
    }))).toThrow("管理费必须为大于等于0的数字");
  });
});
