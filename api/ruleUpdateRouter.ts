import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  budgetCodes,
  fundraisingPlatforms,
  incomeRuleSplits,
  projects,
  ruleItemSplits,
  ruleUpdateLogs,
} from "@db/schema";
import { and, desc, eq } from "drizzle-orm";

type SplitRow = {
  id: number;
  budgetCode: string | null;
  incomeProject: string | null;
  platformProjectName: string | null;
  expenseFundSource: string | null;
};

function extractBudgetCode(value?: string | null) {
  if (!value) return "";
  return value.split("-")[0]?.trim() || "";
}

function extractProjectCode(value?: string | null) {
  if (!value) return "";
  const projectPart = value.includes(" / ") ? value.split(" / ").pop() || value : value;
  return projectPart.split("_")[0]?.trim() || "";
}

function extractNameFromDisplay(value?: string | null) {
  if (!value) return "";
  const projectPart = value.includes(" / ") ? value.split(" / ").pop() || value : value;
  const parts = projectPart.split("_");
  return parts.length > 1 ? parts.slice(1).join("_") : projectPart;
}

function rebuildExpenseFundSource(row: SplitRow, budgetName: string, platformProjectName: string) {
  if (!row.expenseFundSource) return row.expenseFundSource;
  const parts = row.expenseFundSource.split("_");
  const prefix = row.expenseFundSource.startsWith("限定性_") ? "限定性" : row.expenseFundSource.startsWith("非限定性_") ? "非限定性" : row.incomeProject || "";
  const activityName = parts.length > 0 ? parts[parts.length - 1] : "";
  const projectName = extractNameFromDisplay(platformProjectName);
  return [prefix, budgetName, projectName, activityName].filter(Boolean).join("_");
}

async function buildCurrentMaps(db: ReturnType<typeof getDb>) {
  const budgets = await db
    .select({
      code: budgetCodes.code,
      name: budgetCodes.name,
    })
    .from(budgetCodes)
    .where(and(eq(budgetCodes.isLeaf, 1), eq(budgetCodes.isActive, 1)));

  const budgetMap = new Map<string, { display: string; name: string }>();
  for (const item of budgets) {
    if (!item.code) continue;
    budgetMap.set(item.code, { display: `${item.code}-${item.name}`, name: item.name });
  }

  const platformProjects = await db
    .select({
      code: projects.code,
      name: projects.name,
      platformName: fundraisingPlatforms.name,
    })
    .from(projects)
    .leftJoin(fundraisingPlatforms, eq(projects.platformId, fundraisingPlatforms.platformId))
    .where(and(eq(projects.level, 3), eq(projects.isActive, 1)));

  const platformProjectMap = new Map<string, string>();
  for (const item of platformProjects) {
    const projectText = `${item.code}_${item.name}`;
    platformProjectMap.set(item.code, item.platformName ? `${item.platformName} / ${projectText}` : projectText);
  }

  return { budgetMap, platformProjectMap };
}

async function updateSplitTable(
  db: ReturnType<typeof getDb>,
  table: typeof ruleItemSplits | typeof incomeRuleSplits,
  rows: SplitRow[],
  budgetMap: Map<string, { display: string; name: string }>,
  platformProjectMap: Map<string, string>,
) {
  let updated = 0;

  for (const row of rows) {
    const next: Partial<SplitRow> = {};
    let budgetName = "";
    let platformProjectName = row.platformProjectName || "";

    const budgetCode = extractBudgetCode(row.budgetCode);
    const currentBudget = budgetCode ? budgetMap.get(budgetCode) : undefined;
    if (currentBudget) {
      budgetName = currentBudget.name;
      if (row.budgetCode !== currentBudget.display) {
        next.budgetCode = currentBudget.display;
      }
    }

    const platformProjectCode = extractProjectCode(row.platformProjectName);
    const currentPlatformProject = platformProjectCode ? platformProjectMap.get(platformProjectCode) : undefined;
    if (currentPlatformProject) {
      platformProjectName = currentPlatformProject;
      if (row.platformProjectName !== currentPlatformProject) {
        next.platformProjectName = currentPlatformProject;
      }
    }

    if ((next.budgetCode || next.platformProjectName) && row.expenseFundSource) {
      const rebuilt = rebuildExpenseFundSource(row, budgetName, platformProjectName);
      if (rebuilt !== row.expenseFundSource) {
        next.expenseFundSource = rebuilt;
      }
    }

    if (Object.keys(next).length === 0) continue;

    await db.update(table as any).set(next).where(eq((table as any).id, row.id));
    updated += 1;
  }

  return updated;
}

export const ruleUpdateRouter = createRouter({
  list: authedQuery.query(async () => {
    const db = getDb();
    return db.select().from(ruleUpdateLogs).orderBy(desc(ruleUpdateLogs.createdAt));
  }),

  run: authedQuery.mutation(async ({ ctx }) => {
    const db = getDb();
    const { budgetMap, platformProjectMap } = await buildCurrentMaps(db);

    const detailRows = await db
      .select({
        id: ruleItemSplits.id,
        budgetCode: ruleItemSplits.budgetCode,
        incomeProject: ruleItemSplits.incomeProject,
        platformProjectName: ruleItemSplits.platformProjectName,
        expenseFundSource: ruleItemSplits.expenseFundSource,
      })
      .from(ruleItemSplits);

    const incomeRows = await db
      .select({
        id: incomeRuleSplits.id,
        budgetCode: incomeRuleSplits.budgetCode,
        incomeProject: incomeRuleSplits.incomeProject,
        platformProjectName: incomeRuleSplits.platformProjectName,
        expenseFundSource: incomeRuleSplits.expenseFundSource,
      })
      .from(incomeRuleSplits);

    const detailUpdatedCount = await updateSplitTable(db, ruleItemSplits, detailRows, budgetMap, platformProjectMap);
    const incomeUpdatedCount = await updateSplitTable(db, incomeRuleSplits, incomeRows, budgetMap, platformProjectMap);

    const result = await db.insert(ruleUpdateLogs).values({
      operatorId: ctx.user.id,
      operatorName: ctx.user.name || ctx.user.username,
      incomeUpdatedCount,
      incomeTotalCount: incomeRows.length,
      detailUpdatedCount,
      detailTotalCount: detailRows.length,
    }).$returningId();

    return {
      id: Number(result[0]?.id),
      incomeUpdatedCount,
      incomeTotalCount: incomeRows.length,
      detailUpdatedCount,
      detailTotalCount: detailRows.length,
    };
  }),
});
