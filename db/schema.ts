import {
  mysqlTable,
  serial,
  varchar,
  text,
  timestamp,
  datetime,
  date,
  bigint,
  decimal,
  boolean,
  int,
  index,
  uniqueIndex,
  primaryKey,
  mysqlEnum,
  json,
} from "drizzle-orm/mysql-core";
import { relations } from "drizzle-orm";

// ======================== Users ========================
export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 100 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  name: varchar("name", { length: 100 }),
  role: mysqlEnum("role", ["admin", "operator", "finance"]).default("operator").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  loginFailedAttempts: int("login_failed_attempts").default(0).notNull(),
  lockedAt: timestamp("locked_at"),
  twoFactorSecret: varchar("two_factor_secret", { length: 512 }),
  twoFactorEnabled: boolean("two_factor_enabled").default(false).notNull(),
  twoFactorEnabledAt: timestamp("two_factor_enabled_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ======================== Role Permissions ========================
export const rolePermissions = mysqlTable("role_permissions", {
  id: serial("id").primaryKey(),
  role: mysqlEnum("role", ["operator", "finance"]).notNull(),
  permissionKey: varchar("permission_key", { length: 100 }).notNull(),
  allowed: boolean("allowed").default(false).notNull(),
  updatedBy: bigint("updated_by", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  roleIdx: index("rp_role_idx").on(table.role),
  permissionIdx: index("rp_permission_idx").on(table.permissionKey),
  rolePermissionIdx: uniqueIndex("rp_role_permission_idx").on(table.role, table.permissionKey),
}));

export type RolePermission = typeof rolePermissions.$inferSelect;
export type InsertRolePermission = typeof rolePermissions.$inferInsert;

// ======================== Recognition Rules ========================
export const recognitionRules = mysqlTable("recognition_rules", {
  id: serial("id").primaryKey(),
  ruleName: varchar("rule_name", { length: 200 }).notNull(),
  matchedCounterpartyAlias: varchar("matched_counterparty_alias", { length: 200 }), // 匹配到账信息：到账信息汇总中的到账别称
  dateField: varchar("date_field", { length: 100 }).notNull().default("时间"), // 日期字段：识别订单明细中的日期列名（规则级别）
  incomeField: varchar("income_field", { length: 100 }).notNull().default("金额"), // 收入字段：识别订单明细中的金额列名（规则级别）
  orderNoField: varchar("order_no_field", { length: 100 }).notNull().default("订单号"), // 订单号字段：识别订单明细中的订单号列名（规则级别）
  invoiceOtherOrderNo1Field: varchar("invoice_other_order_no_1_field", { length: 100 }), // 票据用其他单号1对应的订单明细列名
  invoiceOtherOrderNo2Field: varchar("invoice_other_order_no_2_field", { length: 100 }), // 票据用其他单号2对应的订单明细列名
  conditionRecognitionEnabled: boolean("condition_recognition_enabled").default(true).notNull(), // 条件认账：关闭后整包按分账设置一次入账
  excludeOrderEnabled: boolean("exclude_order_enabled").default(false).notNull(), // 排除订单：开启后上传时命中任一排除条件的明细不入库
  excludeOrderField: varchar("exclude_order_field", { length: 100 }), // 兼容旧版本：第一组排除订单识别字段
  excludeOrderKeyword: varchar("exclude_order_keyword", { length: 500 }), // 兼容旧版本：第一组排除订单字段关键字
  refundOrderEnabled: boolean("refund_order_enabled").default(false).notNull(), // 判断退款订单：开启后按退款字段入库为负数
  refundJudgeField: varchar("refund_judge_field", { length: 100 }), // 退款订单判断字段
  refundJudgeValue: varchar("refund_judge_value", { length: 500 }), // 退款订单判断字段值
  refundDirectionJudgeValue: varchar("refund_direction_judge_value", { length: 500 }), // 与退款判断共用字段；命中后按收入/退款金额方向分类
  refundAmountField: varchar("refund_amount_field", { length: 100 }), // 退款金额字段
  detailSplitEnabled: boolean("detail_split_enabled").default(false).notNull(), // 明细分账：开启后才识别待拆分订单
  multiSplitKeywordField: varchar("multi_split_keyword_field", { length: 100 }), // 明细分账判断字段：识别“等多件”等尾部关键字的字段
  multiSplitKeyword: varchar("multi_split_keyword", { length: 100 }), // 判断关键字：尾部关键字
  multiSplitMatchField: varchar("multi_split_match_field", { length: 100 }), // 明细匹配字段：后续分账明细关联字段
  detailSplitRecognitionKeywordField: varchar("detail_split_recognition_keyword_field", { length: 100 }).notNull().default("商品标题"), // 分账包认账条件字段
  detailSplitIncomeField: varchar("detail_split_income_field", { length: 100 }).notNull().default("买家实付金额"), // 分账包收入字段
  detailSplitMatchField: varchar("detail_split_match_field", { length: 100 }).notNull().default("主订单编号"), // 分账包明细匹配字段
  detailSplitOrderNoField: varchar("detail_split_order_no_field", { length: 100 }).notNull().default("子订单编号"), // 分账包子订单号字段，用于跨包滤重
  creatorId: bigint("creator_id", { mode: "number", unsigned: true }).notNull(),
  enabledAt: timestamp("enabled_at").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  creatorIdx: index("rr_creator_idx").on(table.creatorId),
  activeIdx: index("rr_active_idx").on(table.isActive),
}));

export type RecognitionRule = typeof recognitionRules.$inferSelect;
export type InsertRecognitionRule = typeof recognitionRules.$inferInsert;

// ======================== Recognition Rule Exclude Conditions ========================
export const recognitionRuleExcludeConditions = mysqlTable("recognition_rule_exclude_conditions", {
  id: serial("id").primaryKey(),
  ruleId: bigint("rule_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => recognitionRules.id, { onDelete: "cascade" }),
  fieldName: varchar("field_name", { length: 100 }).notNull(),
  matchType: mysqlEnum("match_type", ["等于", "包含"]).default("等于").notNull(),
  keyword: varchar("keyword", { length: 500 }).notNull(),
  sortOrder: int("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  ruleIdx: index("rrec_rule_idx").on(table.ruleId),
}));

export type RecognitionRuleExcludeCondition = typeof recognitionRuleExcludeConditions.$inferSelect;
export type InsertRecognitionRuleExcludeCondition = typeof recognitionRuleExcludeConditions.$inferInsert;

// ======================== Invoice-only Rules ========================
export const invoiceOnlyRules = mysqlTable("invoice_only_rules", {
  id: serial("id").primaryKey(),
  ruleName: varchar("rule_name", { length: 200 }).notNull(),
  dateField: varchar("date_field", { length: 100 }).notNull(),
  timeField: varchar("time_field", { length: 100 }).notNull(),
  incomeField: varchar("income_field", { length: 100 }).notNull(),
  orderNoField: varchar("order_no_field", { length: 100 }).notNull(),
  invoiceOtherOrderNo1Field: varchar("invoice_other_order_no_1_field", { length: 100 }),
  invoiceOtherOrderNo2Field: varchar("invoice_other_order_no_2_field", { length: 100 }),
  descriptionField: varchar("description_field", { length: 100 }).notNull(),
  creatorId: bigint("creator_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => users.id),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  creatorIdx: index("ior_creator_idx").on(table.creatorId),
}));

export type InvoiceOnlyRule = typeof invoiceOnlyRules.$inferSelect;
export type InsertInvoiceOnlyRule = typeof invoiceOnlyRules.$inferInsert;

// ======================== Invoice-only Order Files ========================
export const invoiceOnlyOrderFiles = mysqlTable("invoice_only_order_files", {
  id: serial("id").primaryKey(),
  fileName: varchar("file_name", { length: 200 }).notNull(),
  ruleId: bigint("rule_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => invoiceOnlyRules.id),
  billDate: date("bill_date", { mode: "string" }).notNull(),
  rawColumns: text("raw_columns"),
  invoiceOrderNoFieldSnapshot: json("invoice_order_no_field_snapshot"),
  uploadStatus: mysqlEnum("upload_status", ["processing", "completed", "failed"]).default("processing").notNull(),
  entryCount: int("entry_count").default(0).notNull(),
  processedCount: int("processed_count").default(0).notNull(),
  orderTotalAmount: decimal("order_total_amount", { precision: 18, scale: 2 }).default("0.00").notNull(),
  failedReason: varchar("failed_reason", { length: 500 }),
  uploaderId: bigint("uploader_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  ruleIdx: index("ioof_rule_idx").on(table.ruleId),
  uploaderIdx: index("ioof_uploader_idx").on(table.uploaderId),
}));

export type InvoiceOnlyOrderFile = typeof invoiceOnlyOrderFiles.$inferSelect;
export type InsertInvoiceOnlyOrderFile = typeof invoiceOnlyOrderFiles.$inferInsert;

// ======================== Invoice-only Order Details ========================
export const invoiceOnlyOrderDetails = mysqlTable("invoice_only_order_details", {
  id: serial("id").primaryKey(),
  orderFileId: bigint("order_file_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => invoiceOnlyOrderFiles.id, { onDelete: "cascade" }),
  orderDatetime: datetime("order_datetime", { mode: "string" }).notNull(),
  billNo: varchar("bill_no", { length: 100 }),
  invoiceOtherOrderNo1: varchar("invoice_other_order_no_1", { length: 255 }),
  invoiceOtherOrderNo2: varchar("invoice_other_order_no_2", { length: 255 }),
  description: varchar("description", { length: 500 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 18, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  orderFileIdx: index("iood_order_file_idx").on(table.orderFileId),
}));

export type InvoiceOnlyOrderDetail = typeof invoiceOnlyOrderDetails.$inferSelect;
export type InsertInvoiceOnlyOrderDetail = typeof invoiceOnlyOrderDetails.$inferInsert;

// ======================== Rule Items (Condition) ========================
// 条件定义：用什么关键字匹配哪些订单明细
export const ruleItems = mysqlTable("rule_items", {
  id: serial("id").primaryKey(),
  ruleId: bigint("rule_id", { mode: "number", unsigned: true }).notNull(),
  keywordField: varchar("keyword_field", { length: 100 }).notNull().default("商品名称"), // 认账关键字字段（如"商品名称"）
  detailKeyword: varchar("detail_keyword", { length: 500 }).notNull(), // 关键字值（如"梭梭"）
  keywordMatchType: mysqlEnum("keyword_match_type", ["等于", "包含"]).default("等于").notNull(), // 关键字匹配方式
  sortOrder: int("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  ruleIdx: index("ri_rule_idx").on(table.ruleId),
  keywordIdx: index("ri_keyword_idx").on(table.detailKeyword),
}));

export type RuleItem = typeof ruleItems.$inferSelect;
export type InsertRuleItem = typeof ruleItems.$inferInsert;

// ======================== Rule Item Splits (分账配置) ========================
// 每个条件可以有多个分账子项，比例之和必须=100%
export const ruleItemSplits = mysqlTable("rule_item_splits", {
  id: serial("id").primaryKey(),
  ruleItemId: bigint("rule_item_id", { mode: "number", unsigned: true }).notNull(),
  splitRatio: decimal("split_ratio", { precision: 5, scale: 2 }).default("100.00").notNull(), // 分账比例%
  incomeType: mysqlEnum("income_type", ["捐赠收入", "会费收入", "政府补助", "个税返还", "本金", "投资收益", "利息", "其他收入", "其他"]),
  incomeAttr: mysqlEnum("income_attr", ["非限定性收入", "限定性收入"]),
  incomeDept: varchar("income_dept", { length: 100 }),
  budgetCode: varchar("budget_code", { length: 100 }),
  incomeProject: varchar("income_project", { length: 200 }),
  platformProjectName: varchar("platform_project_name", { length: 500 }),
  platformProjectDetail: varchar("platform_project_detail", { length: 500 }),
  managementFeeRatio: decimal("management_fee_ratio", { precision: 5, scale: 2 }).default("0.00"),
  expenseFundSource: varchar("expense_fund_source", { length: 200 }),
  sortOrder: int("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  ruleItemIdx: index("ris_rule_item_idx").on(table.ruleItemId),
}));

export type RuleItemSplit = typeof ruleItemSplits.$inferSelect;
export type InsertRuleItemSplit = typeof ruleItemSplits.$inferInsert;

// ======================== Rule Update Logs (规则更新日志) ========================
export const ruleUpdateLogs = mysqlTable("rule_update_logs", {
  id: serial("id").primaryKey(),
  operatorId: bigint("operator_id", { mode: "number", unsigned: true }).notNull(),
  operatorName: varchar("operator_name", { length: 100 }).notNull(),
  incomeUpdatedCount: int("income_updated_count").default(0).notNull(),
  incomeTotalCount: int("income_total_count").default(0).notNull(),
  detailUpdatedCount: int("detail_updated_count").default(0).notNull(),
  detailTotalCount: int("detail_total_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  createdIdx: index("rul_created_idx").on(table.createdAt),
  operatorIdx: index("rul_operator_idx").on(table.operatorId),
}));

export type RuleUpdateLog = typeof ruleUpdateLogs.$inferSelect;
export type InsertRuleUpdateLog = typeof ruleUpdateLogs.$inferInsert;

// ======================== Recognition Tasks ========================
export const recognitionTasks = mysqlTable("recognition_tasks", {
  id: serial("id").primaryKey(),
  ruleId: bigint("rule_id", { mode: "number", unsigned: true }).notNull(),
  sameDayCounterpartyId: bigint("same_day_counterparty_id", { mode: "number", unsigned: true }),
  billDate: date("bill_date", { mode: "string" }).notNull(), // T-1 default
  creatorId: bigint("creator_id", { mode: "number", unsigned: true }).notNull(),
  status: mysqlEnum("status", [
    "pending_details",    // 待上传明细
    "processing",         // 处理中
    "large_variance",     // 明细差异大
    "partial_matched",    // 未完全认账
    "completed",          // 已完成
    "failed",             // 失败
  ]).default("pending_details").notNull(),
  bankFlowTotal: decimal("bank_flow_total", { precision: 18, scale: 2 }).default("0.00"),
  billDetailTotal: decimal("bill_detail_total", { precision: 18, scale: 2 }).default("0.00"),
  diffAmount: decimal("diff_amount", { precision: 18, scale: 2 }).default("0.00"),
  bankFlowCount: int("bank_flow_count").default(0),
  billDetailCount: int("bill_detail_count").default(0),
  matchedCount: int("matched_count").default(0),
  unmatchedCount: int("unmatched_count").default(0),
  pendingSplitCount: int("pending_split_count").default(0),
  hasDetailFile: boolean("has_detail_file").default(false).notNull(),
  remark: text("remark"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  ruleIdx: index("rt_rule_idx").on(table.ruleId),
  statusIdx: index("rt_status_idx").on(table.status),
  dateIdx: index("rt_date_idx").on(table.billDate),
  dateRuleIdx: index("rt_date_rule_idx").on(table.billDate, table.ruleId),
  sameDayCounterpartyDateUniqueIdx: uniqueIndex("rt_same_day_counterparty_date_uq").on(table.billDate, table.sameDayCounterpartyId),
  creatorIdx: index("rt_creator_idx").on(table.creatorId),
}));

export type RecognitionTask = typeof recognitionTasks.$inferSelect;
export type InsertRecognitionTask = typeof recognitionTasks.$inferInsert;

// ======================== Recognition Date Summaries ========================
export const recognitionDateSummaries = mysqlTable("recognition_date_summaries", {
  billDate: date("bill_date", { mode: "string" }).primaryKey(),
  primaryTaskId: bigint("primary_task_id", { mode: "number", unsigned: true }).notNull(),
  status: mysqlEnum("status", [
    "pending_recognition",
    "processing",
    "large_variance",
    "partial_matched",
    "completed",
    "failed",
  ]).default("pending_recognition").notNull(),
  taskCount: int("task_count").default(0).notNull(),
  bankFlowTotal: decimal("bank_flow_total", { precision: 18, scale: 2 }).default("0.00").notNull(),
  bankFlowIncomeTotal: decimal("bank_flow_income_total", { precision: 18, scale: 2 }).default("0.00").notNull(),
  bankFlowCount: int("bank_flow_count").default(0).notNull(),
  recognizedBankFlowCount: int("recognized_bank_flow_count").default(0).notNull(),
  billDetailTotal: decimal("bill_detail_total", { precision: 18, scale: 2 }).default("0.00").notNull(),
  billDetailCount: int("bill_detail_count").default(0).notNull(),
  recognizedAmount: decimal("recognized_amount", { precision: 18, scale: 2 }).default("0.00").notNull(),
  matchedCount: int("matched_count").default(0).notNull(),
  unmatchedCount: int("unmatched_count").default(0).notNull(),
  pendingSplitCount: int("pending_split_count").default(0).notNull(),
  diffAmount: decimal("diff_amount", { precision: 18, scale: 2 }).default("0.00").notNull(),
  hasDetailFile: boolean("has_detail_file").default(false).notNull(),
  varianceRuleName: varchar("variance_rule_name", { length: 200 }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  statusIdx: index("rds_status_idx").on(table.status),
  statusBillDateIdx: index("rds_status_bill_date_idx").on(table.status, table.billDate),
  updatedAtIdx: index("rds_updated_at_idx").on(table.updatedAt),
  primaryTaskIdx: index("rds_primary_task_idx").on(table.primaryTaskId),
}));

export type RecognitionDateSummary = typeof recognitionDateSummaries.$inferSelect;
export type InsertRecognitionDateSummary = typeof recognitionDateSummaries.$inferInsert;

// ======================== Bank Accounts (银行/到账账号) ========================
export const bankAccounts = mysqlTable("bank_accounts", {
  id: serial("id").primaryKey(),
  bankName: varchar("bank_name", { length: 50 }).notNull(),
  accountNo: varchar("account_no", { length: 100 }).notNull(),
  accountAlias: varchar("account_alias", { length: 200 }).default("").notNull(),
  sourceType: mysqlEnum("source_type", ["upload", "manual"]).default("manual").notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  bankAccountUniqueIdx: uniqueIndex("ba_bank_account_uq").on(table.bankName, table.accountNo),
}));

export type BankAccount = typeof bankAccounts.$inferSelect;
export type InsertBankAccount = typeof bankAccounts.$inferInsert;

// ======================== Bank Flows (Massive data) ========================
export const bankFlows = mysqlTable("bank_flows", {
  id: serial("id").primaryKey(),
  taskId: bigint("task_id", { mode: "number", unsigned: true }).notNull(),
  bankName: varchar("bank_name", { length: 50 }).default("广发银行").notNull(),
  bankAccountId: bigint("bank_account_id", { mode: "number", unsigned: true }),
  matchedCounterpartyId: bigint("matched_counterparty_id", { mode: "number", unsigned: true }),
  arrivalMatchStatus: mysqlEnum("arrival_match_status", ["unmatched", "matched", "cancelled"]).default("unmatched").notNull(),
  referenceNo: varchar("reference_no", { length: 100 }).notNull(), // 流水号
  transactionTime: varchar("transaction_time", { length: 30 }).notNull(), // 交易时间
  income: decimal("income", { precision: 18, scale: 2 }).notNull(), // 收入
  counterpartyAccount: varchar("counterparty_account", { length: 100 }), // 对方账号
  counterpartyName: varchar("counterparty_name", { length: 200 }), // 对方户名
  counterpartyBank: varchar("counterparty_bank", { length: 200 }), // 对方开户行
  branch: varchar("branch", { length: 200 }), // 交易行所
  summary: varchar("summary", { length: 500 }), // 摘要
  purpose: varchar("purpose", { length: 500 }), // 用途
  postScript: varchar("post_script", { length: 500 }), // 附言
  recognitionStatus: mysqlEnum("recognition_status", ["unrecognized", "partial_matched", "recognized", "large_variance"]).default("unrecognized").notNull(),
  incomeRuleId: bigint("income_rule_id", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  taskIdx: index("bf_task_idx").on(table.taskId),
  taskIdIdx: index("bf_task_id_idx").on(table.taskId, table.id),
  refIdx: index("bf_ref_idx").on(table.referenceNo),
  timeIdx: index("bf_time_idx").on(table.transactionTime),
  statusTimeIdIdx: index("bf_status_time_id_idx").on(table.recognitionStatus, table.transactionTime, table.id),
  recognitionStatusIdx: index("bf_recognition_status_idx").on(table.recognitionStatus),
}));

export type BankFlow = typeof bankFlows.$inferSelect;
export type InsertBankFlow = typeof bankFlows.$inferInsert;

// ======================== Bill Details (Massive data) ========================
export const billDetails = mysqlTable("bill_details", {
  id: serial("id").primaryKey(),
  taskId: bigint("task_id", { mode: "number", unsigned: true }).notNull(),
  ruleId: bigint("rule_id", { mode: "number", unsigned: true }),
  orderFileId: bigint("order_file_id", { mode: "number", unsigned: true }), // 关联订单文件
  detailSplitFileId: bigint("detail_split_file_id", { mode: "number", unsigned: true }), // 关联明细分账包
  splitSourceDetailId: bigint("split_source_detail_id", { mode: "number", unsigned: true }), // 分账明细来源待拆分订单明细
  billNo: varchar("bill_no", { length: 100 }),
  invoiceOtherOrderNo1: varchar("invoice_other_order_no_1", { length: 255 }), // 票据用其他单号1值（上传时固化）
  invoiceOtherOrderNo2: varchar("invoice_other_order_no_2", { length: 255 }), // 票据用其他单号2值（上传时固化）
  billDate: date("bill_date", { mode: "string" }).notNull(),
  partitionDate: date("partition_date", { mode: "string" }).notNull().default("1970-01-01"),
  description: varchar("description", { length: 500 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 18, scale: 2 }).notNull(),
  refundAmountSnapshot: decimal("refund_amount_snapshot", { precision: 18, scale: 2 }).default("0.00").notNull(), // 退款金额快照（退款订单入库时按退款字段保存正数）
  rawData: json("raw_data"), // 规则相关原始字段；打包追踪明细保留非空原始字段
  matchStatus: mysqlEnum("match_status", [
    "unmatched",     // 未匹配
    "matched",       // 已匹配
    "pending_split", // 已识别为单条多分账，等待分账明细拆分
    "ignored",       // 标记不认账
    "manual_ignored", // 手动标记不认账
  ]).default("unmatched").notNull(),
  matchResultId: bigint("match_result_id", { mode: "number", unsigned: true }),
  operationStatus: varchar("operation_status", { length: 20 }).default("active").notNull(),
  lifecycleStatus: mysqlEnum("lifecycle_status", ["normal", "unmatched_package", "archived"]).default("normal").notNull(),
  originalTaskId: bigint("original_task_id", { mode: "number", unsigned: true }),
  originalRecognitionDate: date("original_recognition_date", { mode: "string" }),
  ruleItemId: bigint("rule_item_id", { mode: "number", unsigned: true }),
  ignoreReason: varchar("ignore_reason", { length: 500 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  taskIdx: index("bd_task_idx").on(table.taskId),
  orderFileIdx: index("bd_order_file_idx").on(table.orderFileId),
  detailSplitFileIdx: index("bd_detail_split_file_idx").on(table.detailSplitFileId),
  splitSourceDetailIdx: index("bd_split_source_detail_idx").on(table.splitSourceDetailId),
  statusIdx: index("bd_status_idx").on(table.matchStatus),
  taskStatusIdx: index("bd_task_status_idx").on(table.taskId, table.matchStatus),
  ruleBillDateBillNoPartitionUniqueIdx: uniqueIndex("bd_rule_bill_date_bill_no_partition_uq").on(table.ruleId, table.billDate, table.billNo, table.partitionDate),
  ruleDetailSplitStatusIdx: index("bd_rule_detail_split_status_idx").on(table.ruleId, table.detailSplitFileId, table.matchStatus, table.matchResultId),
  matchResultIdx: index("bd_match_result_idx").on(table.matchResultId),
  operationStatusIdx: index("bd_operation_status_idx").on(table.operationStatus),
  originalTaskIdx: index("bd_original_task_idx").on(table.originalTaskId),
  partitionStatusIdx: index("bd_partition_status_idx").on(table.partitionDate, table.ruleId, table.operationStatus, table.matchStatus),
  lifecyclePackageIdx: index("bd_lifecycle_package_idx").on(table.lifecycleStatus, table.createdAt),
  operationPartitionIdx: index("bd_operation_partition_idx").on(table.operationStatus, table.partitionDate, table.id),
  billDateIdx: index("bd_bill_date_idx").on(table.billDate),
  orderRecognitionItemIdx: index("bd_order_rec_item_idx").on(table.orderFileId, table.matchStatus, table.matchResultId, table.ruleItemId),
}));

export type BillDetail = typeof billDetails.$inferSelect;
export type InsertBillDetail = typeof billDetails.$inferInsert;

// ======================== Manual Order Work Items ========================
// 人工处理订单的稀疏查询投影与冷热定位表；订单事实仍以 bill_details / 月归档表为准。
export const manualOrderWorkItems = mysqlTable("manual_order_work_items", {
  detailId: bigint("detail_id", { mode: "number", unsigned: true }).primaryKey(),
  taskId: bigint("task_id", { mode: "number", unsigned: true }).notNull(),
  originalTaskId: bigint("original_task_id", { mode: "number", unsigned: true }),
  orderFileId: bigint("order_file_id", { mode: "number", unsigned: true }),
  ruleId: bigint("rule_id", { mode: "number", unsigned: true }).default(0).notNull(),
  summaryDate: date("summary_date", { mode: "string" }).notNull(),
  partitionDate: date("partition_date", { mode: "string" }).notNull(),
  billDate: date("bill_date", { mode: "string" }).notNull(),
  uploadDate: varchar("upload_date", { length: 20 }),
  billNo: varchar("bill_no", { length: 100 }),
  ruleName: varchar("rule_name", { length: 200 }).default("").notNull(),
  description: varchar("description", { length: 500 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 18, scale: 2 }).notNull(),
  detailPackageType: mysqlEnum("detail_package_type", ["T+1", "打包明细"]).default("T+1").notNull(),
  operationStatus: mysqlEnum("operation_status", ["ignored", "transferred"]).notNull(),
  displayStatus: mysqlEnum("display_status", ["ignored", "transferred", "transferred_recognized"]).notNull(),
  matchResultId: bigint("match_result_id", { mode: "number", unsigned: true }),
  operationReason: varchar("operation_reason", { length: 500 }),
  storageLocation: mysqlEnum("storage_location", ["hot", "archive"]).default("hot").notNull(),
  archiveTable: varchar("archive_table", { length: 64 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  summaryDateIdx: index("mowi_summary_date_idx").on(table.summaryDate, table.detailId),
  statusDateIdx: index("mowi_status_date_idx").on(table.displayStatus, table.summaryDate, table.detailId),
  ruleStatusDateIdx: index("mowi_rule_status_date_idx").on(table.ruleId, table.displayStatus, table.summaryDate, table.detailId),
}));

export type ManualOrderWorkItem = typeof manualOrderWorkItems.$inferSelect;
export type InsertManualOrderWorkItem = typeof manualOrderWorkItems.$inferInsert;

// ======================== Order File Partitions ========================
export const orderFilePartitions = mysqlTable("order_file_partitions", {
  orderFileId: bigint("order_file_id", { mode: "number", unsigned: true }).notNull(),
  partitionDate: date("partition_date", { mode: "string" }).notNull(),
  detailCount: int("detail_count").default(0).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.orderFileId, table.partitionDate], name: "ofp_pk" }),
  partitionDateIdx: index("ofp_partition_date_idx").on(table.partitionDate),
}));

export type OrderFilePartition = typeof orderFilePartitions.$inferSelect;
export type InsertOrderFilePartition = typeof orderFilePartitions.$inferInsert;

// ======================== Detail Split Files (明细分账包) ========================
export const detailSplitFiles = mysqlTable("detail_split_files", {
  id: serial("id").primaryKey(),
  orderFileId: bigint("order_file_id", { mode: "number", unsigned: true }),
  taskId: bigint("task_id", { mode: "number", unsigned: true }),
  ruleId: bigint("rule_id", { mode: "number", unsigned: true }).notNull(),
  fileName: varchar("file_name", { length: 200 }).notNull(),
  matchField: varchar("match_field", { length: 100 }).notNull(),
  incomeField: varchar("income_field", { length: 100 }).notNull(),
  recognitionKeywordField: varchar("recognition_keyword_field", { length: 100 }),
  orderNoField: varchar("order_no_field", { length: 100 }),
  rawColumns: text("raw_columns"),
  uploadStatus: mysqlEnum("upload_status", ["processing", "completed", "failed"]).default("completed").notNull(),
  entryCount: int("entry_count").default(0).notNull(),
  processedCount: int("processed_count").default(0).notNull(),
  matchedCount: int("matched_count").default(0).notNull(),
  unmatchedCount: int("unmatched_count").default(0).notNull(),
  pendingRecognitionCount: int("pending_recognition_count").default(0).notNull(),
  recognizedCount: int("recognized_count").default(0).notNull(),
  duplicateCount: int("duplicate_count").default(0).notNull(),
  recognitionPhase: mysqlEnum("recognition_phase", ["idle", "finding_tasks", "recognizing", "completed", "failed"]).default("idle").notNull(),
  recognitionTaskTotal: int("recognition_task_total").default(0).notNull(),
  recognitionTaskCompleted: int("recognition_task_completed").default(0).notNull(),
  recognitionFailedReason: varchar("recognition_failed_reason", { length: 500 }),
  failedReason: varchar("failed_reason", { length: 500 }),
  uploaderId: bigint("uploader_id", { mode: "number", unsigned: true }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  orderFileIdx: index("dsf_order_file_idx").on(table.orderFileId),
  taskIdx: index("dsf_task_idx").on(table.taskId),
  ruleIdx: index("dsf_rule_idx").on(table.ruleId),
  uploadStatusIdx: index("dsf_upload_status_idx").on(table.uploadStatus),
  createdAtIdx: index("dsf_created_at_idx").on(table.createdAt),
}));

export type DetailSplitFile = typeof detailSplitFiles.$inferSelect;
export type InsertDetailSplitFile = typeof detailSplitFiles.$inferInsert;

// ======================== Detail Split Order Dedup Keys ========================
// 分账明细会在热表与归档表之间移动，因此子订单滤重键独立持久化，不能依赖 bill_details 唯一索引。
export const detailSplitOrderDedupKeys = mysqlTable("detail_split_order_dedup_keys", {
  ruleId: bigint("rule_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => recognitionRules.id, { onDelete: "cascade" }),
  normalizedOrderNo: varchar("normalized_order_no", { length: 191 }).notNull(),
  detailSplitFileId: bigint("detail_split_file_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => detailSplitFiles.id, { onDelete: "cascade" }),
  sourceLineNumber: int("source_line_number").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.ruleId, table.normalizedOrderNo], name: "dsodk_pk" }),
  fileIdx: index("dsodk_file_idx").on(table.detailSplitFileId),
}));

export type DetailSplitOrderDedupKey = typeof detailSplitOrderDedupKeys.$inferSelect;
export type InsertDetailSplitOrderDedupKey = typeof detailSplitOrderDedupKeys.$inferInsert;

// ======================== Income Recognition Rules (到账认账规则) ========================
export const incomeRecognitionRules = mysqlTable("income_recognition_rules", {
  id: serial("id").primaryKey(),
  ruleName: varchar("rule_name", { length: 200 }).notNull(), // 规则名称
  matchedCounterpartyAlias: varchar("matched_counterparty_alias", { length: 200 }), // 匹配到账信息：到账信息汇总中的到账别称
  recognitionType: mysqlEnum("recognition_type", ["银行直捐", "渠道捐赠"]).default("渠道捐赠").notNull(), // 认账类型
  accountName: varchar("account_name", { length: 200 }), // 对方户名（完全匹配）
  purpose: varchar("purpose", { length: 500 }), // 用途（完全匹配）
  postScript: varchar("post_script", { length: 500 }), // 附言（完全匹配）
  creatorId: bigint("creator_id", { mode: "number", unsigned: true }).notNull(),
  isActive: int("is_active").default(1).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type IncomeRecognitionRule = typeof incomeRecognitionRules.$inferSelect;
export type InsertIncomeRecognitionRule = typeof incomeRecognitionRules.$inferInsert;

// ======================== Income Rule Splits (到账认账规则分账) ========================
export const incomeRuleSplits = mysqlTable("income_rule_splits", {
  id: serial("id").primaryKey(),
  incomeRuleId: bigint("income_rule_id", { mode: "number", unsigned: true }).notNull(),
  splitForm: mysqlEnum("split_form", ["百分比", "认账时填写"]).default("百分比").notNull(),
  splitRatio: decimal("split_ratio", { precision: 5, scale: 2 }).default("100.00").notNull(),
  incomeType: mysqlEnum("income_type", ["捐赠收入", "会费收入", "政府补助", "个税返还", "本金", "投资收益", "利息", "其他收入", "其他"]),
  donationSource: varchar("donation_source", { length: 50 }),
  incomeAttr: mysqlEnum("income_attr", ["非限定性收入", "限定性收入"]),
  remark: varchar("remark", { length: 500 }),
  incomeDept: varchar("income_dept", { length: 100 }),
  budgetCode: varchar("budget_code", { length: 100 }),
  incomeProject: varchar("income_project", { length: 200 }),
  platformProjectName: varchar("platform_project_name", { length: 500 }),
  platformProjectDetail: varchar("platform_project_detail", { length: 500 }),
  feedbackType: mysqlEnum("feedback_type", ["反馈", "重点反馈"]),
  memberName: varchar("member_name", { length: 200 }),
  projectCenter: varchar("project_center", { length: 255 }),
  region: mysqlEnum("region", ["北京市", "外省市", "港澳台", "境外", "内部客商"]),
  isAnonymous: int("is_anonymous").default(0).notNull(),
  managementFeeType: mysqlEnum("management_fee_type", ["比例", "金额"]).default("比例").notNull(),
  managementFeeValue: decimal("management_fee_value", { precision: 18, scale: 2 }).default("0.00"),
  managementFeeRatio: decimal("management_fee_ratio", { precision: 5, scale: 2 }).default("0.00"),
  expenseFundSource: varchar("expense_fund_source", { length: 200 }),
  sortOrder: int("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  incomeRuleIdx: index("irs_rule_idx").on(table.incomeRuleId),
}));

export type IncomeRuleSplit = typeof incomeRuleSplits.$inferSelect;
export type InsertIncomeRuleSplit = typeof incomeRuleSplits.$inferInsert;

// ======================== Order Files (订单明细文件) ========================
export const orderFiles = mysqlTable("order_files", {
  id: serial("id").primaryKey(),
  taskId: bigint("task_id", { mode: "number", unsigned: true }).notNull(),
  fileName: varchar("file_name", { length: 200 }).notNull(),
  ruleId: bigint("rule_id", { mode: "number", unsigned: true }),
  detailPackageType: mysqlEnum("detail_package_type", ["T+1", "打包明细"]).default("T+1").notNull(),
  uploadDate: varchar("upload_date", { length: 20 }),
  multiDayMatchGroupId: bigint("multi_day_match_group_id", { mode: "number", unsigned: true }),
  matchedAccountName: varchar("matched_account_name", { length: 200 }).notNull(),
  incomePurpose: varchar("income_purpose", { length: 500 }),
  incomePostScript: varchar("income_post_script", { length: 500 }),
  rawColumns: text("raw_columns"), // CSV原始列头（逗号分隔），查看时动态展示
  invoiceOrderNoFieldSnapshot: json("invoice_order_no_field_snapshot"), // 上传时订单号、其他单号1/2的字段名快照
  uploadStatus: mysqlEnum("upload_status", ["processing", "completed", "failed", "abnormal"]).default("completed").notNull(),
  entryCount: int("entry_count").default(0).notNull(),
  processedCount: int("processed_count").default(0).notNull(),
  orderTotalAmount: decimal("order_total_amount", { precision: 18, scale: 2 }).default("0.00").notNull(),
  refundAmount: decimal("refund_amount", { precision: 18, scale: 2 }).default("0.00").notNull(),
  matchedCount: int("matched_count").default(0).notNull(),
  unmatchedCount: int("unmatched_count").default(0).notNull(),
  pendingSplitCount: int("pending_split_count").default(0).notNull(),
  recognitionSummaryValid: boolean("recognition_summary_valid").default(false).notNull(),
  failedReason: varchar("failed_reason", { length: 500 }),
  uploaderId: bigint("uploader_id", { mode: "number", unsigned: true }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  taskIdx: index("of_task_idx").on(table.taskId),
  ruleIdx: index("of_rule_idx").on(table.ruleId),
  taskRuleCreatedIdx: index("of_task_rule_created_idx").on(table.taskId, table.ruleId, table.createdAt),
  packageTypeIdx: index("of_package_type_idx").on(table.detailPackageType),
  uploadDateIdx: index("of_upload_date_idx").on(table.uploadDate),
  multiDayMatchGroupIdx: index("of_multi_day_match_group_idx").on(table.multiDayMatchGroupId),
  uploadStatusIdx: index("of_upload_status_idx").on(table.uploadStatus),
  accountIdx: index("of_account_idx").on(table.matchedAccountName),
}));

export type OrderFile = typeof orderFiles.$inferSelect;
export type InsertOrderFile = typeof orderFiles.$inferInsert;

// ======================== Order file recognition summaries ========================
export const orderFileRecognitionSummaries = mysqlTable("order_file_recognition_summaries", {
  orderFileId: bigint("order_file_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => orderFiles.id, { onDelete: "cascade" }),
  ruleItemId: bigint("rule_item_id", { mode: "number", unsigned: true }).notNull(),
  isRefund: boolean("is_refund").default(false).notNull(),
  detailCount: int("detail_count").default(0).notNull(),
  totalAmount: decimal("total_amount", { precision: 18, scale: 2 }).default("0.00").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  pk: primaryKey({
    columns: [table.orderFileId, table.ruleItemId, table.isRefund],
    name: "ofrs_pk",
  }),
}));

export type OrderFileRecognitionSummary = typeof orderFileRecognitionSummaries.$inferSelect;
export type InsertOrderFileRecognitionSummary = typeof orderFileRecognitionSummaries.$inferInsert;

// ======================== Order recognition summary deltas ========================
export const orderRecognitionSummaryDeltas = mysqlTable("order_recognition_summary_deltas", {
  deltaType: mysqlEnum("delta_type", ["source_deduction", "target_transfer_in"]).notNull(),
  orderFileId: bigint("order_file_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => orderFiles.id, { onDelete: "cascade" }),
  taskId: bigint("task_id", { mode: "number", unsigned: true }).notNull(),
  ruleId: bigint("rule_id", { mode: "number", unsigned: true }).notNull(),
  partitionDate: date("partition_date", { mode: "string" }).notNull(),
  summaryKind: mysqlEnum("summary_kind", ["file_total", "rule_item"]).notNull(),
  ruleItemId: bigint("rule_item_id", { mode: "number", unsigned: true }).default(0).notNull(),
  isRefund: boolean("is_refund").default(false).notNull(),
  detailCount: int("detail_count").default(0).notNull(),
  totalAmount: decimal("total_amount", { precision: 18, scale: 2 }).default("0.00").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  pk: primaryKey({
    columns: [
      table.deltaType,
      table.orderFileId,
      table.taskId,
      table.ruleId,
      table.partitionDate,
      table.summaryKind,
      table.ruleItemId,
      table.isRefund,
    ],
    name: "orsd_pk",
  }),
  sourceIdx: index("orsd_source_idx").on(table.deltaType, table.orderFileId),
  targetIdx: index("orsd_target_idx").on(
    table.deltaType,
    table.taskId,
    table.ruleId,
    table.partitionDate,
  ),
}));

export type OrderRecognitionSummaryDelta = typeof orderRecognitionSummaryDeltas.$inferSelect;
export type InsertOrderRecognitionSummaryDelta = typeof orderRecognitionSummaryDeltas.$inferInsert;

// ======================== Multi-day detail matching groups ========================
export const multiDayMatchGroups = mysqlTable("multi_day_match_groups", {
  id: serial("id").primaryKey(),
  ruleId: bigint("rule_id", { mode: "number", unsigned: true }).notNull(),
  status: mysqlEnum("status", ["unmatched", "pending_confirmation", "matched"]).default("unmatched").notNull(),
  anchorTaskId: bigint("anchor_task_id", { mode: "number", unsigned: true }),
  latestBillDate: date("latest_bill_date", { mode: "string" }),
  packageTotal: decimal("package_total", { precision: 18, scale: 2 }).default("0.00").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  ruleStatusIdx: index("mdmg_rule_status_idx").on(table.ruleId, table.status),
  anchorTaskIdx: index("mdmg_anchor_task_idx").on(table.anchorTaskId),
  latestBillDateIdx: index("mdmg_latest_bill_date_idx").on(table.latestBillDate),
}));

export type MultiDayMatchGroup = typeof multiDayMatchGroups.$inferSelect;
export type InsertMultiDayMatchGroup = typeof multiDayMatchGroups.$inferInsert;

export const multiDayMatchGroupFlows = mysqlTable("multi_day_match_group_flows", {
  id: serial("id").primaryKey(),
  groupId: bigint("group_id", { mode: "number", unsigned: true }).notNull(),
  bankFlowId: bigint("bank_flow_id", { mode: "number", unsigned: true }).notNull(),
  sortOrder: int("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  groupIdx: index("mdmgf_group_idx").on(table.groupId),
  bankFlowUniqueIdx: uniqueIndex("mdmgf_bank_flow_uq").on(table.bankFlowId),
  groupFlowUniqueIdx: uniqueIndex("mdmgf_group_flow_uq").on(table.groupId, table.bankFlowId),
}));

export type MultiDayMatchGroupFlow = typeof multiDayMatchGroupFlows.$inferSelect;
export type InsertMultiDayMatchGroupFlow = typeof multiDayMatchGroupFlows.$inferInsert;

// ======================== Counterparty Records (对方账号信息) ========================
export const counterpartyRecords = mysqlTable("counterparty_records", {
  id: serial("id").primaryKey(),
  alias: varchar("alias", { length: 200 }).notNull(), // 到账别称（唯一名称）
  detailMatchingMode: mysqlEnum("detail_matching_mode", ["单笔匹配", "同日汇总匹配", "多日汇总匹配"]).default("单笔匹配").notNull(), // 明细匹配到账方式
  arrivalRegion: mysqlEnum("arrival_region", ["北京市", "外省市", "港澳台", "境外", "内部客商"]), // 渠道认账地区 / 明细到账地区
  recognitionType: mysqlEnum("recognition_type", ["到账认账", "明细认账"]).default("到账认账").notNull(), // 认账类型
  detailPackageType: mysqlEnum("detail_package_type", ["T+1", "打包明细"]).default("T+1").notNull(), // 明细认账数据包类型
  voucherSummaryText: varchar("voucher_summary_text", { length: 500 }), // 制单摘要内容
  voucherIncomeName: varchar("voucher_income_name", { length: 200 }), // 凭证收入名称
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  aliasIdx: index("cr_alias_idx").on(table.alias), // 到账别称索引
  recognitionTypeIdx: index("cr_recognition_type_idx").on(table.recognitionType),
  detailPackageTypeIdx: index("cr_detail_package_type_idx").on(table.detailPackageType),
  detailMatchingModeIdx: index("cr_detail_matching_mode_idx").on(table.detailMatchingMode),
  arrivalRegionIdx: index("cr_arrival_region_idx").on(table.arrivalRegion),
}));

export type CounterpartyRecord = typeof counterpartyRecords.$inferSelect;
export type InsertCounterpartyRecord = typeof counterpartyRecords.$inferInsert;

export const counterpartyMatchAccounts = mysqlTable("counterparty_match_accounts", {
  id: serial("id").primaryKey(),
  counterpartyRecordId: bigint("counterparty_record_id", { mode: "number", unsigned: true })
    .notNull()
    .references(() => counterpartyRecords.id, { onDelete: "cascade" }),
  bankName: varchar("bank_name", { length: 50 }), // 到账银行（为空时不参与匹配）
  accountNo: varchar("account_no", { length: 100 }).notNull(),
  accountName: varchar("account_name", { length: 200 }).default("").notNull(),
  summary: varchar("summary", { length: 500 }).default("").notNull(), // 摘要关键字（包含匹配）
  purpose: varchar("purpose", { length: 500 }).default("").notNull(),
  postScript: varchar("post_script", { length: 500 }).default("").notNull(),
  isActive: int("is_active").default(1).notNull(),
  sortOrder: int("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  recordIdx: index("cma_record_idx").on(table.counterpartyRecordId),
  recordSortIdx: uniqueIndex("cma_record_sort_uq").on(table.counterpartyRecordId, table.sortOrder),
  accountIdx: index("cma_account_idx").on(table.accountNo),
  activeIdx: index("cma_active_idx").on(table.isActive),
}));

export type CounterpartyMatchAccount = typeof counterpartyMatchAccounts.$inferSelect;
export type InsertCounterpartyMatchAccount = typeof counterpartyMatchAccounts.$inferInsert;

// ======================== Voucher Receipt Channels (凭证收款渠道) ========================
export const voucherReceiptChannels = mysqlTable("voucher_receipt_channels", {
  id: serial("id").primaryKey(),
  channelCode: varchar("channel_code", { length: 100 }).notNull(),
  channelName: varchar("channel_name", { length: 200 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  codeIdx: uniqueIndex("vrc_channel_code_idx").on(table.channelCode),
  nameIdx: index("vrc_channel_name_idx").on(table.channelName),
}));

export type VoucherReceiptChannel = typeof voucherReceiptChannels.$inferSelect;
export type InsertVoucherReceiptChannel = typeof voucherReceiptChannels.$inferInsert;

// ======================== Unrecorded Counterparties (未记录到账信息 - 静态表) ========================
// 上传银行流水时自动识别并写入，避免每次请求实时计算 bank_flows 差集
export const unrecordedCounterparties = mysqlTable("unrecorded_counterparties", {
  id: serial("id").primaryKey(),
  bankName: varchar("bank_name", { length: 50 }),
  accountNo: varchar("account_no", { length: 100 }).notNull(),
  accountName: varchar("account_name", { length: 200 }).notNull(),
  summary: varchar("summary", { length: 500 }).default("").notNull(), // 银行流水摘要
  purpose: varchar("purpose", { length: 500 }),
  postScript: varchar("post_script", { length: 500 }),
  firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().onUpdateNow().notNull(),
  occurrenceCount: int("occurrence_count").default(1).notNull(),
}, (table) => ({
  accountNoIdx: index("uc_account_no_idx").on(table.accountNo),
  lastSeenIdx: index("uc_last_seen_idx").on(table.lastSeenAt),
}));

export type UnrecordedCounterparty = typeof unrecordedCounterparties.$inferSelect;
export type InsertUnrecordedCounterparty = typeof unrecordedCounterparties.$inferInsert;

// ======================== Departments (部门层级) ========================
export const departments = mysqlTable("departments", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 20 }).notNull(), // 部门编码：一级2位(00)，二级4位(0001)，三级6位(000101)
  name: varchar("name", { length: 200 }).notNull(), // 部门名称
  parentCode: varchar("parent_code", { length: 20 }), // 上级部门编码，null为一级部门
  level: int("level").notNull(), // 层级：1=一级，2=二级，3=三级
  sortOrder: int("sort_order").default(0).notNull(),
  isActive: int("is_active").default(1).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  codeIdx: index("dept_code_idx").on(table.code),
  parentIdx: index("dept_parent_idx").on(table.parentCode),
  levelIdx: index("dept_level_idx").on(table.level),
}));

export type Department = typeof departments.$inferSelect;
export type InsertDepartment = typeof departments.$inferInsert;

// ======================== Projects (项目信息) ========================
// 三级结构：level=1 项目，level=2 NC项目名称，level=3 平台项目名称
export const projects = mysqlTable("projects", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull(), // 项目编号：一级如"01"，二级NC项目如"PM0000001"，三级平台项目如"PP0000001"
  name: varchar("name", { length: 500 }).notNull(),
  parentCode: varchar("parent_code", { length: 50 }), // 上级项目编号，null=一级
  level: int("level").notNull(), // 1=项目，2=NC项目名称，3=平台项目名称
  platformId: varchar("platform_id", { length: 20 }), // level=3 时关联公益平台 fundraising_platforms.platform_id
  sortOrder: int("sort_order").default(0).notNull(),
  isActive: int("is_active").default(1).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  codeIdx: index("proj_code_idx").on(table.code),
  parentIdx: index("proj_parent_idx").on(table.parentCode),
  levelIdx: index("proj_level_idx").on(table.level),
  platformIdx: index("proj_platform_idx").on(table.platformId),
}));

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

export const projectNameHistories = mysqlTable("project_name_histories", {
  id: serial("id").primaryKey(),
  projectId: bigint("project_id", { mode: "number", unsigned: true }).notNull(),
  code: varchar("code", { length: 50 }).notNull(),
  platformId: varchar("platform_id", { length: 20 }),
  name: varchar("name", { length: 500 }).notNull(),
  effectiveDate: timestamp("effective_date").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  projectIdx: index("pnh_project_idx").on(table.projectId),
  createdIdx: index("pnh_created_idx").on(table.createdAt),
}));

export type ProjectNameHistory = typeof projectNameHistories.$inferSelect;
export type InsertProjectNameHistory = typeof projectNameHistories.$inferInsert;

export const projectDetails = mysqlTable("project_details", {
  id: serial("id").primaryKey(),
  projectId: bigint("project_id", { mode: "number", unsigned: true }).notNull(),
  code: varchar("code", { length: 20 }).notNull(),
  detailInfo: varchar("detail_info", { length: 500 }).notNull(),
  sortOrder: int("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  projectIdx: index("pd_project_idx").on(table.projectId),
  codeIdx: index("pd_code_idx").on(table.code),
}));

export type ProjectDetail = typeof projectDetails.$inferSelect;
export type InsertProjectDetail = typeof projectDetails.$inferInsert;

// ======================== Budget Codes (预算编码) ========================
// 三级结构：level=1 部门(n1)，level=2 NC项目(n1.n2)，level=3 渠道(n1.n2.n3)
// 渠道为叶子节点，选择时显示为 n1.n2.n3-渠道
export const budgetCodes = mysqlTable("budget_codes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 100 }), // 部门/NC项目/渠道分级编码
  name: varchar("name", { length: 500 }).notNull(), // 部门、NC项目或渠道名称
  incomeProject: varchar("income_project", { length: 200 }), // NC项目，level=2/3 使用
  associatedIncomeProjects: json("associated_income_projects").$type<string[]>(), // level=2 可追加关联的 NC项目
  associatedDepartments: json("associated_departments").$type<string[]>(), // level=1 可追加关联的收入部门
  platformId: varchar("platform_id", { length: 20 }), // 渠道可选关联公益平台 fundraising_platforms.platform_id
  parentId: bigint("parent_id", { mode: "number", unsigned: true }), // 上级ID，null=根级
  level: int("level").notNull(), // 1=部门，2=NC项目，3=渠道
  isLeaf: int("is_leaf").default(0).notNull(), // 0=部门/NC项目，1=渠道
  sortOrder: int("sort_order").default(0).notNull(),
  isActive: int("is_active").default(1).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  parentIdx: index("budget_parent_idx").on(table.parentId),
  levelIdx: index("budget_level_idx").on(table.level),
  leafIdx: index("budget_leaf_idx").on(table.isLeaf),
}));

export type BudgetCode = typeof budgetCodes.$inferSelect;
export type InsertBudgetCode = typeof budgetCodes.$inferInsert;

// ======================== Budget Code Histories (预算编码修改历史) ========================
export const budgetCodeHistories = mysqlTable("budget_code_histories", {
  id: serial("id").primaryKey(),
  budgetCodeId: bigint("budget_code_id", { mode: "number", unsigned: true }).notNull(),
  code: varchar("code", { length: 100 }).notNull(), // 历史渠道编码值
  name: varchar("name", { length: 500 }).notNull(), // 历史渠道名称
  incomeProject: varchar("income_project", { length: 200 }), // 历史NC项目值
  platformId: varchar("platform_id", { length: 20 }), // 历史公益平台值
  effectiveDate: timestamp("effective_date").defaultNow().notNull(), // 启用日期
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  budgetCodeIdx: index("bch_budget_idx").on(table.budgetCodeId),
  createdIdx: index("bch_created_idx").on(table.createdAt),
}));

export type BudgetCodeHistory = typeof budgetCodeHistories.$inferSelect;
export type InsertBudgetCodeHistory = typeof budgetCodeHistories.$inferInsert;

// ======================== Fundraising Platforms (公益平台) ========================
export const fundraisingPlatforms = mysqlTable("fundraising_platforms", {
  id: serial("id").primaryKey(),
  platformId: varchar("platform_id", { length: 20 }).notNull().unique(), // 平台标识：FP_01、FP_02...
  name: varchar("name", { length: 200 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  platformIdIdx: index("fp_platform_id_idx").on(table.platformId),
}));

export type FundraisingPlatform = typeof fundraisingPlatforms.$inferSelect;
export type InsertFundraisingPlatform = typeof fundraisingPlatforms.$inferInsert;

// ======================== Donation Activities (捐赠活动) ========================
export const donationActivities = mysqlTable("donation_activities", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 20 }).notNull(), // 分类=2位数字(01)，活动说明=ACT+4位数字(ACT0001)
  name: varchar("name", { length: 500 }).notNull(),
  parentCode: varchar("parent_code", { length: 20 }), // 所属分类编码，null=根级
  level: int("level").notNull(), // 1=分类, 2=活动说明
  isLeaf: int("is_leaf").default(0).notNull(), // 0=分类(可下级), 1=活动说明(叶节点)
  sortOrder: int("sort_order").default(0).notNull(),
  isActive: int("is_active").default(1).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  codeIdx: index("da_code_idx").on(table.code),
  parentIdx: index("da_parent_idx").on(table.parentCode),
  activeIdx: index("da_active_idx").on(table.isActive),
}));

export type DonationActivity = typeof donationActivities.$inferSelect;
export type InsertDonationActivity = typeof donationActivities.$inferInsert;

// ======================== Match Results (入账结果) ========================
export const matchResults = mysqlTable("match_results", {
  id: serial("id").primaryKey(),
  taskId: bigint("task_id", { mode: "number", unsigned: true }).notNull(),
  ruleItemId: bigint("rule_item_id", { mode: "number", unsigned: true }),
  incomeRuleId: bigint("income_rule_id", { mode: "number", unsigned: true }),
  bankFlowId: bigint("bank_flow_id", { mode: "number", unsigned: true }), // 关联银行流水（明细认账/手动认账精确匹配时填充）
  recognitionType: mysqlEnum("recognition_type", ["银行直捐", "渠道捐赠"]).default("渠道捐赠").notNull(),
  incomeType: varchar("income_type", { length: 100 }),
  donationSource: varchar("donation_source", { length: 50 }),
  incomeAttr: varchar("income_attr", { length: 100 }),
  incomeDept: varchar("income_dept", { length: 100 }),
  budgetCode: varchar("budget_code", { length: 100 }),
  incomeProject: varchar("income_project", { length: 200 }),
  platformProjectName: varchar("platform_project_name", { length: 500 }),
  platformProjectDisplayName: varchar("platform_project_display_name", { length: 700 }),
  platformProjectDetail: varchar("platform_project_detail", { length: 500 }),
  bankReferenceNo: varchar("bank_reference_no", { length: 100 }),
  bankTransactionTime: varchar("bank_transaction_time", { length: 30 }),
  bankIncome: decimal("bank_income", { precision: 18, scale: 2 }),
  bankCounterpartyAccount: varchar("bank_counterparty_account", { length: 100 }),
  bankCounterpartyName: varchar("bank_counterparty_name", { length: 200 }),
  bankCounterpartyBank: varchar("bank_counterparty_bank", { length: 200 }),
  bankSummary: varchar("bank_summary", { length: 500 }),
  bankPurpose: varchar("bank_purpose", { length: 500 }),
  bankPostScript: varchar("bank_post_script", { length: 500 }),
  feedbackType: varchar("feedback_type", { length: 50 }),
  memberName: varchar("member_name", { length: 200 }),
  projectCenter: varchar("project_center", { length: 255 }),
  membershipPaymentYears: int("membership_payment_years"),
  region: mysqlEnum("region", ["北京市", "外省市", "港澳台", "境外", "内部客商"]),
  isAnonymous: int("is_anonymous").default(0).notNull(),
  managementFeeType: mysqlEnum("management_fee_type", ["比例", "金额"]).default("比例").notNull(),
  managementFeeValue: decimal("management_fee_value", { precision: 18, scale: 2 }).default("0.00"),
  managementFeeRatio: decimal("management_fee_ratio", { precision: 5, scale: 2 }).default("0.00"),
  managementFeeAmount: decimal("management_fee_amount", { precision: 18, scale: 2 }).default("0.00"),
  expenseFundSource: varchar("expense_fund_source", { length: 200 }),
  remark: varchar("remark", { length: 500 }),
  voucherReceiptChannelCode: varchar("voucher_receipt_channel_code", { length: 100 }),
  totalAmount: decimal("total_amount", { precision: 18, scale: 2 }).notNull(),
  splitAmount: decimal("split_amount", { precision: 18, scale: 2 }).notNull(),
  splitRatio: decimal("split_ratio", { precision: 5, scale: 2 }).default("100.00"),
  voucherStatus: mysqlEnum("voucher_status", ["pending", "created"]).default("pending").notNull(),
  detailCount: int("detail_count").default(0).notNull(),
  orderDetailCountSnapshot: int("order_detail_count_snapshot").default(0).notNull(), // 每条入账结果对应的订单明细数快照（展示/制单用）
  hasArchivedDetails: boolean("has_archived_details").default(false).notNull(), // 任一关联订单明细进入归档后禁止取消认账
  entryTime: varchar("entry_time", { length: 20 }).notNull(), // 银行到账日期(YYYY-MM-DD)
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  taskIdx: index("mr_task_idx").on(table.taskId),
  budgetIdx: index("mr_budget_idx").on(table.budgetCode),
  entryTimeIdx: index("mr_entry_time_idx").on(table.entryTime),
  entryTimeIdIdx: index("mr_entry_time_id_idx").on(table.entryTime, table.id),
  entryTimeBudgetIdx: index("mr_entry_time_budget_idx").on(table.entryTime, table.budgetCode),
  entryTimeVoucherIdx: index("mr_entry_time_voucher_idx").on(table.entryTime, table.voucherStatus),
  bankFlowIdx: index("mr_bank_flow_idx").on(table.bankFlowId),
  voucherStatusIdx: index("mr_voucher_status_idx").on(table.voucherStatus),
}));

export type MatchResult = typeof matchResults.$inferSelect;
export type InsertMatchResult = typeof matchResults.$inferInsert;

// ======================== Voucher Results (制单结果) ========================
export const voucherResults = mysqlTable("voucher_results", {
  id: serial("id").primaryKey(),
  sourceFlowId: bigint("source_flow_id", { mode: "number", unsigned: true }).notNull(),
  voucherDate: varchar("voucher_date", { length: 20 }).notNull(),
  referenceText: varchar("reference_text", { length: 200 }).notNull(),
  voucherKind: mysqlEnum("voucher_kind", ["generated", "manual"]).default("generated").notNull(),
  voucherKey: varchar("voucher_key", { length: 100 }).default("generated").notNull(),
  voucherIdText: varchar("voucher_id_text", { length: 200 }),
  incomeType: varchar("income_type", { length: 100 }),
  voucherAmount: decimal("voucher_amount", { precision: 18, scale: 2 }),
  creationGroupId: varchar("creation_group_id", { length: 64 }),
  isAggregate: int("is_aggregate").default(0).notNull(),
  aggregateFlowCount: int("aggregate_flow_count").default(1).notNull(),
  createdBy: bigint("created_by", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  sourceFlowIdx: index("vr_source_flow_idx").on(table.sourceFlowId),
  sourceKeyUniqueIdx: uniqueIndex("vr_source_key_uq").on(table.sourceFlowId, table.voucherKey),
  kindIdx: index("vr_kind_idx").on(table.voucherKind),
  creationGroupIdx: index("vr_creation_group_idx").on(table.creationGroupId),
  createdAtIdx: index("vr_created_at_idx").on(table.createdAt),
}));

export const voucherResultFlows = mysqlTable("voucher_result_flows", {
  id: serial("id").primaryKey(),
  voucherResultId: bigint("voucher_result_id", { mode: "number", unsigned: true }).notNull(),
  bankFlowId: bigint("bank_flow_id", { mode: "number", unsigned: true }).notNull(),
  sortOrder: int("sort_order").default(0).notNull(),
}, (table) => ({
  voucherResultIdx: index("vrf_result_idx").on(table.voucherResultId),
  bankFlowIdx: index("vrf_flow_idx").on(table.bankFlowId),
  resultFlowUniqueIdx: uniqueIndex("vrf_result_flow_unique_idx").on(table.voucherResultId, table.bankFlowId),
}));

export const voucherResultLines = mysqlTable("voucher_result_lines", {
  id: serial("id").primaryKey(),
  voucherResultId: bigint("voucher_result_id", { mode: "number", unsigned: true }).notNull(),
  matchResultId: bigint("match_result_id", { mode: "number", unsigned: true }),
  lineNo: int("line_no").notNull(),
  lineType: varchar("line_type", { length: 50 }).default("overview").notNull(),
  summary: varchar("summary", { length: 1000 }).notNull(),
  subjectCode: varchar("subject_code", { length: 100 }).notNull(),
  subjectName: varchar("subject_name", { length: 200 }).notNull(),
  debitAmount: varchar("debit_amount", { length: 50 }).notNull(),
  creditAmount: varchar("credit_amount", { length: 50 }).notNull(),
  explanationJson: json("explanation_json").$type<Record<string, string> | null>(),
}, (table) => ({
  voucherResultIdx: index("vrl_result_idx").on(table.voucherResultId),
  matchResultIdx: index("vrl_match_result_idx").on(table.matchResultId),
  lineNoIdx: index("vrl_line_no_idx").on(table.voucherResultId, table.lineNo),
}));

export type VoucherResult = typeof voucherResults.$inferSelect;
export type InsertVoucherResult = typeof voucherResults.$inferInsert;
export type VoucherResultFlow = typeof voucherResultFlows.$inferSelect;
export type InsertVoucherResultFlow = typeof voucherResultFlows.$inferInsert;
export type VoucherResultLine = typeof voucherResultLines.$inferSelect;
export type InsertVoucherResultLine = typeof voucherResultLines.$inferInsert;

// ======================== Voucher Template Settings (凭证模板设置) ========================
export type VoucherTemplateType = "捐赠收入-到账认账模版" | "捐赠收入-明细认账模版" | "会费收入" | "利息收入";
export type VoucherTemplateRow = {
  摘要: string;
  科目编码: string;
  科目名称: string;
  借方金额: string;
  贷方金额: string;
};
export type VoucherTemplateSet = {
  id: string;
  name: string;
  rows: VoucherTemplateRow[];
};
export type VoucherTemplateSettingsValue = Record<VoucherTemplateType, VoucherTemplateSet[]>;
export type LegacyVoucherTemplateSettingsValue = Record<VoucherTemplateType, VoucherTemplateRow[]>;

export const voucherTemplateSettings = mysqlTable("voucher_template_settings", {
  id: serial("id").primaryKey(),
  settingKey: varchar("setting_key", { length: 100 }).notNull().unique(),
  templates: json("templates").$type<VoucherTemplateSettingsValue | LegacyVoucherTemplateSettingsValue>().notNull(),
  updatedBy: bigint("updated_by", { mode: "number", unsigned: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  settingKeyIdx: uniqueIndex("vts_setting_key_idx").on(table.settingKey),
}));

export type VoucherTemplateSetting = typeof voucherTemplateSettings.$inferSelect;
export type InsertVoucherTemplateSetting = typeof voucherTemplateSettings.$inferInsert;

// ======================== System Storage Snapshot ========================
export const systemStorageSnapshot = mysqlTable("system_storage_snapshot", {
  id: int("id").primaryKey().default(1),
  requestDate: date("request_date").notNull(),
  requestedArchiveDate: date("requested_archive_date").notNull(),
  status: mysqlEnum("status", ["pending", "capturing", "completed", "failed"]).default("pending").notNull(),
  snapshotDate: date("snapshot_date"),
  archiveDate: date("archive_date"),
  mountPath: varchar("mount_path", { length: 500 }),
  totalBytes: bigint("total_bytes", { mode: "number", unsigned: true }),
  usedBytes: bigint("used_bytes", { mode: "number", unsigned: true }),
  availableBytes: bigint("available_bytes", { mode: "number", unsigned: true }),
  usagePercent: decimal("usage_percent", { precision: 5, scale: 2 }),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  capturedAt: timestamp("captured_at"),
  errorMessage: varchar("error_message", { length: 1000 }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type SystemStorageSnapshot = typeof systemStorageSnapshot.$inferSelect;
export type InsertSystemStorageSnapshot = typeof systemStorageSnapshot.$inferInsert;

// ======================== Sessions (Custom Auth) ========================
export const sessions = mysqlTable("sessions", {
  id: serial("id").primaryKey(),
  userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
  token: varchar("token", { length: 255 }).notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  tokenIdx: index("sess_token_idx").on(table.token),
  userIdx: index("sess_user_idx").on(table.userId),
}));

export type Session = typeof sessions.$inferSelect;
export type InsertSession = typeof sessions.$inferInsert;

// ======================== Relations ========================
export const usersRelations = relations(users, ({ many }) => ({
  rules: many(recognitionRules),
  invoiceOnlyRules: many(invoiceOnlyRules),
  invoiceOnlyOrderFiles: many(invoiceOnlyOrderFiles),
  tasks: many(recognitionTasks),
  voucherResults: many(voucherResults),
}));

export const recognitionRulesRelations = relations(recognitionRules, ({ one, many }) => ({
  creator: one(users, { fields: [recognitionRules.creatorId], references: [users.id] }),
  excludeConditions: many(recognitionRuleExcludeConditions),
  items: many(ruleItems),
  tasks: many(recognitionTasks),
  detailSplitOrderDedupKeys: many(detailSplitOrderDedupKeys),
}));

export const recognitionRuleExcludeConditionsRelations = relations(recognitionRuleExcludeConditions, ({ one }) => ({
  rule: one(recognitionRules, {
    fields: [recognitionRuleExcludeConditions.ruleId],
    references: [recognitionRules.id],
  }),
}));

export const invoiceOnlyRulesRelations = relations(invoiceOnlyRules, ({ one, many }) => ({
  creator: one(users, { fields: [invoiceOnlyRules.creatorId], references: [users.id] }),
  orderFiles: many(invoiceOnlyOrderFiles),
}));

export const invoiceOnlyOrderFilesRelations = relations(invoiceOnlyOrderFiles, ({ one, many }) => ({
  rule: one(invoiceOnlyRules, { fields: [invoiceOnlyOrderFiles.ruleId], references: [invoiceOnlyRules.id] }),
  uploader: one(users, { fields: [invoiceOnlyOrderFiles.uploaderId], references: [users.id] }),
  details: many(invoiceOnlyOrderDetails),
}));

export const invoiceOnlyOrderDetailsRelations = relations(invoiceOnlyOrderDetails, ({ one }) => ({
  orderFile: one(invoiceOnlyOrderFiles, {
    fields: [invoiceOnlyOrderDetails.orderFileId],
    references: [invoiceOnlyOrderFiles.id],
  }),
}));

export const ruleItemsRelations = relations(ruleItems, ({ one, many }) => ({
  rule: one(recognitionRules, { fields: [ruleItems.ruleId], references: [recognitionRules.id] }),
  splits: many(ruleItemSplits),
  matchResults: many(matchResults),
}));

export const recognitionTasksRelations = relations(recognitionTasks, ({ one, many }) => ({
  rule: one(recognitionRules, { fields: [recognitionTasks.ruleId], references: [recognitionRules.id] }),
  creator: one(users, { fields: [recognitionTasks.creatorId], references: [users.id] }),
  bankFlows: many(bankFlows),
  billDetails: many(billDetails),
  matchResults: many(matchResults),
}));

export const bankFlowsRelations = relations(bankFlows, ({ one, many }) => ({
  task: one(recognitionTasks, { fields: [bankFlows.taskId], references: [recognitionTasks.id] }),
  bankAccount: one(bankAccounts, { fields: [bankFlows.bankAccountId], references: [bankAccounts.id] }),
  voucherResultFlows: many(voucherResultFlows),
  multiDayMatchGroups: many(multiDayMatchGroupFlows),
}));

export const bankAccountsRelations = relations(bankAccounts, ({ many }) => ({
  bankFlows: many(bankFlows),
}));

export const billDetailsRelations = relations(billDetails, ({ one }) => ({
  task: one(recognitionTasks, { fields: [billDetails.taskId], references: [recognitionTasks.id] }),
  matchResult: one(matchResults, { fields: [billDetails.matchResultId], references: [matchResults.id] }),
  ruleItem: one(ruleItems, { fields: [billDetails.ruleItemId], references: [ruleItems.id] }),
  orderFile: one(orderFiles, { fields: [billDetails.orderFileId], references: [orderFiles.id] }),
  detailSplitFile: one(detailSplitFiles, { fields: [billDetails.detailSplitFileId], references: [detailSplitFiles.id] }),
}));

export const orderFilesRelations = relations(orderFiles, ({ one, many }) => ({
  task: one(recognitionTasks, { fields: [orderFiles.taskId], references: [recognitionTasks.id] }),
  uploader: one(users, { fields: [orderFiles.uploaderId], references: [users.id] }),
  multiDayMatchGroup: one(multiDayMatchGroups, { fields: [orderFiles.multiDayMatchGroupId], references: [multiDayMatchGroups.id] }),
  billDetails: many(billDetails),
  detailSplitFiles: many(detailSplitFiles),
}));

export const multiDayMatchGroupsRelations = relations(multiDayMatchGroups, ({ one, many }) => ({
  rule: one(recognitionRules, { fields: [multiDayMatchGroups.ruleId], references: [recognitionRules.id] }),
  anchorTask: one(recognitionTasks, { fields: [multiDayMatchGroups.anchorTaskId], references: [recognitionTasks.id] }),
  orderFiles: many(orderFiles),
  flows: many(multiDayMatchGroupFlows),
}));

export const multiDayMatchGroupFlowsRelations = relations(multiDayMatchGroupFlows, ({ one }) => ({
  group: one(multiDayMatchGroups, { fields: [multiDayMatchGroupFlows.groupId], references: [multiDayMatchGroups.id] }),
  bankFlow: one(bankFlows, { fields: [multiDayMatchGroupFlows.bankFlowId], references: [bankFlows.id] }),
}));

export const detailSplitFilesRelations = relations(detailSplitFiles, ({ one, many }) => ({
  orderFile: one(orderFiles, { fields: [detailSplitFiles.orderFileId], references: [orderFiles.id] }),
  task: one(recognitionTasks, { fields: [detailSplitFiles.taskId], references: [recognitionTasks.id] }),
  rule: one(recognitionRules, { fields: [detailSplitFiles.ruleId], references: [recognitionRules.id] }),
  uploader: one(users, { fields: [detailSplitFiles.uploaderId], references: [users.id] }),
  billDetails: many(billDetails),
  orderDedupKeys: many(detailSplitOrderDedupKeys),
}));

export const detailSplitOrderDedupKeysRelations = relations(detailSplitOrderDedupKeys, ({ one }) => ({
  rule: one(recognitionRules, { fields: [detailSplitOrderDedupKeys.ruleId], references: [recognitionRules.id] }),
  detailSplitFile: one(detailSplitFiles, { fields: [detailSplitOrderDedupKeys.detailSplitFileId], references: [detailSplitFiles.id] }),
}));

export const matchResultsRelations = relations(matchResults, ({ one, many }) => ({
  task: one(recognitionTasks, { fields: [matchResults.taskId], references: [recognitionTasks.id] }),
  ruleItem: one(ruleItems, { fields: [matchResults.ruleItemId], references: [ruleItems.id] }),
  billDetails: many(billDetails),
  voucherResultLines: many(voucherResultLines),
}));

export const voucherResultsRelations = relations(voucherResults, ({ one, many }) => ({
  sourceFlow: one(bankFlows, { fields: [voucherResults.sourceFlowId], references: [bankFlows.id] }),
  creator: one(users, { fields: [voucherResults.createdBy], references: [users.id] }),
  flows: many(voucherResultFlows),
  lines: many(voucherResultLines),
}));

export const voucherResultFlowsRelations = relations(voucherResultFlows, ({ one }) => ({
  voucherResult: one(voucherResults, { fields: [voucherResultFlows.voucherResultId], references: [voucherResults.id] }),
  bankFlow: one(bankFlows, { fields: [voucherResultFlows.bankFlowId], references: [bankFlows.id] }),
}));

export const voucherResultLinesRelations = relations(voucherResultLines, ({ one }) => ({
  voucherResult: one(voucherResults, { fields: [voucherResultLines.voucherResultId], references: [voucherResults.id] }),
  matchResult: one(matchResults, { fields: [voucherResultLines.matchResultId], references: [matchResults.id] }),
}));

export const ruleItemSplitsRelations = relations(ruleItemSplits, ({ one }) => ({
  ruleItem: one(ruleItems, { fields: [ruleItemSplits.ruleItemId], references: [ruleItems.id] }),
}));
