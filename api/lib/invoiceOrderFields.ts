type InvoiceOrderFieldRule = {
  orderNoField?: string | null;
  invoiceOtherOrderNo1Field?: string | null;
  invoiceOtherOrderNo2Field?: string | null;
};

export type InvoiceOrderFieldSnapshot = {
  version: 1;
  orderNo: string;
  otherOrderNo1: string;
  otherOrderNo2: string;
};

function cleanText(value: unknown) {
  return String(value ?? "").replace(/^\uFEFF/, "").trim();
}

export function buildInvoiceOrderFieldSnapshot(rule: InvoiceOrderFieldRule): InvoiceOrderFieldSnapshot {
  return {
    version: 1,
    orderNo: cleanText(rule.orderNoField),
    otherOrderNo1: cleanText(rule.invoiceOtherOrderNo1Field),
    otherOrderNo2: cleanText(rule.invoiceOtherOrderNo2Field),
  };
}

export function readConfiguredInvoiceOrderNoValue(
  row: Record<string, string>,
  fieldName?: string | null,
) {
  const field = cleanText(fieldName);
  if (!field || !Object.prototype.hasOwnProperty.call(row, field)) return null;
  return cleanText(row[field]) || null;
}
