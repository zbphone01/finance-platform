import { describe, expect, it } from "vitest";
import type { VoucherTemplateSettingsValue } from "@db/schema";
import {
  buildVoucherTemplateChoices,
  normalizeVoucherTemplates,
  resolveVoucherTemplateSets,
} from "./voucherTemplates";

const emptyRow = {
  摘要: "",
  科目编码: "",
  科目名称: "",
  借方金额: "",
  贷方金额: "",
};

describe("voucher templates", () => {
  it("wraps legacy row arrays as a named default template", () => {
    const normalized = normalizeVoucherTemplates({
      会费收入: [
        { ...emptyRow, 摘要: "收到会费" },
        emptyRow,
        emptyRow,
      ],
    });

    expect(normalized.会费收入).toHaveLength(1);
    expect(normalized.会费收入[0]).toMatchObject({
      id: "membership-default",
      name: "默认模板",
    });
    expect(normalized.会费收入[0].rows[0].摘要).toBe("收到会费");
  });

  it("keeps multiple named template sets and exactly three rows", () => {
    const normalized = normalizeVoucherTemplates({
      利息收入: [
        {
          id: "interest-a",
          name: "季度利息",
          rows: [{ ...emptyRow, 摘要: "季度利息" }],
        },
        {
          id: "interest-b",
          name: "年度利息",
          rows: [emptyRow, emptyRow, { ...emptyRow, 贷方金额: "100" }, emptyRow],
        },
      ],
    });

    expect(normalized.利息收入.map((item) => item.name)).toEqual(["季度利息", "年度利息"]);
    expect(normalized.利息收入[0].rows).toHaveLength(3);
    expect(normalized.利息收入[1].rows).toHaveLength(3);
  });

  it("requires an explicit selection only when a relevant type has multiple templates", () => {
    const templates = normalizeVoucherTemplates({
      会费收入: [
        { id: "membership-a", name: "模板A", rows: [emptyRow, emptyRow, emptyRow] },
        { id: "membership-b", name: "模板B", rows: [emptyRow, emptyRow, emptyRow] },
      ],
    }) as VoucherTemplateSettingsValue;

    expect(buildVoucherTemplateChoices(templates, ["会费收入"])[0].requiresSelection).toBe(true);
    expect(() => resolveVoucherTemplateSets(templates, ["会费收入"], []))
      .toThrow("请选择会费收入的模板名称");
    expect(resolveVoucherTemplateSets(templates, ["会费收入"], [{
      templateType: "会费收入",
      templateId: "membership-b",
    }]).get("会费收入")?.name).toBe("模板B");
  });

  it("rejects a stale template selection", () => {
    const templates = normalizeVoucherTemplates({});
    expect(() => resolveVoucherTemplateSets(templates, ["利息收入"], [{
      templateType: "利息收入",
      templateId: "deleted-template",
    }])).toThrow("所选模板不存在或已被删除");
  });

  it("resolves each relevant template type independently in one voucher", () => {
    const templates = normalizeVoucherTemplates({
      会费收入: [
        { id: "membership-a", name: "会费A", rows: [emptyRow, emptyRow, emptyRow] },
        { id: "membership-b", name: "会费B", rows: [emptyRow, emptyRow, emptyRow] },
      ],
      利息收入: [
        { id: "interest-a", name: "利息A", rows: [emptyRow, emptyRow, emptyRow] },
        { id: "interest-b", name: "利息B", rows: [emptyRow, emptyRow, emptyRow] },
      ],
    });

    const selected = resolveVoucherTemplateSets(
      templates,
      ["会费收入", "利息收入"],
      [
        { templateType: "会费收入", templateId: "membership-b" },
        { templateType: "利息收入", templateId: "interest-a" },
      ],
    );

    expect(selected.get("会费收入")?.name).toBe("会费B");
    expect(selected.get("利息收入")?.name).toBe("利息A");
  });
});
