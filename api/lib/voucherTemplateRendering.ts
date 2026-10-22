export function renderVoucherTemplateText(template: string, variables: Record<string, string>) {
  return String(template || "")
    .replaceAll("【利息信息】", "")
    .replace(/【([^】]+)】/g, (match, name) => variables[`【${name}】`] ?? match);
}

export function formatVoucherQuarter(value?: string | null) {
  const match = /^\d{4}-(\d{1,2})/.exec(String(value || "").trim());
  if (!match) return "-";
  const month = Number(match[1]);
  if (!Number.isInteger(month) || month < 1 || month > 12) return "-";
  return ["第一季度", "第二季度", "第三季度", "第四季度"][Math.floor((month - 1) / 3)];
}

export function renderVoucherSummary(
  template: string,
  variables: Record<string, string>,
  incomeType?: string | null,
  interestSummaryContent = "",
) {
  const customSummary = interestSummaryContent.trim();
  if (incomeType === "利息" && customSummary) return customSummary;
  return renderVoucherTemplateText(template, variables);
}

export function buildInterestSummaryPreview(
  rows: Array<{ incomeType?: string | null; summary?: string | null }>,
) {
  return Array.from(new Set(
    rows
      .filter((row) => row.incomeType === "利息")
      .map((row) => String(row.summary || "").trim())
      .filter(Boolean),
  )).join("；");
}

export type VoucherTemplateFields = {
  摘要: string;
  科目编码: string;
  科目名称: string;
  借方金额: string;
  贷方金额: string;
};

export function renderVoucherTemplateRow(
  templateRow: VoucherTemplateFields,
  variables: Record<string, string>,
  incomeType?: string | null,
  interestSummaryContent = "",
) {
  return {
    summary: renderVoucherSummary(templateRow.摘要, variables, incomeType, interestSummaryContent),
    subjectCode: renderVoucherTemplateText(templateRow.科目编码, variables),
    subjectName: renderVoucherTemplateText(templateRow.科目名称, variables),
    debitAmount: renderVoucherTemplateText(templateRow.借方金额, variables),
    creditAmount: renderVoucherTemplateText(templateRow.贷方金额, variables),
  };
}
