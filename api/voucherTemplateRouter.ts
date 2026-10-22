import { z } from "zod";
import { inArray } from "drizzle-orm";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { voucherTemplateSettings } from "@db/schema";
import { userHasPermission } from "./lib/permissions";
import {
  LEGACY_VOUCHER_TEMPLATE_SETTING_KEY,
  normalizeVoucherTemplates,
  VOUCHER_TEMPLATE_SETTING_KEY,
  voucherTemplateTypes,
} from "./lib/voucherTemplates";

const templateRowSchema = z.object({
  摘要: z.string().max(1000),
  科目编码: z.string().max(100),
  科目名称: z.string().max(200),
  借方金额: z.string().max(100),
  贷方金额: z.string().max(100),
});

const templateSetSchema = z.object({
  id: z.string().trim().min(1, "模板标识不能为空").max(100, "模板标识最长100字"),
  name: z.string().trim().min(1, "模板名称不能为空").max(100, "模板名称最长100字"),
  rows: z.array(templateRowSchema).length(3),
});

const templatesSchema = z.object({
  "捐赠收入-到账认账模版": z.array(templateSetSchema).min(1).max(20),
  "捐赠收入-明细认账模版": z.array(templateSetSchema).min(1).max(20),
  会费收入: z.array(templateSetSchema).min(1).max(20),
  利息收入: z.array(templateSetSchema).min(1).max(20),
}).superRefine((templates, ctx) => {
  for (const templateType of voucherTemplateTypes) {
    const names = new Set<string>();
    const ids = new Set<string>();
    templates[templateType].forEach((template, index) => {
      const normalizedName = template.name.trim().toLocaleLowerCase("zh-CN");
      if (names.has(normalizedName)) {
        ctx.addIssue({
          code: "custom",
          path: [templateType, index, "name"],
          message: `${templateType}的模板名称不能重复`,
        });
      }
      if (ids.has(template.id)) {
        ctx.addIssue({
          code: "custom",
          path: [templateType, index, "id"],
          message: `${templateType}的模板标识不能重复`,
        });
      }
      names.add(normalizedName);
      ids.add(template.id);
    });
  }
});

export const voucherTemplateRouter = createRouter({
  get: authedQuery.query(async ({ ctx }) => {
    if (!(await userHasPermission(ctx.user, "financial_voucher_info_menu_access"))) throw new Error("权限不足");
    const db = getDb();
    const rows = await db
      .select()
      .from(voucherTemplateSettings)
      .where(inArray(voucherTemplateSettings.settingKey, [
        VOUCHER_TEMPLATE_SETTING_KEY,
        LEGACY_VOUCHER_TEMPLATE_SETTING_KEY,
      ]));
    const row = rows.find((item) => item.settingKey === VOUCHER_TEMPLATE_SETTING_KEY)
      || rows.find((item) => item.settingKey === LEGACY_VOUCHER_TEMPLATE_SETTING_KEY);

    return {
      templates: normalizeVoucherTemplates(row?.templates),
      updatedAt: row?.updatedAt || null,
      updatedBy: row?.updatedBy || null,
    };
  }),

  save: authedQuery
    .input(z.object({ templates: templatesSchema }))
    .mutation(async ({ input, ctx }) => {
      if (!(await userHasPermission(ctx.user, "financial_voucher_info_menu_access"))) throw new Error("权限不足");
      const db = getDb();
      const values = {
        settingKey: VOUCHER_TEMPLATE_SETTING_KEY,
        templates: normalizeVoucherTemplates(input.templates),
        updatedBy: Number(ctx.user.id),
        updatedAt: new Date(),
      };

      await db.insert(voucherTemplateSettings)
        .values(values)
        .onDuplicateKeyUpdate({
          set: {
            templates: values.templates,
            updatedBy: values.updatedBy,
            updatedAt: values.updatedAt,
          },
        });

      return { success: true };
    }),
});
