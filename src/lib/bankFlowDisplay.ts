export const bankFlowBankNames = ["广发银行", "工商银行", "中国银行"] as const;

export type BankFlowBankName = (typeof bankFlowBankNames)[number];
export type BankFlowDirection = "income" | "expense";

export type BankFlowDisplayField =
  | "id"
  | "referenceNo"
  | "transactionTime"
  | "amount"
  | "counterpartyAccount"
  | "counterpartyName"
  | "summary"
  | "purpose"
  | "postScript";

export type BankFlowDisplayColumn = {
  field: BankFlowDisplayField;
  label: string;
};

const icbcColumns: BankFlowDisplayColumn[] = [
  { field: "id", label: "ID" },
  { field: "referenceNo", label: "流水号" },
  { field: "transactionTime", label: "交易时间" },
  { field: "amount", label: "转入金额" },
  { field: "counterpartyName", label: "对方单位" },
  { field: "counterpartyAccount", label: "对方账号" },
  { field: "purpose", label: "用途" },
  { field: "summary", label: "摘要" },
  { field: "postScript", label: "附言" },
];

const chinaBankColumns: BankFlowDisplayColumn[] = [
  { field: "id", label: "ID" },
  { field: "counterpartyAccount", label: "付款人账号" },
  { field: "counterpartyName", label: "付款人名称" },
  { field: "transactionTime", label: "交易时间" },
  { field: "amount", label: "交易金额" },
  { field: "referenceNo", label: "交易流水号" },
  { field: "summary", label: "摘要" },
  { field: "purpose", label: "用途" },
  { field: "postScript", label: "交易附言" },
];

export function getBankFlowDisplayColumns(
  bankName: BankFlowBankName,
  direction: BankFlowDirection,
): BankFlowDisplayColumn[] {
  if (bankName === "工商银行") return icbcColumns;
  if (bankName === "中国银行") return chinaBankColumns;
  return [
    { field: "id", label: "ID" },
    { field: "referenceNo", label: "流水号" },
    { field: "transactionTime", label: "交易时间" },
    { field: "amount", label: direction === "expense" ? "支出" : "收入" },
    { field: "counterpartyAccount", label: "对方账号" },
    { field: "counterpartyName", label: "对方户名" },
    { field: "summary", label: "摘要" },
    { field: "purpose", label: "备注" },
    { field: "postScript", label: "附言" },
  ];
}
