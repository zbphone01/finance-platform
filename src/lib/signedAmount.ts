export function sanitizeSignedDecimalInput(value: unknown, allowNegative = true) {
  const text = String(value ?? "");
  const negative = allowNegative && text.trimStart().startsWith("-");
  const unsigned = text.replace(/[^\d.]/g, "");
  const dotIndex = unsigned.indexOf(".");
  const normalized = dotIndex < 0
    ? unsigned
    : `${unsigned.slice(0, dotIndex + 1)}${unsigned.slice(dotIndex + 1).replace(/\./g, "")}`;
  return `${negative ? "-" : ""}${normalized}`;
}

export function toSignedAmountCents(value: unknown) {
  const amount = Number(String(value ?? "").trim());
  return Number.isFinite(amount) ? Math.round(amount * 100) : NaN;
}

export function isSignedAmountWithinAvailable(value: unknown, availableValue: unknown) {
  const amountCents = toSignedAmountCents(value);
  const availableCents = toSignedAmountCents(availableValue);
  if (!Number.isFinite(amountCents) || !Number.isFinite(availableCents)) return false;
  if (availableCents > 0) return amountCents > 0 && amountCents <= availableCents;
  if (availableCents < 0) return amountCents < 0 && amountCents >= availableCents;
  return false;
}
