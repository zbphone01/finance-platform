import { departments } from "@db/schema";
import { and, eq } from "drizzle-orm";

export type MemberProjectCenterInput = {
  incomeType?: string | null;
  donationSource?: string | null;
  memberName?: string | null;
  projectCenter?: string | null;
};

export function isBankDirectDonation(input: Pick<MemberProjectCenterInput, "incomeType" | "donationSource">) {
  return ["捐赠收入", "订单退款"].includes(String(input.incomeType || ""))
    && input.donationSource === "银行直捐";
}

export function validateMemberProjectCenterRequirement(input: MemberProjectCenterInput, label: string) {
  if (!isBankDirectDonation(input)) return;
  if (input.memberName?.trim() && !input.projectCenter?.trim()) {
    throw new Error(`${label}填写会员姓名时所属项目中心不能为空`);
  }
}

export function extractProjectCenterCode(value?: string | null) {
  return String(value || "").trim().split("_")[0]?.trim() || "";
}

export async function normalizeProjectCenters(
  db: any,
  splits: MemberProjectCenterInput[],
) {
  splits.forEach((split, index) => {
    validateMemberProjectCenterRequirement(split, `分账 ${index + 1} `);
  });
  if (!splits.some((split) => isBankDirectDonation(split) && split.projectCenter?.trim())) {
    return splits.map(() => null);
  }

  const rows = await db
    .select({
      code: departments.code,
      name: departments.name,
    })
    .from(departments)
    .where(and(
      eq(departments.parentCode, "01"),
      eq(departments.level, 2),
      eq(departments.isActive, 1),
    ));
  const displayByCode = new Map<string, string>(
    rows.map((row: { code: string; name: string }): [string, string] => [
      row.code,
      `${row.code}_${row.name}`,
    ]),
  );

  return splits.map((split, index) => {
    if (!isBankDirectDonation(split)) return null;
    const value = split.projectCenter?.trim() || "";
    if (!value) return null;
    const normalized = displayByCode.get(extractProjectCenterCode(value));
    if (!normalized) {
      throw new Error(`分账 ${index + 1} 所属项目中心必须选择部门管理中01一级部门下的有效二级部门`);
    }
    return normalized;
  });
}
