function parseGuangfaAmount(value: unknown) {
  const cleaned = String(value ?? "").trim().replace(/,/g, "");
  if (!cleaned || cleaned === "-") return 0;
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : 0;
}

export function resolveGuangfaSignedAmount(incomeValue: unknown, expenseValue: unknown) {
  const income = parseGuangfaAmount(incomeValue);
  const expense = Math.abs(parseGuangfaAmount(expenseValue));
  return String(income - expense);
}
