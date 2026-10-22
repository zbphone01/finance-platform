import { createRouter, publicQuery } from "./middleware";
import { authRouter } from "./authRouter";
import { ruleRouter } from "./ruleRouter";
import { taskRouter } from "./taskRouter";
import { resultRouter } from "./resultRouter";
import { userRouter } from "./userRouter";
import { orderFileRouter } from "./orderFileRouter";
import { counterpartyRouter } from "./counterpartyRouter";
import { incomeRuleRouter } from "./incomeRuleRouter";
import { departmentRouter } from "./departmentRouter";
import { projectRouter } from "./projectRouter";
import { budgetCodeRouter } from "./budgetCodeRouter";
import { donationActivityRouter } from "./donationActivityRouter";
import { fundraisingPlatformRouter } from "./fundraisingPlatformRouter";
import { ruleUpdateRouter } from "./ruleUpdateRouter";
import { detailSplitFileRouter } from "./detailSplitFileRouter";
import { voucherSummaryRouter } from "./voucherSummaryRouter";
import { voucherTemplateRouter } from "./voucherTemplateRouter";
import { permissionRouter } from "./permissionRouter";
import { systemInfoRouter } from "./systemInfoRouter";
import { bankAccountRouter } from "./bankAccountRouter";
import { invoiceOnlyRuleRouter } from "./invoiceOnlyRuleRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  rule: ruleRouter,
  task: taskRouter,
  result: resultRouter,
  user: userRouter,
  orderFile: orderFileRouter,
  counterparty: counterpartyRouter,
  incomeRule: incomeRuleRouter,
  department: departmentRouter,
  project: projectRouter,
  budgetCode: budgetCodeRouter,
  fundraisingPlatform: fundraisingPlatformRouter,
  donationActivity: donationActivityRouter,
  ruleUpdate: ruleUpdateRouter,
  detailSplitFile: detailSplitFileRouter,
  voucherSummary: voucherSummaryRouter,
  voucherTemplate: voucherTemplateRouter,
  permission: permissionRouter,
  systemInfo: systemInfoRouter,
  bankAccount: bankAccountRouter,
  invoiceOnlyRule: invoiceOnlyRuleRouter,
});

export type AppRouter = typeof appRouter;
