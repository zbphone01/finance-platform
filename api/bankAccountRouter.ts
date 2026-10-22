import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { bankAccounts } from "@db/schema";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { userHasPermission } from "./lib/permissions";

const bankNameSchema = z.enum(["广发银行", "工商银行", "中国银行"]);
const bankAccountInput = z.object({
  bankName: bankNameSchema,
  accountNo: z.string().trim().min(1, "请输入到账账号").max(100, "到账账号最长100字"),
  accountAlias: z.string().trim().max(200, "凭证名称最长200字").default(""),
  isDefault: z.boolean().default(false),
});

async function assertFinancialVoucherInfoPermission(ctx: any) {
  if (!(await userHasPermission(ctx.user, "financial_voucher_info_menu_access"))) {
    throw new Error("权限不足");
  }
}

export const bankAccountRouter = createRouter({
  list: authedQuery.query(async ({ ctx }) => {
    await assertFinancialVoucherInfoPermission(ctx);
    const db = getDb();
    const items = await db.select().from(bankAccounts)
      .orderBy(asc(bankAccounts.bankName), asc(bankAccounts.accountNo));
    return { items, total: items.length };
  }),

  create: authedQuery
    .input(bankAccountInput)
    .mutation(async ({ ctx, input }) => {
      await assertFinancialVoucherInfoPermission(ctx);
      const db = getDb();
      const accountNo = input.accountNo.replace(/\s+/g, "");
      const [existing] = await db.select({ id: bankAccounts.id }).from(bankAccounts)
        .where(and(eq(bankAccounts.bankName, input.bankName), eq(bankAccounts.accountNo, accountNo)));
      if (existing) throw new Error("该银行账号已存在");

      await db.transaction(async (tx) => {
        const existingBankAccounts = await tx.select({ id: bankAccounts.id }).from(bankAccounts)
          .where(eq(bankAccounts.bankName, input.bankName));
        const shouldBeDefault = input.isDefault || existingBankAccounts.length === 0;
        if (shouldBeDefault) {
          await tx.update(bankAccounts).set({ isDefault: false })
            .where(eq(bankAccounts.bankName, input.bankName));
        }
        await tx.insert(bankAccounts).values({
          bankName: input.bankName,
          accountNo,
          accountAlias: input.accountAlias,
          sourceType: "manual",
          isDefault: shouldBeDefault,
        });
      });
      return { success: true };
    }),

  update: authedQuery
    .input(bankAccountInput.omit({ bankName: true }).extend({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertFinancialVoucherInfoPermission(ctx);
      const db = getDb();
      const [current] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, input.id));
      if (!current) throw new Error("银行账号不存在");

      const accountNo = input.accountNo.replace(/\s+/g, "");
      if (current.sourceType === "upload" && accountNo !== current.accountNo) {
        throw new Error("上传采集的账号不能修改");
      }
      const duplicate = await db.select({ id: bankAccounts.id }).from(bankAccounts)
        .where(and(eq(bankAccounts.bankName, current.bankName), eq(bankAccounts.accountNo, accountNo)));
      if (duplicate.some((item) => Number(item.id) !== input.id)) throw new Error("该银行账号已存在");

      await db.transaction(async (tx) => {
        if (input.isDefault) {
          await tx.update(bankAccounts).set({ isDefault: false })
            .where(eq(bankAccounts.bankName, current.bankName));
        }
        await tx.update(bankAccounts).set({
          accountNo,
          accountAlias: input.accountAlias,
          isDefault: input.isDefault,
          updatedAt: new Date(),
        }).where(eq(bankAccounts.id, input.id));
      });
      return { success: true };
    }),
});
