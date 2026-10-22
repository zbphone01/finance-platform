import { toCents } from "./splitAmounts";

export type OrderRecognitionSummaryGroup = {
  ruleItemId: number;
  isRefund: boolean;
  detailCount: number;
  totalCents: number;
};

export type OrderRecognitionSummaryAccumulator = Map<string, OrderRecognitionSummaryGroup>;

export type OrderRecognitionFileSnapshot = {
  entryCount: number | string | null | undefined;
  orderTotalAmount: number | string | null | undefined;
  refundAmount: number | string | null | undefined;
  matchedCount: number | string | null | undefined;
  unmatchedCount: number | string | null | undefined;
  pendingSplitCount: number | string | null | undefined;
};

export type OrderRecognitionPhaseSummary = {
  totalCents: number;
  count: number;
};

export function orderRecognitionSummaryKey(ruleItemId: number, isRefund: boolean) {
  return `${ruleItemId}|${isRefund ? 1 : 0}`;
}

export function addOrderRecognitionSummaryDetail(
  accumulator: OrderRecognitionSummaryAccumulator,
  detail: {
    matchStatus: string | null | undefined;
    ruleItemId: number | null | undefined;
    totalAmount: string | number | null | undefined;
    refundAmountSnapshot: string | number | null | undefined;
  },
) {
  const ruleItemId = Number(detail.ruleItemId || 0);
  if (detail.matchStatus !== "matched" || !ruleItemId) return;

  const isRefund = toCents(detail.refundAmountSnapshot || 0) > 0;
  const key = orderRecognitionSummaryKey(ruleItemId, isRefund);
  const current = accumulator.get(key) || {
    ruleItemId,
    isRefund,
    detailCount: 0,
    totalCents: 0,
  };
  current.detailCount += 1;
  current.totalCents += toCents(detail.totalAmount || 0);
  accumulator.set(key, current);
}

export function serializeOrderRecognitionSummary(
  orderFileId: number,
  accumulator: OrderRecognitionSummaryAccumulator,
) {
  return Array.from(accumulator.values())
    .sort((left, right) => left.ruleItemId - right.ruleItemId || Number(left.isRefund) - Number(right.isRefund))
    .map((group) => ({
      orderFileId,
      ruleItemId: group.ruleItemId,
      isRefund: group.isRefund,
      detailCount: group.detailCount,
      totalAmount: (group.totalCents / 100).toFixed(2),
    }));
}

export function summarizeOrderRecognitionFiles(
  files: OrderRecognitionFileSnapshot[],
) {
  return files.reduce((summary, file) => {
    summary.totalCents += toCents(file.orderTotalAmount || 0) - toCents(file.refundAmount || 0);
    summary.count += Number(file.entryCount || 0);
    summary.matchedCount += Number(file.matchedCount || 0);
    summary.unmatchedCount += Number(file.unmatchedCount || 0);
    summary.pendingSplitCount += Number(file.pendingSplitCount || 0);
    return summary;
  }, {
    totalCents: 0,
    count: 0,
    matchedCount: 0,
    unmatchedCount: 0,
    pendingSplitCount: 0,
  });
}

export function summarizeOrderRecognitionGroups(
  groups: Iterable<OrderRecognitionSummaryGroup>,
  options: { recognizableOnly?: boolean } = {},
): OrderRecognitionPhaseSummary {
  const summary = { totalCents: 0, count: 0 };
  for (const group of groups) {
    if (options.recognizableOnly && (group.detailCount <= 0 || group.totalCents === 0)) continue;
    summary.totalCents += group.totalCents;
    summary.count += group.detailCount;
  }
  return summary;
}

export function deriveFreshOrderRecognitionPhaseSummaries(
  files: OrderRecognitionFileSnapshot[],
  groups: Iterable<OrderRecognitionSummaryGroup>,
) {
  const fileSummary = summarizeOrderRecognitionFiles(files);
  const recognized = summarizeOrderRecognitionGroups(groups, { recognizableOnly: true });
  return {
    fileSummary,
    recognized,
    open: {
      totalCents: fileSummary.totalCents - recognized.totalCents,
      count: Math.max(0, fileSummary.count - recognized.count),
    },
  };
}
