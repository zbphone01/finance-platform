export type PartialTransferAmountResult = {
  recognitionAvailableCents: number;
  pendingSplitCents: number;
  transferTargetCents: number;
  pendingSplitMatchesAvailable: boolean;
  pendingSplitExceedsAvailable: boolean;
};

export function calculatePartialTransferAmount(
  recognitionAvailableCents: number,
  pendingSplitCents: number,
): PartialTransferAmountResult {
  const available = Math.max(0, Math.round(Number(recognitionAvailableCents) || 0));
  const pending = Math.max(0, Math.round(Number(pendingSplitCents) || 0));
  return {
    recognitionAvailableCents: available,
    pendingSplitCents: pending,
    transferTargetCents: Math.max(0, available - pending),
    pendingSplitMatchesAvailable: available > 0 && pending === available,
    pendingSplitExceedsAvailable: available > 0 && pending > available,
  };
}

export function resolvePartialTransferPendingTaskIds(
  currentTaskId: number,
  aggregateTaskIds: number[] = [],
) {
  return Array.from(new Set([currentTaskId, ...aggregateTaskIds]
    .map(Number)
    .filter((taskId) => Number.isInteger(taskId) && taskId > 0)));
}
