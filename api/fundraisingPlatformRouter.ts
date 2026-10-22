import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { fundraisingPlatforms, projectDetails, projectNameHistories, projects } from "@db/schema";
import { alias } from "drizzle-orm/mysql-core";
import { and, asc, count, desc, eq, like } from "drizzle-orm";
import { userHasPermission } from "./lib/permissions";

function nextPlatformId(items: { platformId: string }[]) {
  const max = items.reduce((current, item) => {
    const match = item.platformId.match(/^FP_(\d{2})$/);
    if (!match) return current;
    return Math.max(current, Number(match[1]));
  }, 0);

  if (max >= 99) {
    throw new Error("公益平台ID已达到 FP_99，无法继续自动生成");
  }

  return `FP_${String(max + 1).padStart(2, "0")}`;
}

function normalizeDisplayCode(value: string) {
  return value.trim().split("_")[0];
}

function validatePlatformProjectCode(code: string) {
  if (!/^PP\d{7}$/i.test(code)) {
    throw new Error("平台项目编号必须以 PP 开头加7位数字，如 PP0000001");
  }
}

function buildDetailCodePrefix(date = new Date()) {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

async function nextProjectDetailCode(db: ReturnType<typeof getDb>) {
  const prefix = buildDetailCodePrefix();
  const rows = await db
    .select({ code: projectDetails.code })
    .from(projectDetails)
    .where(like(projectDetails.code, `${prefix}%`))
    .orderBy(desc(projectDetails.code));
  const max = rows.reduce((current, row) => {
    const match = row.code.match(new RegExp(`^${prefix}(\\d{2})$`));
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `${prefix}${String(max + 1).padStart(2, "0")}`;
}

async function nextPlatformProjectCode(db: ReturnType<typeof getDb>) {
  const rows = await db
    .select({ code: projects.code })
    .from(projects)
    .where(eq(projects.level, 3))
    .orderBy(desc(projects.code));
  const max = rows.reduce((current, row) => {
    const match = String(row.code || "").match(/^PP(\d{7})$/i);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `PP${String(max + 1).padStart(7, "0")}`;
}

async function getPlatformProjects(db: ReturnType<typeof getDb>, platformId?: string) {
  const parentProjects = alias(projects, "parent_projects");
  const conditions = [eq(projects.level, 3), eq(projects.isActive, 1 as any)];
  if (platformId) conditions.push(eq(projects.platformId, platformId));

  return db
    .select({
      id: projects.id,
      code: projects.code,
      name: projects.name,
      parentCode: projects.parentCode,
      parentName: parentProjects.name,
      platformId: projects.platformId,
      sortOrder: projects.sortOrder,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .leftJoin(parentProjects, eq(projects.parentCode, parentProjects.code))
    .where(and(...conditions))
    .orderBy(asc(projects.sortOrder), asc(projects.code));
}

export const fundraisingPlatformRouter = createRouter({
  list: authedQuery.query(async () => {
    const db = getDb();
    return db
      .select()
      .from(fundraisingPlatforms)
      .orderBy(asc(fundraisingPlatforms.platformId));
  }),

  tree: authedQuery.query(async () => {
    const db = getDb();
    const platforms = await db
      .select()
      .from(fundraisingPlatforms)
      .orderBy(asc(fundraisingPlatforms.platformId));
    const platformProjects = await getPlatformProjects(db);
    const details = await db
      .select()
      .from(projectDetails)
      .orderBy(asc(projectDetails.sortOrder), asc(projectDetails.code));

    const projectsByPlatformId = new Map<string, typeof platformProjects>();
    for (const project of platformProjects) {
      if (!project.platformId) continue;
      const projectsForPlatform = projectsByPlatformId.get(project.platformId) || [];
      projectsForPlatform.push(project);
      projectsByPlatformId.set(project.platformId, projectsForPlatform);
    }

    const detailsByProjectId = new Map<number, typeof details>();
    for (const detail of details) {
      const detailsForProject = detailsByProjectId.get(Number(detail.projectId)) || [];
      detailsForProject.push(detail);
      detailsByProjectId.set(Number(detail.projectId), detailsForProject);
    }

    return platforms.map((platform) => ({
      ...platform,
      projects: (projectsByPlatformId.get(platform.platformId) || [])
        .map((project) => ({
          ...project,
          details: detailsByProjectId.get(Number(project.id)) || [],
        })),
    }));
  }),

  platformProjects: authedQuery
    .input(z.object({ platformId: z.string().min(1).max(20) }))
    .query(async ({ input }) => {
      const db = getDb();
      const platformProjects = await getPlatformProjects(db, input.platformId);
      return platformProjects.map((project) => ({ ...project, details: [] }));
    }),

  projectDetails: authedQuery
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db
        .select()
        .from(projectDetails)
        .where(eq(projectDetails.projectId, input.projectId))
        .orderBy(asc(projectDetails.sortOrder), asc(projectDetails.code));
    }),

  search: authedQuery
    .input(z.object({ keyword: z.string().trim().min(1).max(200) }))
    .query(async ({ input }) => {
      const db = getDb();
      const text = input.keyword.toLowerCase();
      const [platforms, platformProjects, details] = await Promise.all([
        db
          .select()
          .from(fundraisingPlatforms)
          .orderBy(asc(fundraisingPlatforms.platformId)),
        getPlatformProjects(db),
        db
          .select()
          .from(projectDetails)
          .orderBy(asc(projectDetails.sortOrder), asc(projectDetails.code)),
      ]);

      const detailsByProjectId = new Map<number, typeof details>();
      for (const detail of details) {
        const detailsForProject = detailsByProjectId.get(Number(detail.projectId)) || [];
        detailsForProject.push(detail);
        detailsByProjectId.set(Number(detail.projectId), detailsForProject);
      }

      const projectsByPlatformId = new Map<string, Array<(typeof platformProjects)[number] & { details: typeof details }>>();
      for (const project of platformProjects) {
        if (!project.platformId) continue;
        const detailsForProject = detailsByProjectId.get(Number(project.id)) || [];
        const platform = platforms.find((item) => item.platformId === project.platformId);
        const platformDisplay = platform ? `${platform.platformId}_${platform.name}` : project.platformId;
        const projectDisplay = `${project.code}_${project.name}`;
        const parentDisplay = project.parentCode ? `${project.parentCode}_${project.parentName || ""}` : "";
        const projectText = [
          project.code,
          project.name,
          projectDisplay,
          project.parentCode || "",
          project.parentName || "",
          parentDisplay,
          project.platformId,
          platform?.name || "",
          platformDisplay,
        ].join(" ").toLowerCase();
        const matchingDetails = detailsForProject.filter((detail) =>
          `${detail.code} ${detail.detailInfo}`.toLowerCase().includes(text)
        );
        if (!projectText.includes(text) && matchingDetails.length === 0) continue;

        const projectsForPlatform = projectsByPlatformId.get(project.platformId) || [];
        projectsForPlatform.push({
          ...project,
          details: projectText.includes(text) ? detailsForProject : matchingDetails,
        });
        projectsByPlatformId.set(project.platformId, projectsForPlatform);
      }

      return platforms
        .map((platform) => ({
          ...platform,
          projects: projectsByPlatformId.get(platform.platformId) || [],
        }))
        .filter((platform) => platform.projects.length > 0);
    }),

  create: authedQuery
    .input(z.object({ name: z.string().trim().min(1, "名称不能为空").max(200, "名称不能超过200个字符") }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const all = await db
        .select({ platformId: fundraisingPlatforms.platformId })
        .from(fundraisingPlatforms)
        .orderBy(desc(fundraisingPlatforms.platformId));
      const platformId = nextPlatformId(all);

      const result = await db.insert(fundraisingPlatforms).values({
        platformId,
        name: input.name,
      }).$returningId();

      return { id: Number(result[0]?.id), platformId };
    }),

  update: authedQuery
    .input(z.object({
      id: z.number(),
      name: z.string().trim().min(1, "名称不能为空").max(200, "名称不能超过200个字符"),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.update(fundraisingPlatforms).set({
        name: input.name,
        updatedAt: new Date(),
      }).where(eq(fundraisingPlatforms.id, input.id));
      return { success: true };
    }),

  delete: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "recognition_info_delete"))) throw new Error("权限不足");
      const db = getDb();
      await db.delete(fundraisingPlatforms).where(eq(fundraisingPlatforms.id, input.id));
      return { success: true };
    }),

  nextDetailCode: authedQuery.query(async () => {
    const db = getDb();
    return { code: await nextProjectDetailCode(db) };
  }),

  nextPlatformProjectCode: authedQuery.query(async () => {
    const db = getDb();
    return { code: await nextPlatformProjectCode(db) };
  }),

  createPlatformProject: authedQuery
    .input(z.object({
      platformId: z.string().min(1).max(20),
      parentCode: z.string().min(1).max(200),
      code: z.string().min(1).max(50),
      name: z.string().trim().min(1, "平台项目名称不能为空").max(500, "平台项目名称不能超过500个字符"),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const parentCode = normalizeDisplayCode(input.parentCode);
      validatePlatformProjectCode(input.code);

      const [platform] = await db
        .select()
        .from(fundraisingPlatforms)
        .where(eq(fundraisingPlatforms.platformId, input.platformId));
      if (!platform) throw new Error(`公益平台 ${input.platformId} 不存在`);

      const [parent] = await db.select().from(projects).where(eq(projects.code, parentCode));
      if (!parent || parent.level !== 2) throw new Error("请选择有效的NC项目名称");

      const existing = await db.select().from(projects).where(eq(projects.code, input.code));
      if (existing.length > 0) throw new Error(`平台项目编号 ${input.code} 已存在`);

      const result = await db.insert(projects).values({
        code: input.code,
        name: input.name,
        parentCode,
        level: 3,
        platformId: input.platformId,
        sortOrder: 0,
        isActive: 1,
      }).$returningId();
      const id = Number(result[0]?.id);
      if (!id) throw new Error("创建平台项目名称失败");

      await db.insert(projectNameHistories).values({
        projectId: id,
        code: input.code,
        platformId: input.platformId,
        name: input.name,
        effectiveDate: new Date(),
      });

      return { id };
    }),

  updatePlatformProject: authedQuery
    .input(z.object({
      id: z.number(),
      name: z.string().trim().min(1, "平台项目名称不能为空").max(500, "平台项目名称不能超过500个字符"),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [project] = await db.select().from(projects).where(eq(projects.id, input.id));
      if (!project || project.level !== 3) throw new Error("平台项目名称不存在");

      await db.update(projects).set({
        name: input.name,
        updatedAt: new Date(),
      }).where(eq(projects.id, input.id));

      await db.insert(projectNameHistories).values({
        projectId: project.id,
        code: project.code,
        platformId: project.platformId,
        name: input.name,
        effectiveDate: new Date(),
      });

      return { success: true };
    }),

  deletePlatformProject: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (!(await userHasPermission(ctx.user, "recognition_info_delete"))) throw new Error("权限不足");
      const db = getDb();
      const [project] = await db.select().from(projects).where(eq(projects.id, input.id));
      if (!project || project.level !== 3) throw new Error("平台项目名称不存在");
      const [detailResult] = await db
        .select({ count: count() })
        .from(projectDetails)
        .where(eq(projectDetails.projectId, input.id));
      if (Number(detailResult?.count || 0) > 0) {
        throw new Error("该平台项目名称下已有项目详情，不能删除");
      }

      await db.delete(projectNameHistories).where(eq(projectNameHistories.projectId, input.id));
      await db.delete(projects).where(eq(projects.id, input.id));
      return { success: true };
    }),

  createProjectDetail: authedQuery
    .input(z.object({
      projectId: z.number(),
      code: z.string().trim().min(1, "编号不能为空").max(20, "编号不能超过20个字符"),
      detailInfo: z.string().trim().min(1, "详情信息不能为空").max(500, "详情信息不能超过500个字符"),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const [project] = await db.select().from(projects).where(eq(projects.id, input.projectId));
      if (!project || project.level !== 3) throw new Error("平台项目名称不存在");

      await db.insert(projectDetails).values({
        projectId: input.projectId,
        code: input.code,
        detailInfo: input.detailInfo,
        sortOrder: 0,
      });
      return { success: true };
    }),
});
