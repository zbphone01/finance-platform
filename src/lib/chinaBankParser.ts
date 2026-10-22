function cleanCell(value: unknown) {
  return String(value ?? "").replace(/^\uFEFF/, "").trim();
}

export function normalizeChinaBankHeader(value: unknown) {
  return cleanCell(value)
    .replace(/\s+/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/［[^］]*］/g, "");
}

export function hasChinaBankHeaders(headers: unknown[] | null | undefined) {
  const normalized = new Set((headers || []).map(normalizeChinaBankHeader));
  return [
    "交易流水号",
    "交易日期",
    "交易时间",
    "交易金额",
    "付款人账号",
    "付款人名称",
    "付款人开户行名",
  ].every((header) => normalized.has(header));
}

function getRowValue(row: Record<string, unknown>, header: string) {
  const entry = Object.entries(row)
    .find(([key]) => normalizeChinaBankHeader(key) === header);
  return entry?.[1] ?? "";
}

function getChinaBankSummary(row: Record<string, unknown>) {
  return cleanCell(getRowValue(row, "备注"))
    || cleanCell(getRowValue(row, "业务类型"));
}

function normalizeDate(value: unknown) {
  const text = cleanCell(value);
  const compactMatch = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  const separatedMatch = text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?/);
  const parts = compactMatch || separatedMatch;
  if (!parts) return text;
  return `${parts[1]}-${parts[2].padStart(2, "0")}-${parts[3].padStart(2, "0")}`;
}

function normalizeTime(value: unknown) {
  const text = cleanCell(value);
  const separatedMatch = text.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (separatedMatch) {
    return `${separatedMatch[1].padStart(2, "0")}:${separatedMatch[2].padStart(2, "0")}:${(separatedMatch[3] || "0").padStart(2, "0")}`;
  }
  const compactMatch = text.match(/^(\d{2})(\d{2})(\d{2})$/);
  return compactMatch ? `${compactMatch[1]}:${compactMatch[2]}:${compactMatch[3]}` : text;
}

function normalizeAmount(value: unknown) {
  const cleaned = cleanCell(value).replace(/,/g, "");
  if (!cleaned || cleaned === "-") return "0";
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? String(amount) : "0";
}

export function buildChinaBankTransactionTime(dateValue: unknown, timeValue: unknown) {
  const date = normalizeDate(dateValue);
  const time = normalizeTime(timeValue);
  return [date, time].filter(Boolean).join(" ");
}

export function mapChinaBankRows(rows: Array<Record<string, unknown>>) {
  return rows
    .map((row) => ({
      bankName: "中国银行" as const,
      referenceNo: cleanCell(getRowValue(row, "交易流水号")),
      transactionTime: buildChinaBankTransactionTime(
        getRowValue(row, "交易日期"),
        getRowValue(row, "交易时间"),
      ),
      income: normalizeAmount(getRowValue(row, "交易金额")),
      counterpartyAccount: cleanCell(getRowValue(row, "付款人账号")),
      counterpartyName: cleanCell(getRowValue(row, "付款人名称")),
      counterpartyBank: cleanCell(getRowValue(row, "付款人开户行名")),
      branch: "",
      summary: getChinaBankSummary(row),
      purpose: cleanCell(getRowValue(row, "用途")),
      postScript: cleanCell(getRowValue(row, "交易附言")),
    }))
    .filter((row) => (
      Boolean(row.referenceNo)
      && /^\d{4}-\d{2}-\d{2}(?:\s|$)/.test(row.transactionTime)
      && Number(row.income) > 0
    ));
}
