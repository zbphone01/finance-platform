const ORDER_IMPORT_ESTIMATED_ROWS = 1_500_000;
const ORDER_PARSE_WEIGHT = 30;
const ORDER_IMPORT_WEIGHT = 70;

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function getOrderImportPhaseProgress(processedRows: number) {
  const rows = Math.max(0, Number(processedRows || 0));
  return Math.min(99, clampProgress((rows / ORDER_IMPORT_ESTIMATED_ROWS) * 100));
}

export function getOrderUploadOverallProgress(parseProgress: number, importProgress: number) {
  const parse = clampProgress(parseProgress);
  const imported = clampProgress(importProgress);
  return clampProgress((parse * ORDER_PARSE_WEIGHT + imported * ORDER_IMPORT_WEIGHT) / 100);
}
