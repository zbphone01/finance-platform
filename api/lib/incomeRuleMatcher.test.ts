import { describe, expect, it } from "vitest";
import { flowMatchesIncomeRule, getIncomeRuleConditionCount } from "./incomeRuleMatcher";

describe("incomeRuleMatcher", () => {
  it("已记录到账信息只配置对方账号时可以匹配", () => {
    const rule = {
      matchedCounterpartyAlias: "测试到账",
      accountName: "旧户名快照",
    };
    const counterparty = {
      matchAccounts: [
        {
          accountNo: "62220001",
          accountName: "",
          summary: "",
          purpose: "",
          postScript: "",
        },
      ],
    };

    expect(flowMatchesIncomeRule({
      counterpartyAccount: "62220001",
      counterpartyName: "新户名",
    }, rule, counterparty)).toBe(true);
    expect(getIncomeRuleConditionCount(rule, counterparty)).toBe(1);
  });

  it("未配置摘要的多组到账信息使用实时匹配条件", () => {
    const rule = {
      matchedCounterpartyAlias: "多账号到账",
      accountName: "旧户名快照",
      purpose: "旧用途",
    };
    const counterparty = {
      matchAccounts: [
        {
          accountNo: "62220001",
          accountName: "",
          summary: "",
          purpose: "",
          postScript: "",
        },
        {
          accountNo: "62220002",
          accountName: "第二付款方",
          summary: "",
          purpose: "项目款",
          postScript: "",
        },
      ],
    };

    expect(flowMatchesIncomeRule({
      counterpartyAccount: "62220002",
      counterpartyName: "第二付款方",
      purpose: "2026年项目款",
    }, rule, counterparty)).toBe(true);
  });

  it("历史未关联到账信息的规则继续使用原字段匹配", () => {
    const rule = {
      matchedCounterpartyAlias: null,
      accountName: "历史付款方",
      purpose: "捐赠",
      postScript: null,
    };

    expect(flowMatchesIncomeRule({
      counterpartyName: "历史付款方",
      purpose: "公益捐赠款",
      postScript: "",
    }, rule, null)).toBe(true);
    expect(flowMatchesIncomeRule({
      counterpartyName: "其他付款方",
      purpose: "公益捐赠款",
      postScript: "",
    }, rule, null)).toBe(false);
  });

  it("到账银行作为有效条件参与规则匹配和优先级计算", () => {
    const rule = {
      matchedCounterpartyAlias: "中行利息",
    };
    const counterparty = {
      matchAccounts: [{
        bankName: "中国银行",
        accountNo: "",
        accountName: "",
        summary: "利息",
        purpose: "",
        postScript: "",
      }],
    };

    expect(flowMatchesIncomeRule({
      bankName: "中国银行",
      counterpartyAccount: null,
      counterpartyName: null,
      summary: "存款利息入账",
    }, rule, counterparty)).toBe(true);
    expect(flowMatchesIncomeRule({
      bankName: "广发银行",
      counterpartyAccount: null,
      counterpartyName: null,
      summary: "存款利息入账",
    }, rule, counterparty)).toBe(false);
    expect(getIncomeRuleConditionCount(rule, counterparty)).toBe(2);
  });
});
