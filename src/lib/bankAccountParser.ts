function cleanCell(value: unknown) {
  return String(value ?? "").replace(/^\uFEFF/, "").trim();
}

export function normalizeBankAccountNo(value: unknown) {
  return cleanCell(value).replace(/\s+/g, "");
}

export function extractGuangfaBankAccountNo(rows: unknown[][]) {
  for (const row of rows) {
    for (let index = 0; index < row.length; index += 1) {
      const cell = cleanCell(row[index]);
      const inlineMatch = cell.match(/^账号\s*[：:]\s*(.+)$/);
      if (inlineMatch) return normalizeBankAccountNo(inlineMatch[1]);

      if (cell.replace(/[\s：:]/g, "") !== "账号") continue;
      for (let valueIndex = index + 1; valueIndex < row.length; valueIndex += 1) {
        const accountNo = normalizeBankAccountNo(row[valueIndex]);
        if (accountNo) return accountNo;
      }
    }
  }
  return "";
}
