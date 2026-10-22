export function getDeleteTargetTaskDate(
  packageDate: string,
  isUnmatchedPackage: boolean,
) {
  if (isUnmatchedPackage) return null;

  const normalized = String(packageDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error("订单日期/匹配日期格式异常");
  }
  return normalized;
}

export function getOrderFileDeleteDbHeavyJobKey(input: {
  billDate: string;
  ruleId: number;
  detailPackageType: "T+1" | "打包明细";
  orderFileId?: number;
}) {
  return [
    "order-file-delete",
    String(input.billDate || "").trim(),
    input.detailPackageType,
    Number(input.ruleId || 0),
    input.orderFileId ? `file-${Number(input.orderFileId)}` : "all",
  ].join(":");
}
