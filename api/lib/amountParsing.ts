function cleanAmountText(value: unknown) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^[`'"]+/, "")
    .replace(/[`'"]+$/, "")
    .replace(/,/g, "")
    .replace(/[￥¥$]/g, "")
    .trim();
}

export function parseLooseDecimal(value: unknown) {
  const cleaned = cleanAmountText(value);
  if (!cleaned) return NaN;
  const numeric = cleaned.match(/^-?(?:\d+(?:\.\d+)?|\.\d+)/);
  return numeric ? Number(numeric[0]) : NaN;
}

export function parseExactCents(value: unknown) {
  const cleaned = cleanAmountText(value);
  const matched = cleaned.match(/^(-?)(?:(\d+)(?:\.(\d{1,2}))?|\.(\d{1,2}))$/);
  if (!matched) return NaN;
  const whole = Number(matched[2] || "0");
  const fractionText = matched[3] ?? matched[4] ?? "";
  const fraction = Number(fractionText.padEnd(2, "0"));
  const cents = whole * 100 + fraction;
  if (!Number.isSafeInteger(cents)) return NaN;
  return matched[1] === "-" ? -cents : cents;
}

export function cleanDecimalString(value: unknown, fallback = "0.00") {
  const parsed = parseLooseDecimal(value);
  return Number.isFinite(parsed) ? String(parsed) : fallback;
}
