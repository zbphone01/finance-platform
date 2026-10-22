import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { NCProjectSelect } from "@/components/TreeSelects";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Landmark,
  Layers,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";

interface PlatformProject {
  id: number;
  code: string;
  name: string;
  parentCode: string | null;
  parentName?: string | null;
  platformId: string | null;
  details: ProjectDetail[];
}

interface ProjectDetail {
  id: number;
  projectId: number;
  code: string;
  detailInfo: string;
}

interface PlatformNode {
  id: number;
  platformId: string;
  name: string;
  projects: PlatformProject[];
}

export default function FundraisingPlatformPage() {
  const { hasPermission } = usePermissions();
  const canDeleteRecognitionInfo = hasPermission("recognition_info_delete");
  const [expandedPlatforms, setExpandedPlatforms] = useState<Set<string>>(new Set());
  const [expandedProjects, setExpandedProjects] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");

  const [platformDialogOpen, setPlatformDialogOpen] = useState(false);
  const [editPlatform, setEditPlatform] = useState<PlatformNode | null>(null);
  const [platformName, setPlatformName] = useState("");

  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectPlatform, setProjectPlatform] = useState<PlatformNode | null>(null);
  const [editProject, setEditProject] = useState<PlatformProject | null>(null);
  const [projectParent, setProjectParent] = useState("");
  const [projectCode, setProjectCode] = useState("");
  const [projectName, setProjectName] = useState("");
  const [duplicateProjectMessage, setDuplicateProjectMessage] = useState("");

  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [detailProject, setDetailProject] = useState<PlatformProject | null>(null);
  const [detailCode, setDetailCode] = useState("");
  const [detailInfo, setDetailInfo] = useState("");
  const [projectsByPlatformId, setProjectsByPlatformId] = useState<Record<string, PlatformProject[]>>({});
  const [loadedPlatformIds, setLoadedPlatformIds] = useState<Set<string>>(new Set());
  const [loadingPlatformIds, setLoadingPlatformIds] = useState<Set<string>>(new Set());
  const [loadedProjectIds, setLoadedProjectIds] = useState<Set<number>>(new Set());
  const [loadingProjectIds, setLoadingProjectIds] = useState<Set<number>>(new Set());

  const utils = trpc.useUtils();
  const listQuery = trpc.fundraisingPlatform.list.useQuery();
  const projectTreeQuery = trpc.project.tree.useQuery(undefined, {
    enabled: projectDialogOpen && !editProject,
  });
  const nextDetailCodeQuery = trpc.fundraisingPlatform.nextDetailCode.useQuery(undefined, {
    enabled: detailDialogOpen,
  });
  const nextPlatformProjectCodeQuery = trpc.fundraisingPlatform.nextPlatformProjectCode.useQuery(undefined, {
    enabled: projectDialogOpen && !editProject,
    staleTime: 0,
  });
  const deferredSearch = useDeferredValue(search);
  const isSearching = search.trim().length > 0;
  const searchQuery = trpc.fundraisingPlatform.search.useQuery(
    { keyword: deferredSearch.trim() },
    { enabled: deferredSearch.trim().length > 0 },
  );

  const resetLazyPlatformTree = () => {
    setProjectsByPlatformId({});
    setLoadedPlatformIds(new Set());
    setLoadingPlatformIds(new Set());
    setLoadedProjectIds(new Set());
    setLoadingProjectIds(new Set());
  };

  const refreshPlatformTrees = async () => {
    resetLazyPlatformTree();
    await Promise.all([
      utils.fundraisingPlatform.list.invalidate(),
      utils.fundraisingPlatform.search.invalidate(),
      utils.fundraisingPlatform.tree.invalidate(),
      utils.fundraisingPlatform.platformProjects.invalidate(),
      utils.fundraisingPlatform.projectDetails.invalidate(),
    ]);
  };

  const reloadPlatformProjects = async (platformId: string) => {
    if (!platformId) return;
    setLoadingPlatformIds((prev) => new Set(prev).add(platformId));
    try {
      await utils.fundraisingPlatform.platformProjects.invalidate({ platformId });
      const projects = await utils.fundraisingPlatform.platformProjects.fetch({ platformId });
      setProjectsByPlatformId((prev) => ({ ...prev, [platformId]: projects as PlatformProject[] }));
      setLoadedPlatformIds((prev) => new Set(prev).add(platformId));
    } catch (err: any) {
      toast.error(err.message || "刷新平台项目名称失败");
    } finally {
      setLoadingPlatformIds((prev) => {
        const next = new Set(prev);
        next.delete(platformId);
        return next;
      });
    }
  };

  const reloadProjectDetails = async (project: PlatformProject) => {
    if (!project.platformId) return;
    setLoadingProjectIds((prev) => new Set(prev).add(project.id));
    try {
      await utils.fundraisingPlatform.projectDetails.invalidate({ projectId: project.id });
      const details = await utils.fundraisingPlatform.projectDetails.fetch({ projectId: project.id });
      setProjectsByPlatformId((prev) => ({
        ...prev,
        [project.platformId!]: (prev[project.platformId!] || []).map((item) =>
          item.id === project.id ? { ...item, details: details as ProjectDetail[] } : item
        ),
      }));
      setLoadedProjectIds((prev) => new Set(prev).add(project.id));
    } catch (err: any) {
      toast.error(err.message || "刷新项目详情失败");
    } finally {
      setLoadingProjectIds((prev) => {
        const next = new Set(prev);
        next.delete(project.id);
        return next;
      });
    }
  };

  const createPlatform = trpc.fundraisingPlatform.create.useMutation({
    onSuccess: async (result) => {
      await refreshPlatformTrees();
      toast.success(`创建成功：${result.platformId}`);
      closePlatformDialog();
    },
    onError: (err: any) => toast.error(err.message || "创建失败"),
  });
  const updatePlatform = trpc.fundraisingPlatform.update.useMutation({
    onSuccess: async () => {
      await refreshPlatformTrees();
      toast.success("更新成功");
      closePlatformDialog();
    },
    onError: (err: any) => toast.error(err.message || "更新失败"),
  });
  const deletePlatform = trpc.fundraisingPlatform.delete.useMutation({
    onSuccess: async () => {
      await refreshPlatformTrees();
      toast.success("删除成功");
    },
    onError: (err: any) => toast.error(err.message || "删除失败"),
  });
  const createPlatformProject = trpc.fundraisingPlatform.createPlatformProject.useMutation({
    onSuccess: async (_result, input) => {
      closeProjectDialog();
      await refreshPlatformTrees();
      await utils.project.tree.invalidate();
      await reloadPlatformProjects(input.platformId);
      toast.success("平台项目名称创建成功");
    },
    onError: (err: any) => toast.error(err.message || "创建失败"),
  });
  const updatePlatformProject = trpc.fundraisingPlatform.updatePlatformProject.useMutation({
    onSuccess: async () => {
      const platformId = projectPlatform?.platformId || editProject?.platformId || "";
      closeProjectDialog();
      await refreshPlatformTrees();
      await utils.project.tree.invalidate();
      if (platformId) await reloadPlatformProjects(platformId);
      toast.success("平台项目名称更新成功");
    },
    onError: (err: any) => toast.error(err.message || "更新失败"),
  });
  const deletePlatformProject = trpc.fundraisingPlatform.deletePlatformProject.useMutation({
    onSuccess: async (_result, input) => {
      const platformId = Object.entries(projectsByPlatformId).find(([, projects]) =>
        projects.some((project) => project.id === input.id)
      )?.[0];
      await refreshPlatformTrees();
      await utils.project.tree.invalidate();
      if (platformId) await reloadPlatformProjects(platformId);
      toast.success("平台项目名称删除成功");
    },
    onError: (err: any) => toast.error(err.message || "删除失败"),
  });
  const createProjectDetail = trpc.fundraisingPlatform.createProjectDetail.useMutation({
    onSuccess: async () => {
      const project = detailProject;
      closeDetailDialog();
      await refreshPlatformTrees();
      await utils.fundraisingPlatform.nextDetailCode.invalidate();
      if (project) {
        await reloadPlatformProjects(project.platformId || "");
        await reloadProjectDetails(project);
      }
      toast.success("项目详情创建成功");
    },
    onError: (err: any) => toast.error(err.message || "创建失败"),
  });

  useEffect(() => {
    if (detailDialogOpen && !detailCode && nextDetailCodeQuery.data?.code) {
      setDetailCode(nextDetailCodeQuery.data.code);
    }
  }, [detailDialogOpen, detailCode, nextDetailCodeQuery.data?.code]);

  useEffect(() => {
    if (projectDialogOpen && !editProject && nextPlatformProjectCodeQuery.data?.code) {
      setProjectCode(nextPlatformProjectCodeQuery.data.code);
    }
  }, [editProject, nextPlatformProjectCodeQuery.data?.code, projectDialogOpen]);

  const platforms = useMemo(
    () => (listQuery.data || []).map((platform) => ({
      ...platform,
      projects: projectsByPlatformId[platform.platformId] || [],
    })) as PlatformNode[],
    [listQuery.data, projectsByPlatformId],
  );
  const filteredPlatforms = isSearching ? searchQuery.data || [] : platforms;
  const platformCount = listQuery.data?.length || platforms.length;

  const ensurePlatformProjects = async (platform: PlatformNode) => {
    if (loadedPlatformIds.has(platform.platformId)) {
      return projectsByPlatformId[platform.platformId] || platform.projects;
    }
    if (loadingPlatformIds.has(platform.platformId)) return platform.projects;
    setLoadingPlatformIds((prev) => new Set(prev).add(platform.platformId));
    try {
      const projects = await utils.fundraisingPlatform.platformProjects.fetch({ platformId: platform.platformId });
      const nextProjects = projects as PlatformProject[];
      setProjectsByPlatformId((prev) => ({ ...prev, [platform.platformId]: nextProjects }));
      setLoadedPlatformIds((prev) => new Set(prev).add(platform.platformId));
      return nextProjects;
    } catch (err: any) {
      toast.error(err.message || "加载平台项目名称失败");
      return platform.projects;
    } finally {
      setLoadingPlatformIds((prev) => {
        const next = new Set(prev);
        next.delete(platform.platformId);
        return next;
      });
    }
  };

  const togglePlatform = async (platform: PlatformNode) => {
    const isExpanded = expandedPlatforms.has(platform.platformId);
    setExpandedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(platform.platformId)) next.delete(platform.platformId);
      else next.add(platform.platformId);
      return next;
    });
    if (!isExpanded && !isSearching) await ensurePlatformProjects(platform);
  };

  const toggleProject = async (project: PlatformProject) => {
    const isExpanded = expandedProjects.has(project.id);
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(project.id)) next.delete(project.id);
      else next.add(project.id);
      return next;
    });
    if (isExpanded || isSearching || loadedProjectIds.has(project.id) || loadingProjectIds.has(project.id)) return;
    if (!project.platformId) return;

    setLoadingProjectIds((prev) => new Set(prev).add(project.id));
    try {
      const details = await utils.fundraisingPlatform.projectDetails.fetch({ projectId: project.id });
      setProjectsByPlatformId((prev) => ({
        ...prev,
        [project.platformId!]: (prev[project.platformId!] || []).map((item) =>
          item.id === project.id ? { ...item, details: details as ProjectDetail[] } : item
        ),
      }));
      setLoadedProjectIds((prev) => new Set(prev).add(project.id));
    } catch (err: any) {
      toast.error(err.message || "加载项目详情失败");
    } finally {
      setLoadingProjectIds((prev) => {
        const next = new Set(prev);
        next.delete(project.id);
        return next;
      });
    }
  };

  const openCreatePlatform = () => {
    setEditPlatform(null);
    setPlatformName("");
    setPlatformDialogOpen(true);
  };

  const openEditPlatform = (platform: PlatformNode) => {
    setEditPlatform(platform);
    setPlatformName(platform.name);
    setPlatformDialogOpen(true);
  };

  const closePlatformDialog = () => {
    setPlatformDialogOpen(false);
    setEditPlatform(null);
    setPlatformName("");
  };

  const savePlatform = () => {
    const name = platformName.trim();
    if (!name) return toast.error("请输入公益平台名称");
    if (editPlatform) updatePlatform.mutate({ id: editPlatform.id, name });
    else createPlatform.mutate({ name });
  };

  const openCreateProject = async (platform: PlatformNode) => {
    const projects = await ensurePlatformProjects(platform);
    await utils.fundraisingPlatform.nextPlatformProjectCode.invalidate();
    setProjectPlatform({ ...platform, projects });
    setEditProject(null);
    setProjectParent("");
    setProjectCode("");
    setProjectName("");
    setProjectDialogOpen(true);
  };

  const openEditProject = (project: PlatformProject, platform: PlatformNode) => {
    setProjectPlatform(platform);
    setEditProject(project);
    setProjectParent(project.parentCode || "");
    setProjectCode(project.code);
    setProjectName(project.name);
    setProjectDialogOpen(true);
  };

  const closeProjectDialog = () => {
    setProjectDialogOpen(false);
    setProjectPlatform(null);
    setEditProject(null);
    setProjectParent("");
    setProjectCode("");
    setProjectName("");
  };

  const saveProject = () => {
    const name = projectName.trim();
    if (!projectPlatform) return toast.error("请选择公益平台");
    if (!name) return toast.error("请输入平台项目名称");
    if (editProject) {
      updatePlatformProject.mutate({ id: editProject.id, name });
      return;
    }

    const code = projectCode.trim();
    if (!projectParent) return toast.error("请选择NC项目名称");
    if (!/^PP\d{7}$/i.test(code)) return toast.error("平台项目编号必须以 PP 开头加7位数字，如 PP0000001");
    const parentCode = projectParent.split("_")[0]?.trim();
    const existingProject = (projectPlatform.projects || []).find(
      (project) => project.parentCode === parentCode && project.name.trim() === name
    );
    if (existingProject) {
      setDuplicateProjectMessage(`本平台已建该平台项目：${existingProject.code}_${existingProject.name}`);
      return;
    }
    createPlatformProject.mutate({
      platformId: projectPlatform.platformId,
      parentCode: projectParent,
      code,
      name,
    });
  };

  const openCreateDetail = (project: PlatformProject) => {
    setDetailProject(project);
    setDetailCode(nextDetailCodeQuery.data?.code || "");
    setDetailInfo("");
    setDetailDialogOpen(true);
  };

  const closeDetailDialog = () => {
    setDetailDialogOpen(false);
    setDetailProject(null);
    setDetailCode("");
    setDetailInfo("");
  };

  const saveDetail = () => {
    if (!detailProject) return toast.error("请选择平台项目名称");
    const code = detailCode.trim();
    const info = detailInfo.trim();
    if (!code) return toast.error("请输入编号");
    if (!info) return toast.error("请输入详情信息");
    createProjectDetail.mutate({
      projectId: detailProject.id,
      code,
      detailInfo: info,
    });
  };

  const deletePlatformItem = (platform: PlatformNode) => {
    if (confirm(`确定删除 [${platform.platformId}] ${platform.name}？`)) {
      deletePlatform.mutate({ id: platform.id });
    }
  };

  const deleteProjectItem = (project: PlatformProject) => {
    if ((project.details || []).length > 0) {
      toast.error("该平台项目名称下已有项目详情，不能删除");
      return;
    }
    if (confirm(`确定删除 [${project.code}] ${project.name}？此操作会同步从项目菜单删除该平台项目名称。`)) {
      deletePlatformProject.mutate({ id: project.id });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">公益平台</h1>
        <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={openCreatePlatform}>
          <Plus className="h-4 w-4 mr-1" />
          新增公益平台
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="sticky top-0 z-20 flex flex-col gap-3 border-b bg-white p-4 pb-3 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-gray-500">
              共 {platformCount} 个公益平台
            </div>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索平台项目名称或项目详情"
              className="h-9 md:w-96"
            />
          </div>

          {listQuery.isLoading || (isSearching && searchQuery.isLoading) ? (
            <div className="text-center py-8 text-gray-400">加载中...</div>
          ) : filteredPlatforms.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Landmark className="h-10 w-10 mx-auto mb-2 text-gray-300" />
              <p>{isSearching ? "未找到匹配内容" : "暂无公益平台数据"}</p>
            </div>
          ) : (
            <div>
              {filteredPlatforms.map((platform) => {
                const platformOpen = isSearching || expandedPlatforms.has(platform.platformId);
                return (
                  <div key={platform.id}>
                    <div className="flex items-center justify-between py-2.5 px-4 hover:bg-gray-50 border-b border-gray-100">
                      <div className="flex items-center gap-2 min-w-0">
                        <button className="w-5 h-5 flex items-center justify-center text-gray-400" onClick={() => togglePlatform(platform)}>
                          {platformOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                        <Landmark className="h-4 w-4 text-blue-600" />
                        <Badge variant="secondary" className="font-mono">{platform.platformId}</Badge>
                        <span className="font-medium truncate">{platform.name}</span>
                        <span className="text-xs text-gray-400">公益平台</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-green-600 text-xs" onClick={() => openCreateProject(platform)}>
                          <Plus className="h-3.5 w-3.5 mr-0.5" />
                          添加平台项目名称
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEditPlatform(platform)}>
                          <Pencil className="h-3.5 w-3.5 text-blue-600" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => deletePlatformItem(platform)}
                          disabled={!canDeleteRecognitionInfo}
                          title={canDeleteRecognitionInfo ? "删除" : "无删除权限"}
                        >
                          <Trash2 className={`h-3.5 w-3.5 ${canDeleteRecognitionInfo ? "text-red-500" : "text-gray-300"}`} />
                        </Button>
                      </div>
                    </div>

                    {platformOpen && (
                      <div>
                        {loadingPlatformIds.has(platform.platformId) ? (
                          <div className="py-3 pl-14 pr-4 text-sm text-gray-400 border-b border-gray-100">加载中...</div>
                        ) : platform.projects.length === 0 ? (
                          <div className="py-3 pl-14 pr-4 text-sm text-gray-400 border-b border-gray-100">暂无平台项目名称</div>
                        ) : (
                          platform.projects.map((project, projectIndex) => {
                            const projectOpen = isSearching || expandedProjects.has(project.id);
                            const isLastProject = projectIndex === platform.projects.length - 1;
                            return (
                              <div key={project.id}>
                                <div className="flex items-center justify-between py-2 px-4 pl-12 hover:bg-gray-50 border-b border-gray-100">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <button className="w-5 h-5 flex items-center justify-center text-gray-400" onClick={() => toggleProject(project)}>
                                      {projectOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                    </button>
                                    <Layers className="h-4 w-4 text-indigo-600" />
                                    <span className="font-mono text-xs text-gray-500">{project.code}</span>
                                    <span className="font-medium truncate">{project.name}</span>
                                    {project.parentCode && (
                                      <span className="text-xs px-1.5 py-0.5 rounded bg-orange-50 text-orange-700 shrink-0">
                                        {project.parentCode}_{project.parentName || "NC项目名称"}
                                      </span>
                                    )}
                                    <span className="text-xs text-gray-400">平台项目名称</span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <Button size="sm" variant="ghost" className="h-7 px-2 text-green-600 text-xs" onClick={() => openCreateDetail(project)}>
                                      <Plus className="h-3.5 w-3.5 mr-0.5" />
                                      添加项目详情
                                    </Button>
                                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEditProject(project, platform)}>
                                      <Pencil className="h-3.5 w-3.5 text-blue-600" />
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0"
                                      onClick={() => deleteProjectItem(project)}
                                      disabled={!canDeleteRecognitionInfo}
                                      title={canDeleteRecognitionInfo ? "删除" : "无删除权限"}
                                    >
                                      <Trash2 className={`h-3.5 w-3.5 ${canDeleteRecognitionInfo ? "text-red-500" : "text-gray-300"}`} />
                                    </Button>
                                  </div>
                                </div>
                                {projectOpen && (
                                  <div>
                                    {loadingProjectIds.has(project.id) ? (
                                      <div className="py-2 pl-24 pr-4 text-sm text-gray-400 border-b border-gray-100">加载中...</div>
                                    ) : project.details.length === 0 ? (
                                      <div className="py-2 pl-24 pr-4 text-sm text-gray-400 border-b border-gray-100">暂无项目详情</div>
                                    ) : (
                                      project.details.map((detail) => (
                                        <div key={detail.id} className="flex items-center gap-2 py-2 pl-24 pr-4 border-b border-gray-100">
                                          <FileText className="h-4 w-4 text-gray-500" />
                                          <span className="font-mono text-xs text-gray-500">{detail.code}</span>
                                          <span className="truncate text-sm text-gray-800">{detail.detailInfo}</span>
                                          <span className="text-xs text-gray-400">项目详情</span>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                )}
                                {isLastProject && (
                                  <div className="border-b border-gray-100 py-1.5 pl-12 pr-4">
                                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-green-600" onClick={() => openCreateProject(platform)}>
                                      <Plus className="mr-0.5 h-3.5 w-3.5" />
                                      添加平台项目名称
                                    </Button>
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={platformDialogOpen} onOpenChange={(open) => (open ? setPlatformDialogOpen(true) : closePlatformDialog())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editPlatform ? "编辑公益平台" : "新增公益平台"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {editPlatform && (
              <div className="space-y-2">
                <Label className="text-sm font-medium text-gray-700">ID</Label>
                <Input value={editPlatform.platformId} disabled className="bg-gray-100 font-mono" />
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">名称 <span className="text-red-500">*</span></Label>
              <Input value={platformName} onChange={(e) => setPlatformName(e.target.value)} placeholder="请输入公益平台名称" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={closePlatformDialog}>取消</Button>
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={savePlatform} disabled={createPlatform.isPending || updatePlatform.isPending}>
              {createPlatform.isPending || updatePlatform.isPending ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={projectDialogOpen} onOpenChange={(open) => (open ? setProjectDialogOpen(true) : closeProjectDialog())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editProject ? "编辑平台项目名称" : "新增平台项目名称"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">公益平台</Label>
              <Input value={projectPlatform ? `${projectPlatform.platformId}_${projectPlatform.name}` : ""} disabled className="bg-gray-100" />
            </div>
            {editProject ? (
              <>
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-gray-700">NC项目名称</Label>
                  <Input
                    value={editProject.parentCode ? `${editProject.parentCode}_${editProject.parentName || ""}` : ""}
                    disabled
                    className="bg-gray-100"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-gray-700">编号</Label>
                  <Input value={editProject.code} disabled className="bg-gray-100 font-mono" />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-gray-700">NC项目名称 <span className="text-red-500">*</span></Label>
                  <NCProjectSelect value={projectParent} tree={projectTreeQuery.data || []} onChange={setProjectParent} placeholder="请选择NC项目名称" disabled={projectTreeQuery.isLoading} />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-gray-700">编号 <span className="text-red-500">*</span></Label>
                  <Input value={projectCode} onChange={(e) => setProjectCode(e.target.value)} className="font-mono" placeholder="如 PP0000001" />
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">平台项目名称 <span className="text-red-500">*</span></Label>
              <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="请输入平台项目名称" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={closeProjectDialog}>取消</Button>
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={saveProject} disabled={createPlatformProject.isPending || updatePlatformProject.isPending}>
              {createPlatformProject.isPending || updatePlatformProject.isPending ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(duplicateProjectMessage)} onOpenChange={(open) => !open && setDuplicateProjectMessage("")}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>平台项目已存在</AlertDialogTitle>
            <AlertDialogDescription>{duplicateProjectMessage || "本平台已建该平台项目"}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setDuplicateProjectMessage("")}>关闭</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={detailDialogOpen} onOpenChange={(open) => (open ? setDetailDialogOpen(true) : closeDetailDialog())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>新增项目详情</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">平台项目名称</Label>
              <Input value={detailProject ? `${detailProject.code}_${detailProject.name}` : ""} disabled className="bg-gray-100" />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">编号 <span className="text-red-500">*</span></Label>
              <Input value={detailCode} onChange={(e) => setDetailCode(e.target.value)} className="font-mono" placeholder="如 26051401" />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">详情信息 <span className="text-red-500">*</span></Label>
              <Input value={detailInfo} onChange={(e) => setDetailInfo(e.target.value)} placeholder="请输入详情信息" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={closeDetailDialog}>取消</Button>
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={saveDetail} disabled={createProjectDetail.isPending}>
              {createProjectDetail.isPending ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
