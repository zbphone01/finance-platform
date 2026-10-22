export type RecognitionResultGroupRow = {
  id: number | bigint;
  taskId: number | bigint;
  bankFlowId: number | bigint | null;
  ruleItemId: number | bigint | null;
  incomeRuleId: number | bigint | null;
  totalAmount: string | number;
  splitAmount: string | number;
  detailCount: number | null;
  orderDetailCountSnapshot: number | null;
  hasArchivedDetails?: boolean | number | null;
  incomeType: string | null;
  entryTime: string;
};

export type RecognitionResultKind = "income" | "detail" | "manual_detail" | "manual_flow";
export type FlowRecognitionCancellationScopeType = "flow" | "same_day" | "multi_day";

export type FlowRecognitionCancellationScopeRow = {
  id: number | bigint;
  taskId: number | bigint;
};

export type FlowRecognitionCancellationScopeSummary = {
  type: FlowRecognitionCancellationScopeType;
  flowIds: number[];
  taskIds: number[];
  includeTaskScopedLegacyResults: boolean;
};

export type CombinedFlowRecognitionCancellationScopeSummary = {
  type: FlowRecognitionCancellationScopeType | "multiple";
  flowIds: number[];
  taskIds: number[];
  scopeCount: number;
};

function sameNullableId(left: number | bigint | null, right: number | bigint | null) {
  return Number(left || 0) === Number(right || 0);
}

function amountToCents(value: string | number | null | undefined) {
  return Math.round(Number(value || 0) * 100);
}

export const RECOGNITION_CANCELLATION_DETAIL_BATCH_SIZE = 1000;

export function chunkRecognitionCancellationDetailIds(
  ids: number[],
  size = RECOGNITION_CANCELLATION_DETAIL_BATCH_SIZE,
) {
  const batchSize = Math.max(1, Math.floor(size));
  const chunks: number[][] = [];
  for (let index = 0; index < ids.length; index += batchSize) {
    chunks.push(ids.slice(index, index + batchSize));
  }
  return chunks;
}

export async function retryCommittedRecognitionCancellationRefresh(input: {
  refresh: () => Promise<void>;
  maxAttempts?: number;
  retryDelayMs?: number;
  onAttemptError?: (error: unknown, attempt: number) => void;
}) {
  const maxAttempts = Math.max(1, Math.floor(input.maxAttempts || 3));
  const retryDelayMs = Math.max(0, Math.floor(input.retryDelayMs || 0));
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await input.refresh();
      return {
        success: true as const,
        attempts: attempt,
      };
    } catch (error) {
      lastError = error;
      input.onAttemptError?.(error, attempt);
      if (attempt < maxAttempts && retryDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
      }
    }
  }

  return {
    success: false as const,
    attempts: maxAttempts,
    error: lastError,
  };
}

function sameBaseScope(left: RecognitionResultGroupRow, right: RecognitionResultGroupRow) {
  return Number(left.taskId) === Number(right.taskId)
    && sameNullableId(left.bankFlowId, right.bankFlowId);
}

export function getRecognitionResultKind(result: RecognitionResultGroupRow): RecognitionResultKind {
  if (result.incomeRuleId) return "income";
  if (result.ruleItemId) return "detail";
  if (Number(result.orderDetailCountSnapshot || 0) > 0) return "manual_detail";
  return "manual_flow";
}

export function deriveFlowRecognitionCancellationScope(input: {
  clickedFlow: FlowRecognitionCancellationScopeRow;
  aggregateFlows?: FlowRecognitionCancellationScopeRow[];
  isMultiDay?: boolean;
  taskFlowCount: number;
}): FlowRecognitionCancellationScopeSummary {
  const aggregateFlows = input.aggregateFlows || [];
  const isAggregateFlow = aggregateFlows.some(
    (flow) => Number(flow.id) === Number(input.clickedFlow.id),
  );
  const flows = isAggregateFlow ? aggregateFlows : [input.clickedFlow];
  const type: FlowRecognitionCancellationScopeType = isAggregateFlow
    ? input.isMultiDay ? "multi_day" : "same_day"
    : "flow";

  return {
    type,
    flowIds: Array.from(new Set(flows.map((flow) => Number(flow.id)).filter(Boolean))),
    taskIds: Array.from(new Set(flows.map((flow) => Number(flow.taskId)).filter(Boolean))),
    includeTaskScopedLegacyResults: type === "same_day"
      || (type === "flow" && input.taskFlowCount === 1),
  };
}

export function deriveDetailOperationOriginalTaskId(input: {
  operationStatus: string | null | undefined;
  taskId: number | bigint | null | undefined;
  originalTaskId: number | bigint | null | undefined;
}) {
  if (input.operationStatus === "ignored") return Number(input.taskId || 0);
  if (input.operationStatus === "transferred") return Number(input.originalTaskId || 0);
  return 0;
}

export function mergeFlowRecognitionCancellationScopes(
  scopes: FlowRecognitionCancellationScopeSummary[],
): CombinedFlowRecognitionCancellationScopeSummary {
  const uniqueScopes = new Map<string, FlowRecognitionCancellationScopeSummary>();
  for (const scope of scopes) {
    const flowIds = Array.from(new Set(scope.flowIds.map(Number).filter(Boolean))).sort((left, right) => left - right);
    const taskIds = Array.from(new Set(scope.taskIds.map(Number).filter(Boolean))).sort((left, right) => left - right);
    const key = `${scope.type}:${flowIds.join(",")}:${taskIds.join(",")}`;
    if (!uniqueScopes.has(key)) {
      uniqueScopes.set(key, {
        ...scope,
        flowIds,
        taskIds,
      });
    }
  }
  const values = Array.from(uniqueScopes.values());
  return {
    type: values.length === 1 ? values[0].type : "multiple",
    flowIds: Array.from(new Set(values.flatMap((scope) => scope.flowIds))).sort((left, right) => left - right),
    taskIds: Array.from(new Set(values.flatMap((scope) => scope.taskIds))).sort((left, right) => left - right),
    scopeCount: values.length,
  };
}

export function deriveDetailOperationCancellationDecision(input: {
  resultCount: number;
  hasCancelPermission: boolean;
  hasLockedResult: boolean;
  hasGeneratedVoucher: boolean;
  hasArchivedDetails?: boolean;
  operationLabel: string;
  originalDate: string;
  scopeLabel: string;
}) {
  const requiresConfirmation = input.resultCount > 0;
  if (!requiresConfirmation) {
    return {
      requiresConfirmation: false,
      canContinue: true,
      message: "",
    };
  }
  if (input.hasArchivedDetails) {
    return {
      requiresConfirmation: true,
      canContinue: false,
      message: `原日期汇总包含已归档订单明细，只能取消热区订单明细的认账，无法取消${input.operationLabel}`,
    };
  }
  if (!input.hasCancelPermission) {
    return {
      requiresConfirmation: true,
      canContinue: false,
      message: `原日期汇总已有认账结果，当前账号没有取消认账权限，无法取消${input.operationLabel}`,
    };
  }
  if (input.hasLockedResult || input.hasGeneratedVoucher) {
    return {
      requiresConfirmation: true,
      canContinue: false,
      message: `原日期汇总已有已锁定或已生成凭证的认账结果，请先取消凭证或锁定后再取消${input.operationLabel}`,
    };
  }
  return {
    requiresConfirmation: true,
    canContinue: true,
    message: `原日期汇总 ${input.originalDate || "-"} 的${input.scopeLabel}已有认账结果，继续将先取消该范围的全部认账结果，再取消${input.operationLabel}。是否继续？`,
  };
}

export function hasArchivedRecognitionDetails(rows: RecognitionResultGroupRow[]) {
  return rows.some((row) => row.hasArchivedDetails === true || Number(row.hasArchivedDetails || 0) === 1);
}

export function canCancelFlowRecognition(input: {
  hasRecognition: boolean;
  hasArchivedDetails: boolean;
}) {
  return input.hasRecognition && !input.hasArchivedDetails;
}

export function classifyRecognitionCancellationDetailCoverage(input: {
  expectedDetailCount: number;
  hotDetailCount: number;
  hasArchivedDetails: boolean;
  hasCompletedArchiveRun: boolean;
}) {
  const expectedDetailCount = Math.max(0, Number(input.expectedDetailCount || 0));
  const hotDetailCount = Math.max(0, Number(input.hotDetailCount || 0));
  const missingDetailCount = Math.max(0, expectedDetailCount - hotDetailCount);
  if (input.hasArchivedDetails) {
    return { status: "archived" as const, missingDetailCount };
  }
  if (missingDetailCount === 0) {
    return { status: "complete" as const, missingDetailCount: 0 };
  }
  if (input.hasCompletedArchiveRun) {
    return { status: "archived" as const, missingDetailCount };
  }
  return { status: "orphaned" as const, missingDetailCount };
}

export function partitionRecognitionResultIds(rows: RecognitionResultGroupRow[]) {
  const partitions: Record<RecognitionResultKind, number[]> = {
    income: [],
    detail: [],
    manual_detail: [],
    manual_flow: [],
  };
  for (const row of rows) {
    partitions[getRecognitionResultKind(row)].push(Number(row.id));
  }
  return partitions;
}

function selectDetailGroup(
  rows: RecognitionResultGroupRow[],
  selected: RecognitionResultGroupRow,
  manual: boolean,
) {
  const selectedTotal = amountToCents(selected.totalAmount);
  const selectedSnapshotCount = Number(selected.orderDetailCountSnapshot || 0);
  const candidates = rows
    .filter((row) => sameBaseScope(row, selected))
    .filter((row) => !row.incomeRuleId)
    .filter((row) => manual ? !row.ruleItemId : sameNullableId(row.ruleItemId, selected.ruleItemId))
    .filter((row) => amountToCents(row.totalAmount) === selectedTotal)
    .filter((row) => Number(row.orderDetailCountSnapshot || 0) === selectedSnapshotCount)
    .filter((row) => row.entryTime === selected.entryTime)
    .filter((row) => manual || row.incomeType === selected.incomeType)
    .sort((left, right) => Number(left.id) - Number(right.id));

  const selectedIndex = candidates.findIndex((row) => Number(row.id) === Number(selected.id));
  if (selectedIndex < 0) return [selected];

  let startIndex = selectedIndex;
  while (startIndex > 0 && Number(candidates[startIndex].detailCount || 0) === 0) {
    startIndex -= 1;
  }
  if (Number(candidates[startIndex].detailCount || 0) === 0) return [selected];

  let endIndex = startIndex + 1;
  while (endIndex < candidates.length && Number(candidates[endIndex].detailCount || 0) === 0) {
    endIndex += 1;
  }
  return candidates.slice(startIndex, endIndex);
}

function selectManualFlowGroup(rows: RecognitionResultGroupRow[], selected: RecognitionResultGroupRow) {
  const targetCents = amountToCents(selected.totalAmount);
  const candidates = rows
    .filter((row) => sameBaseScope(row, selected))
    .filter((row) => !row.ruleItemId && !row.incomeRuleId)
    .filter((row) => Number(row.orderDetailCountSnapshot || 0) === 0)
    .filter((row) => amountToCents(row.totalAmount) === targetCents)
    .filter((row) => row.entryTime === selected.entryTime)
    .sort((left, right) => Number(left.id) - Number(right.id));

  let currentGroup: RecognitionResultGroupRow[] = [];
  let currentCents = 0;
  for (const row of candidates) {
    currentGroup.push(row);
    currentCents += amountToCents(row.splitAmount);
    const isSelectedGroup = currentGroup.some((item) => Number(item.id) === Number(selected.id));
    if (Math.abs(currentCents - targetCents) <= 1) {
      if (isSelectedGroup) return currentGroup;
      currentGroup = [];
      currentCents = 0;
    }
  }

  return currentGroup.some((row) => Number(row.id) === Number(selected.id)) ? currentGroup : [selected];
}

export function selectRecognitionResultGroup(
  rows: RecognitionResultGroupRow[],
  selected: RecognitionResultGroupRow,
) {
  const kind = getRecognitionResultKind(selected);
  if (kind === "income") {
    return rows
      .filter((row) => sameBaseScope(row, selected))
      .filter((row) => sameNullableId(row.incomeRuleId, selected.incomeRuleId))
      .sort((left, right) => Number(left.id) - Number(right.id));
  }
  if (kind === "detail") return selectDetailGroup(rows, selected, false);
  if (kind === "manual_detail") return selectDetailGroup(rows, selected, true);
  return selectManualFlowGroup(rows, selected);
}
