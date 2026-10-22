export const manualVoucherIncomeTypes = [
  "政府补助",
  "个税返还",
  "本金",
  "投资收益",
  "其他收入",
  "其他",
] as const;

export type ManualVoucherIncomeType = (typeof manualVoucherIncomeTypes)[number];

export const legacyManualVoucherIncomeTypes = [...manualVoucherIncomeTypes, "利息"] as const;

export type LegacyManualVoucherIncomeType = (typeof legacyManualVoucherIncomeTypes)[number];

export const generatedVoucherIncomeTypes = ["捐赠收入", "会费收入", "利息", "订单退款"] as const;

export type VoucherCreationMatchResult = {
  id: number;
  ruleItemId?: number | null;
  orderDetailCountSnapshot?: number | null;
  incomeType?: string | null;
  splitAmount?: string | number | null;
  voucherStatus?: string | null;
};

const manualVoucherIncomeTypeSet = new Set<string>(manualVoucherIncomeTypes);
const legacyManualVoucherIncomeTypeSet = new Set<string>(legacyManualVoucherIncomeTypes);
const generatedVoucherIncomeTypeSet = new Set<string>(generatedVoucherIncomeTypes);

export function isManualVoucherIncomeType(value?: string | null): value is ManualVoucherIncomeType {
  return manualVoucherIncomeTypeSet.has(String(value || ""));
}

export function isLegacyManualVoucherIncomeType(value?: string | null): value is LegacyManualVoucherIncomeType {
  return legacyManualVoucherIncomeTypeSet.has(String(value || ""));
}

export function isGeneratedVoucherIncomeType(value?: string | null) {
  return generatedVoucherIncomeTypeSet.has(String(value || ""));
}

export function isTemplateVoucherRecognitionResult(
  row: Pick<VoucherCreationMatchResult, "incomeType" | "ruleItemId" | "orderDetailCountSnapshot">,
) {
  const incomeType = String(row.incomeType || "");
  if (["捐赠收入", "会费收入", "利息"].includes(incomeType)) return true;
  if (incomeType !== "订单退款") return false;
  return !Number(row.ruleItemId || 0) && Number(row.orderDetailCountSnapshot || 0) === 0;
}

export function groupPendingManualVoucherRequirements(rows: VoucherCreationMatchResult[]) {
  const groups = new Map<ManualVoucherIncomeType, { incomeType: ManualVoucherIncomeType; amount: number; matchResultIds: number[] }>();
  for (const row of rows) {
    if (row.voucherStatus === "created" || !isManualVoucherIncomeType(row.incomeType)) continue;
    const current = groups.get(row.incomeType) || {
      incomeType: row.incomeType,
      amount: 0,
      matchResultIds: [],
    };
    current.amount += Number(row.splitAmount || 0);
    if (Number(row.id)) current.matchResultIds.push(Number(row.id));
    groups.set(row.incomeType, current);
  }
  return manualVoucherIncomeTypes
    .map((incomeType) => groups.get(incomeType))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .map((item) => ({ ...item, amount: Number(item.amount.toFixed(2)) }));
}

export function getPendingGeneratedVoucherMatchResultIds(rows: VoucherCreationMatchResult[]) {
  return rows
    .filter((row) => row.voucherStatus !== "created" && isGeneratedVoucherIncomeType(row.incomeType))
    .map((row) => Number(row.id))
    .filter(Boolean);
}

export function needsInterestSummaryContent(rows: VoucherCreationMatchResult[]) {
  return rows.some((row) => row.voucherStatus !== "created" && row.incomeType === "利息");
}

export function isVoucherCreationComplete(rows: VoucherCreationMatchResult[]) {
  return rows.length > 0 && rows.every((row) => row.voucherStatus === "created");
}

export type VoucherCreationSummary = {
  resultCount?: string | number | null;
  pendingVoucherCount?: string | number | null;
};

export function isVoucherScopeFullyCreated(
  summaries: Array<VoucherCreationSummary | null | undefined>,
) {
  let resultCount = 0;
  let pendingVoucherCount = 0;
  for (const summary of summaries) {
    resultCount += Number(summary?.resultCount || 0);
    pendingVoucherCount += Number(summary?.pendingVoucherCount || 0);
  }
  return resultCount > 0 && pendingVoucherCount === 0;
}

export function getManualVoucherCancellationMatchResultIds(
  rows: VoucherCreationMatchResult[],
  incomeType: LegacyManualVoucherIncomeType,
) {
  return rows
    .filter((row) => row.voucherStatus === "created" && row.incomeType === incomeType)
    .map((row) => Number(row.id))
    .filter(Boolean);
}
