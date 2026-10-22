import { describe, expect, it } from "vitest";
import { flowMatchesCounterpartyMatchers } from "./counterpartyMatchers";

const baseFlow = {
  bankName: "广发银行",
  counterpartyAccount: "62220001",
  counterpartyName: "测试付款方",
  summary: "公益项目捐赠款",
  purpose: "项目善款",
  postScript: "春季活动",
};

const withMatchAccount = (matcher: Record<string, unknown>) => ({ matchAccounts: [matcher] });

describe("flowMatchesCounterpartyMatchers", () => {
  it("摘要为空时不参与判断", () => {
    expect(
      flowMatchesCounterpartyMatchers(
        { ...baseFlow, summary: "" },
        withMatchAccount({
          accountNo: "62220001",
          accountName: "测试付款方",
          summary: "",
          purpose: "项目",
          postScript: "活动",
        })
      )
    ).toBe(true);
  });

  it("摘要填写后按关键词包含匹配", () => {
    expect(
      flowMatchesCounterpartyMatchers(baseFlow, withMatchAccount({
        accountNo: "62220001",
        summary: "项目捐赠",
      }))
    ).toBe(true);
    expect(
      flowMatchesCounterpartyMatchers(baseFlow, withMatchAccount({
        accountNo: "62220001",
        summary: "会费",
      }))
    ).toBe(false);
  });

  it("同组已填写字段全部命中才算匹配", () => {
    expect(
      flowMatchesCounterpartyMatchers(baseFlow, withMatchAccount({
        accountNo: "62220001",
        accountName: "测试付款方",
        summary: "捐赠款",
        purpose: "项目",
        postScript: "不存在的附言",
      }))
    ).toBe(false);
  });

  it("多组条件任意一组命中即可匹配", () => {
    expect(
      flowMatchesCounterpartyMatchers(baseFlow, {
        matchAccounts: [
          {
            accountNo: "62220002",
            summary: "会费",
          },
          {
            accountNo: "62220001",
            accountName: "测试付款方",
            summary: "公益项目",
            purpose: "善款",
            postScript: "春季",
          },
        ],
      })
    ).toBe(true);
  });

  it("选择到账银行后要求银行精确匹配", () => {
    const counterparty = withMatchAccount({
      bankName: "广发银行",
      accountNo: "",
      summary: "项目捐赠",
    });

    expect(flowMatchesCounterpartyMatchers(baseFlow, counterparty)).toBe(true);
    expect(flowMatchesCounterpartyMatchers(
      { ...baseFlow, bankName: "中国银行" },
      counterparty,
    )).toBe(false);
  });

  it("银行为空时不参与匹配", () => {
    const counterparty = withMatchAccount({
      bankName: "",
      accountNo: "",
      summary: "项目捐赠",
    });

    expect(flowMatchesCounterpartyMatchers(
      { ...baseFlow, bankName: "广发银行" },
      counterparty,
    )).toBe(true);
    expect(flowMatchesCounterpartyMatchers(
      { ...baseFlow, bankName: "中国银行" },
      counterparty,
    )).toBe(true);
  });

  it("可仅用银行和摘要匹配无对方信息的利息到账", () => {
    expect(flowMatchesCounterpartyMatchers({
      bankName: "中国银行",
      counterpartyAccount: null,
      counterpartyName: null,
      summary: "存款利息入账",
      purpose: null,
      postScript: null,
    }, withMatchAccount({
      bankName: "中国银行",
      accountNo: "",
      accountName: "",
      summary: "利息",
    }))).toBe(true);
  });

  it("没有子表匹配条件时不再回退主表字段", () => {
    expect(flowMatchesCounterpartyMatchers(baseFlow, {
      accountNo: "62220001",
      accountName: "测试付款方",
      matchAccounts: [],
    })).toBe(false);
  });
});
