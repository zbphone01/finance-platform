import type {
  VoucherTemplateRow,
  VoucherTemplateSet,
  VoucherTemplateSettingsValue,
  VoucherTemplateType,
} from "@db/schema";

export const LEGACY_VOUCHER_TEMPLATE_SETTING_KEY = "default";
export const VOUCHER_TEMPLATE_SETTING_KEY = "template_sets_v2";

export const voucherTemplateTypes: VoucherTemplateType[] = [
  "捐赠收入-到账认账模版",
  "捐赠收入-明细认账模版",
  "会费收入",
  "利息收入",
];

const templateColumns: Array<keyof VoucherTemplateRow> = [
  "摘要",
  "科目编码",
  "科目名称",
  "借方金额",
  "贷方金额",
];

const emptyTemplateRow = (): VoucherTemplateRow => ({
  摘要: "",
  科目编码: "",
  科目名称: "",
  借方金额: "",
  贷方金额: "",
});

const defaultTemplateIds: Record<VoucherTemplateType, string> = {
  "捐赠收入-到账认账模版": "donation-arrival-default",
  "捐赠收入-明细认账模版": "donation-detail-default",
  会费收入: "membership-default",
  利息收入: "interest-default",
};

const defaultTemplateRows: Record<VoucherTemplateType, VoucherTemplateRow[]> = {
  "捐赠收入-到账认账模版": [
    {
      摘要: "收到【凭证收款渠道名称】捐赠收入【订单明细总计】笔",
      科目编码: "",
      科目名称: "",
      借方金额: "",
      贷方金额: "",
    },
    emptyTemplateRow(),
    emptyTemplateRow(),
  ],
  "捐赠收入-明细认账模版": [
    emptyTemplateRow(),
    emptyTemplateRow(),
    emptyTemplateRow(),
  ],
  会费收入: [
    emptyTemplateRow(),
    emptyTemplateRow(),
    emptyTemplateRow(),
  ],
  利息收入: [
    emptyTemplateRow(),
    emptyTemplateRow(),
    emptyTemplateRow(),
  ],
};

function normalizeTemplateRow(value: unknown): VoucherTemplateRow {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(templateColumns.map((column) => [
    column,
    String(source[column] || "").replaceAll("【利息信息】", ""),
  ])) as VoucherTemplateRow;
}

function normalizeTemplateRows(value: unknown, fallback: VoucherTemplateRow[]) {
  const sourceRows = Array.isArray(value) ? value : fallback;
  return Array.from({ length: 3 }, (_, index) =>
    normalizeTemplateRow(sourceRows[index] || fallback[index] || emptyTemplateRow()),
  );
}

function isTemplateSet(value: unknown): value is Partial<VoucherTemplateSet> {
  return Boolean(value && typeof value === "object" && Array.isArray((value as Partial<VoucherTemplateSet>).rows));
}

function normalizeTemplateSets(
  templateType: VoucherTemplateType,
  value: unknown,
): VoucherTemplateSet[] {
  const sourceItems = Array.isArray(value) ? value : [];
  const fallbackRows = defaultTemplateRows[templateType];
  if (sourceItems.length === 0) {
    return [{
      id: defaultTemplateIds[templateType],
      name: "默认模板",
      rows: normalizeTemplateRows(fallbackRows, fallbackRows),
    }];
  }

  if (!isTemplateSet(sourceItems[0])) {
    return [{
      id: defaultTemplateIds[templateType],
      name: "默认模板",
      rows: normalizeTemplateRows(sourceItems, fallbackRows),
    }];
  }

  return sourceItems.map((item, index) => {
    const source = item && typeof item === "object" ? item as Partial<VoucherTemplateSet> : {};
    return {
      id: String(source.id || `${defaultTemplateIds[templateType]}-${index + 1}`).trim(),
      name: String(source.name || `模板 ${index + 1}`).trim(),
      rows: normalizeTemplateRows(source.rows, fallbackRows),
    };
  });
}

export function normalizeVoucherTemplates(value: unknown): VoucherTemplateSettingsValue {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    "捐赠收入-到账认账模版": normalizeTemplateSets(
      "捐赠收入-到账认账模版",
      source["捐赠收入-到账认账模版"] || source["到账认账模板"],
    ),
    "捐赠收入-明细认账模版": normalizeTemplateSets(
      "捐赠收入-明细认账模版",
      source["捐赠收入-明细认账模版"] || source["明细认账模板"],
    ),
    会费收入: normalizeTemplateSets("会费收入", source.会费收入),
    利息收入: normalizeTemplateSets("利息收入", source.利息收入),
  };
}

export type VoucherTemplateSelection = {
  templateType: VoucherTemplateType;
  templateId: string;
};

export function buildVoucherTemplateChoices(
  templates: VoucherTemplateSettingsValue,
  relevantTypes: VoucherTemplateType[],
) {
  return relevantTypes.map((templateType) => ({
    templateType,
    requiresSelection: templates[templateType].length > 1,
    options: templates[templateType].map((template) => ({
      id: template.id,
      name: template.name,
    })),
  }));
}

export function resolveVoucherTemplateSets(
  templates: VoucherTemplateSettingsValue,
  relevantTypes: VoucherTemplateType[],
  selections: VoucherTemplateSelection[],
): Map<VoucherTemplateType, VoucherTemplateSet> {
  const relevantTypeSet = new Set(relevantTypes);
  const selectionByType = new Map<VoucherTemplateType, string>();
  for (const selection of selections) {
    if (!relevantTypeSet.has(selection.templateType)) {
      throw new Error(`${selection.templateType}不属于当前到账的凭证模板`);
    }
    if (selectionByType.has(selection.templateType)) {
      throw new Error(`${selection.templateType}重复选择模板`);
    }
    selectionByType.set(selection.templateType, selection.templateId);
  }

  return new Map(relevantTypes.map((templateType) => {
    const options = templates[templateType];
    const selectedId = selectionByType.get(templateType);
    if (options.length > 1 && !selectedId) {
      throw new Error(`请选择${templateType}的模板名称`);
    }
    const selected = selectedId
      ? options.find((template) => template.id === selectedId)
      : options[0];
    if (!selected) {
      throw new Error(`${templateType}所选模板不存在或已被删除，请重新选择`);
    }
    return [templateType, selected];
  }));
}
