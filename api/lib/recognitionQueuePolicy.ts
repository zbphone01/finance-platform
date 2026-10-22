import type { ExecuteRecognitionOptions } from "../taskRouter";

function getDetailSplitFileId(options?: ExecuteRecognitionOptions) {
  const detailSplitFileId = Number(options?.detailSplitFileId || 0);
  return detailSplitFileId > 0 ? detailSplitFileId : 0;
}

export function getRecognitionQueueKey(
  taskId: number,
  options?: ExecuteRecognitionOptions,
) {
  const detailSplitFileId = getDetailSplitFileId(options);
  return detailSplitFileId
    ? `${taskId}:detail-split:${detailSplitFileId}`
    : `${taskId}:standard`;
}

export function mergeRecognitionOptions(
  current?: ExecuteRecognitionOptions,
  next?: ExecuteRecognitionOptions,
): ExecuteRecognitionOptions | undefined {
  const currentDetailSplitFileId = getDetailSplitFileId(current);
  const nextDetailSplitFileId = getDetailSplitFileId(next);
  if (currentDetailSplitFileId !== nextDetailSplitFileId) {
    throw new Error("不同认账范围不能合并到同一个队列任务");
  }

  return {
    ...current,
    ...next,
    refreshUnmatchedMatches: Boolean(
      current?.refreshUnmatchedMatches || next?.refreshUnmatchedMatches,
    ),
    useSummaryDeltas: Boolean(
      current?.useSummaryDeltas || next?.useSummaryDeltas,
    ),
    detailSplitFileId: currentDetailSplitFileId || undefined,
  };
}
