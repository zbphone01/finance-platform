import { useDeferredValue, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { DeptTreeMultiSelect, DeptTreeSelect, NCProjectSelect } from "@/components/TreeSelects";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, FileText, FolderOpen, History, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";

interface BudgetNode {
  id: number;
  code: string | null;
  name: string;
  incomeProject: string | null;
  associatedIncomeProjects?: string[] | null;
  associatedDepartments?: string[] | null;
  platformId: string | null;
  parentId: number | null;
  level: number;
  isLeaf: number;
  sortOrder: number;
  children: BudgetNode[];
}

type DialogMode = "department" | "nc" | "channel";

const levelLabels: Record<number, string> = {
  1: "部门",
  2: "NC项目",
  3: "渠道",
};

function segmentFromCode(code: string | null, level: number) {
  const parts = (code || "").split(".");
  return parts[level - 1] || (level === 3 ? "" : code || "");
}

function normalizeProjectValue(value: string) {
  return value.trim();
}

function normalizeDepartmentValue(value: string) {
  const trimmed = value.trim();
  const parts = trimmed.split("_");
  return parts.length > 1 ? parts.slice(1).join("_") : trimmed;
}

function attachBudgetChildren(nodes: BudgetNode[], childrenByParentId: Record<number, BudgetNode[]>): BudgetNode[] {
  return nodes.map((node) => ({
    ...node,
    children: attachBudgetChildren(childrenByParentId[node.id] || node.children || [], childrenByParentId),
  }));
}

function BudgetRow({
  node,
  depth = 0,
  expanded,
  toggle,
  onAdd,
  onEdit,
  onHistory,
  onDelete,
  forceExpanded = false,
  canDelete,
}: {
  node: BudgetNode;
  depth?: number;
  expanded: Set<number>;
  toggle: (id: number) => void;
  onAdd: (node: BudgetNode) => void;
  onEdit: (node: BudgetNode) => void;
  onHistory: (node: BudgetNode) => void;
  onDelete: (node: BudgetNode) => void;
  forceExpanded?: boolean;
  canDelete: boolean;
}) {
  const hasChildren = !node.isLeaf;
  const isExpanded = forceExpanded || expanded.has(node.id);
  const isChannel = node.level === 3;
  const hasInheritedChannel = node.level === 2 && (node.children || []).some((child) => child.level === 3 && child.isLeaf && child.code === node.code);
  const indent = depth * 22;
  const Icon = isChannel ? FileText : FolderOpen;
  const display = isChannel ? `${node.code}-${node.name}` : `${node.code}_${node.name}`;

  return (
    <div>
      <div
        className="flex items-center justify-between py-2 px-3 hover:bg-gray-50 border-b border-gray-100"
        style={{ paddingLeft: `${10 + indent}px` }}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {hasChildren ? (
            <button
              className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600"
              onClick={() => toggle(node.id)}
            >
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : (
            <span className="w-5" />
          )}
          <Icon className={`h-4 w-4 flex-shrink-0 ${isChannel ? "text-orange-500" : "text-blue-600"}`} />
          <span className="font-mono text-xs text-gray-500 flex-shrink-0">{node.code}</span>
          <span className="font-medium truncate text-gray-800">{node.name}</span>
          <span className="text-xs text-gray-400 ml-1">{levelLabels[node.level]}</span>
          {node.level === 2 && Boolean(node.associatedIncomeProjects?.length) && (
            <span className="text-xs text-blue-600 truncate">
              关联 {node.associatedIncomeProjects?.length} 个NC项目
            </span>
          )}
          {node.level === 1 && Boolean(node.associatedDepartments?.length) && (
            <span className="text-xs text-blue-600 truncate">
              关联 {node.associatedDepartments?.length} 个部门
            </span>
          )}
          {isChannel && <span className="text-xs text-gray-400 truncate">{display}</span>}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {node.level < 3 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-blue-600 text-xs"
              onClick={() => onAdd(node)}
              disabled={hasInheritedChannel}
              title={hasInheritedChannel ? "该NC项目已存在继承编号的渠道，不能再添加渠道" : undefined}
            >
              <Plus className="h-3.5 w-3.5 mr-0.5" />
              {node.level === 1 ? "添加NC项目" : "添加渠道"}
            </Button>
          )}
          {isChannel && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-gray-600 text-xs" onClick={() => onHistory(node)}>
              <History className="h-3.5 w-3.5 mr-0.5" />
              历史
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => onEdit(node)}>
            <Pencil className="h-3.5 w-3.5 text-blue-600" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0"
            onClick={() => onDelete(node)}
            disabled={!canDelete}
            title={canDelete ? "删除" : "无删除权限"}
          >
            <Trash2 className={`h-3.5 w-3.5 ${canDelete ? "text-red-500" : "text-gray-300"}`} />
          </Button>
        </div>
      </div>
      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <BudgetRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              toggle={toggle}
              onAdd={onAdd}
              onEdit={onEdit}
              onHistory={onHistory}
              onDelete={onDelete}
              forceExpanded={forceExpanded}
              canDelete={canDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function BudgetCodePage() {
  const { hasPermission } = usePermissions();
  const canDeleteRecognitionInfo = hasPermission("recognition_info_delete");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>("department");
  const [editNode, setEditNode] = useState<BudgetNode | null>(null);
  const [parentNode, setParentNode] = useState<BudgetNode | null>(null);
  const [segment, setSegment] = useState("");
  const [name, setName] = useState("");
  const [selectedDept, setSelectedDept] = useState("");
  const [associatedDepartments, setAssociatedDepartments] = useState<string[]>([]);
  const [selectedNc, setSelectedNc] = useState("");
  const [selectedAssociatedNc, setSelectedAssociatedNc] = useState("");
  const [associatedNcProjects, setAssociatedNcProjects] = useState<string[]>([]);
  const [selectedPlatformId, setSelectedPlatformId] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyNode, setHistoryNode] = useState<BudgetNode | null>(null);
  const [childrenByParentId, setChildrenByParentId] = useState<Record<number, BudgetNode[]>>({});
  const [loadedParentIds, setLoadedParentIds] = useState<Set<number>>(new Set());
  const [loadingParentIds, setLoadingParentIds] = useState<Set<number>>(new Set());

  const utils = trpc.useUtils();
  const rootsQuery = trpc.budgetCode.roots.useQuery();
  const deptTreeQuery = trpc.department.tree.useQuery(undefined, {
    enabled: dialogOpen && dialogMode === "department",
  });
  const projectTreeQuery = trpc.project.tree.useQuery(undefined, {
    enabled: dialogOpen && dialogMode === "nc",
  });
  const platformsQuery = trpc.fundraisingPlatform.list.useQuery(undefined, {
    enabled: (dialogOpen && dialogMode === "channel") || historyOpen,
  });
  const deferredSearch = useDeferredValue(search);
  const isSearching = search.trim().length > 0;
  const searchQuery = trpc.budgetCode.search.useQuery(
    { keyword: deferredSearch.trim() },
    { enabled: deferredSearch.trim().length > 0 },
  );
  const historyQuery = trpc.budgetCode.histories.useQuery(
    { budgetCodeId: historyNode?.id || 0 },
    { enabled: historyOpen && !!historyNode },
  );

  const resetLazyTree = () => {
    setChildrenByParentId({});
    setLoadedParentIds(new Set());
    setLoadingParentIds(new Set());
  };

  const reloadBudgetChildren = async (parentIds: Set<number>) => {
    if (parentIds.size === 0) return;
    setLoadingParentIds((prev) => new Set([...prev, ...parentIds]));
    const entries = await Promise.all(
      Array.from(parentIds).map(async (parentId) => {
        const children = await utils.budgetCode.children.fetch({ parentId });
        return [parentId, children as BudgetNode[]] as const;
      }),
    );
    setChildrenByParentId((prev) => {
      const next = { ...prev };
      for (const [parentId, children] of entries) next[parentId] = children;
      return next;
    });
    setLoadedParentIds((prev) => new Set([...prev, ...parentIds]));
    setLoadingParentIds((prev) => {
      const next = new Set(prev);
      for (const parentId of parentIds) next.delete(parentId);
      return next;
    });
  };

  const refreshBudgetTrees = async (parentIdsToReload = expanded) => {
    resetLazyTree();
    await Promise.all([
      utils.budgetCode.roots.invalidate(),
      utils.budgetCode.search.invalidate(),
      utils.budgetCode.tree.invalidate(),
      utils.budgetCode.children.invalidate(),
    ]);
    await reloadBudgetChildren(parentIdsToReload);
  };

  const createCategory = trpc.budgetCode.createCategory.useMutation({
    onSuccess: async (_result, input) => {
      const parentIdsToReload = new Set(expanded);
      if (input.parentId) parentIdsToReload.add(input.parentId);
      closeDialog();
      await refreshBudgetTrees(parentIdsToReload);
      toast.success("创建成功");
    },
    onError: (err: any) => toast.error(err.message || "创建失败"),
  });
  const createChannel = trpc.budgetCode.createLeaf.useMutation({
    onSuccess: async (_result, input) => {
      const parentIdsToReload = new Set(expanded).add(input.parentId);
      closeDialog();
      await refreshBudgetTrees(parentIdsToReload);
      toast.success("渠道创建成功");
    },
    onError: (err: any) => toast.error(err.message || "创建失败"),
  });
  const updateCategory = trpc.budgetCode.updateCategory.useMutation({
    onSuccess: async () => {
      const parentIdsToReload = new Set(expanded);
      if (editNode?.parentId) parentIdsToReload.add(editNode.parentId);
      if (editNode) parentIdsToReload.add(editNode.id);
      closeDialog();
      await refreshBudgetTrees(parentIdsToReload);
      toast.success("更新成功");
    },
    onError: (err: any) => toast.error(err.message || "更新失败"),
  });
  const updateChannel = trpc.budgetCode.updateLeaf.useMutation({
    onSuccess: async () => {
      const parentIdsToReload = new Set(expanded);
      if (editNode?.parentId) parentIdsToReload.add(editNode.parentId);
      closeDialog();
      await refreshBudgetTrees(parentIdsToReload);
      await utils.budgetCode.histories.invalidate();
      toast.success("渠道更新成功");
    },
    onError: (err: any) => toast.error(err.message || "更新失败"),
  });
  const deleteMutation = trpc.budgetCode.delete.useMutation({
    onSuccess: async (_result, input) => {
      const parentIdsToReload = new Set(expanded);
      const deletedNode = Object.values(childrenByParentId).flat().find((node) => node.id === input.id);
      if (deletedNode?.parentId) parentIdsToReload.add(deletedNode.parentId);
      await refreshBudgetTrees(parentIdsToReload);
      toast.success("删除成功");
    },
    onError: (err: any) => toast.error(err.message || "删除失败"),
  });
  const matchPlatformsMutation = trpc.budgetCode.matchPlatforms.useMutation({
    onSuccess: async (result) => {
      await refreshBudgetTrees();
      await utils.budgetCode.histories.invalidate();
      toast.success(`匹配完成：更新 ${result.matched} 条，未匹配 ${result.skippedUnmatched} 条`);
    },
    onError: (err: any) => toast.error(err.message || "匹配失败"),
  });

  const rootNodes = useMemo(() => rootsQuery.data || [], [rootsQuery.data]);
  const tree = useMemo(() => attachBudgetChildren(rootNodes, childrenByParentId), [childrenByParentId, rootNodes]);
  const platformNameMap = useMemo(
    () => new Map(
      (platformsQuery.data || []).map((platform: any) => [platform.platformId, `${platform.platformId}_${platform.name}`]),
    ),
    [platformsQuery.data],
  );
  const filteredTree = isSearching ? searchQuery.data || [] : tree;

  const resetForm = () => {
    setEditNode(null);
    setParentNode(null);
    setSegment("");
    setName("");
    setSelectedDept("");
    setAssociatedDepartments([]);
    setSelectedNc("");
    setSelectedAssociatedNc("");
    setAssociatedNcProjects([]);
    setSelectedPlatformId("");
  };

  const closeDialog = () => {
    setDialogOpen(false);
    resetForm();
  };

  const openCreateDepartment = () => {
    resetForm();
    setDialogMode("department");
    setDialogOpen(true);
  };

  const openAddChild = async (node: BudgetNode) => {
    if (node.level === 2) {
      try {
        const children = await utils.budgetCode.children.fetch({ parentId: node.id });
        const hasInheritedChannel = (children as BudgetNode[]).some((child) => child.level === 3 && child.isLeaf && child.code === node.code);
        if (hasInheritedChannel) {
          toast.error("该NC项目已存在继承NC项目编号的渠道，不能再添加渠道");
          setChildrenByParentId((prev) => ({ ...prev, [node.id]: children as BudgetNode[] }));
          setLoadedParentIds((prev) => new Set(prev).add(node.id));
          return;
        }
      } catch (err: any) {
        toast.error(err.message || "检查渠道失败");
        return;
      }
    }
    resetForm();
    setParentNode(node);
    setDialogMode(node.level === 1 ? "nc" : "channel");
    setDialogOpen(true);
  };

  const openEdit = (node: BudgetNode) => {
    resetForm();
    setEditNode(node);
    setDialogMode(node.level === 1 ? "department" : node.level === 2 ? "nc" : "channel");
    setSegment(segmentFromCode(node.code, node.level));
    if (node.level === 1 && /^\d{4,6}_.+/.test(node.name)) {
      setSelectedDept(node.name);
      setName("");
    } else {
      setName(node.name);
    }
    setAssociatedDepartments((node.associatedDepartments || []).filter((dept) => dept && dept !== node.name));
    setSelectedNc(node.incomeProject || "");
    setAssociatedNcProjects((node.associatedIncomeProjects || []).filter((project) => project && project !== node.incomeProject));
    setSelectedPlatformId(node.platformId || "");
    setDialogOpen(true);
  };

  const openHistory = (node: BudgetNode) => {
    setHistoryNode(node);
    setHistoryOpen(true);
  };

  const handleDelete = (node: BudgetNode) => {
    if (confirm(`确定删除 [${node.code}] ${node.name}？`)) {
      deleteMutation.mutate({ id: node.id });
    }
  };

  const handleMatchPlatforms = () => {
    if (confirm("将对所有对应公益平台为“不指定”的渠道进行匹配。渠道名称与公益平台名称完全一致时，会自动写入对应公益平台。是否继续？")) {
      matchPlatformsMutation.mutate();
    }
  };

  const handleAddAssociatedNc = () => {
    const nextAssociatedNc = normalizeProjectValue(selectedAssociatedNc);
    const currentNc = normalizeProjectValue(selectedNc);
    if (!nextAssociatedNc) {
      toast.error("请选择要关联的NC项目");
      return;
    }
    if (nextAssociatedNc === currentNc) {
      toast.error("该NC项目已是当前主项目");
      return;
    }
    if (associatedNcProjects.some((project) => normalizeProjectValue(project) === nextAssociatedNc)) {
      toast.error("关联NC项目不能重复，请检查");
      return;
    }
    setAssociatedNcProjects((prev) => [...prev, nextAssociatedNc]);
    setSelectedAssociatedNc("");
  };

  const removeAssociatedNc = (value: string) => {
    setAssociatedNcProjects((prev) => prev.filter((project) => project !== value));
  };

  const removeAssociatedDept = (value: string) => {
    setAssociatedDepartments((prev) => prev.filter((dept) => dept !== value));
  };

  const handleSave = () => {
    const trimmedSegment = segment.trim();
    const trimmedName = name.trim();

    if (dialogMode === "department") {
      if (!trimmedSegment) {
        toast.error("请输入编号");
        return;
      }
      if (!/^\d+$/.test(trimmedSegment)) {
        toast.error("编号必须为数字");
        return;
      }
      const deptName = selectedDept || trimmedName;
      if (!deptName) {
        toast.error("请选择部门或填写自定义部门");
        return;
      }
      if (editNode) {
        updateCategory.mutate({
          id: editNode.id,
          code: trimmedSegment,
          name: deptName,
          associatedDepartments: associatedDepartments.filter(
            (dept) => normalizeDepartmentValue(dept) !== normalizeDepartmentValue(deptName),
          ),
        });
      } else {
        createCategory.mutate({ code: trimmedSegment, name: deptName, parentId: null, level: 1, sortOrder: 0 });
      }
      return;
    }

    if (dialogMode === "nc") {
      if (!trimmedSegment) {
        toast.error("请输入编号");
        return;
      }
      if (!/^\d+$/.test(trimmedSegment)) {
        toast.error("编号必须为数字");
        return;
      }
      const ncName = selectedNc;
      if (!ncName) {
        toast.error("请选择NC项目");
        return;
      }
      const parentId = editNode?.parentId || parentNode?.id;
      if (!parentId) {
        toast.error("缺少上级部门");
        return;
      }
      if (editNode) {
        updateCategory.mutate({
          id: editNode.id,
          code: trimmedSegment,
          name: ncName,
          incomeProject: ncName,
          associatedIncomeProjects: associatedNcProjects.filter((project) => project !== ncName),
        });
      } else {
        createCategory.mutate({ code: trimmedSegment, name: ncName, incomeProject: ncName, parentId, level: 2, sortOrder: 0 });
      }
      return;
    }

    if (trimmedSegment && !/^\d+$/.test(trimmedSegment)) {
      toast.error("编号必须为数字");
      return;
    }
    if (!trimmedName) {
      toast.error("请输入渠道名称");
      return;
    }
    const parentId = editNode?.parentId || parentNode?.id;
    if (!parentId) {
      toast.error("缺少上级NC项目");
      return;
    }
    if (editNode) {
      updateChannel.mutate({ id: editNode.id, code: trimmedSegment, name: trimmedName, platformId: selectedPlatformId || null });
    } else {
      createChannel.mutate({ code: trimmedSegment, name: trimmedName, platformId: selectedPlatformId || null, parentId, sortOrder: 0 });
    }
  };

  const toggle = async (id: number) => {
    if (isSearching) return;
    const isExpanded = expanded.has(id);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (isExpanded || loadedParentIds.has(id) || loadingParentIds.has(id)) return;

    setLoadingParentIds((prev) => new Set(prev).add(id));
    try {
      const children = await utils.budgetCode.children.fetch({ parentId: id });
      setChildrenByParentId((prev) => ({ ...prev, [id]: children as BudgetNode[] }));
      setLoadedParentIds((prev) => new Set(prev).add(id));
    } catch (err: any) {
      toast.error(err.message || "加载下级预算编码失败");
    } finally {
      setLoadingParentIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">预算编码管理</h1>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleMatchPlatforms}
            disabled={matchPlatformsMutation.isPending}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${matchPlatformsMutation.isPending ? "animate-spin" : ""}`} />
            匹配公益平台
          </Button>
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={openCreateDepartment}>
            <Plus className="h-4 w-4 mr-1" />
            新增部门
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="sticky top-0 z-20 flex flex-col gap-3 border-b bg-white p-4 pb-3 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-gray-500">共 {tree.length} 个部门{isSearching ? `，匹配 ${filteredTree.length} 个部门` : ""}</div>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索部门、NC项目、渠道、预算编码或公益平台"
              className="h-9 md:w-96"
            />
          </div>
          {rootsQuery.isLoading || (isSearching && searchQuery.isLoading) ? (
            <div className="text-center py-8 text-gray-400">加载中...</div>
          ) : tree.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <FolderOpen className="h-10 w-10 mx-auto mb-2 text-gray-300" />
              <p>暂无预算编码数据</p>
            </div>
          ) : filteredTree.length === 0 ? (
            <div className="text-center py-10 text-gray-400">未找到匹配预算编码</div>
          ) : (
            <div>
              {filteredTree.map((node: BudgetNode) => (
                <BudgetRow
                  key={node.id}
                  node={node}
                  expanded={expanded}
                  toggle={toggle}
                  onAdd={openAddChild}
                  onEdit={openEdit}
                  onHistory={openHistory}
                  onDelete={handleDelete}
                  forceExpanded={isSearching}
                  canDelete={canDeleteRecognitionInfo}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editNode ? `编辑${levelLabels[editNode.level]}` : `新增${dialogMode === "department" ? "部门" : dialogMode === "nc" ? "NC项目" : "渠道"}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {(parentNode || editNode?.parentId) && (
              <div className="space-y-2">
                <Label className="text-sm font-medium text-gray-700">上级</Label>
                <Input value={parentNode ? `${parentNode.code}_${parentNode.name}` : "保持原上级"} disabled className="bg-gray-100" />
              </div>
            )}

            {dialogMode === "department" && (
              <div className="space-y-2">
                <Label className="text-sm font-medium text-gray-700">选择部门</Label>
                <DeptTreeSelect
                  value={selectedDept}
                  tree={deptTreeQuery.data || []}
                  onChange={(value) => {
                    setSelectedDept(value);
                    setAssociatedDepartments((prev) => prev.filter(
                      (dept) => normalizeDepartmentValue(dept) !== normalizeDepartmentValue(value),
                    ));
                    if (value) setName("");
                  }}
                  placeholder="自定义部门或搜索选择部门"
                  allowCustom
                />
              </div>
            )}

            {dialogMode === "department" && editNode && (
              <div className="space-y-2">
                <Label className="text-sm font-medium text-gray-700">关联部门</Label>
                <DeptTreeMultiSelect
                  values={associatedDepartments}
                  tree={deptTreeQuery.data || []}
                  onChange={setAssociatedDepartments}
                  placeholder="请选择关联部门（可多选）"
                  disabled={deptTreeQuery.isLoading}
                  excludedValues={[selectedDept || name]}
                />
                {associatedDepartments.length > 0 ? (
                  <div className={`space-y-1 rounded-md border border-gray-100 bg-gray-50 p-2 ${associatedDepartments.length > 15 ? "max-h-[342px] overflow-y-auto" : ""}`}>
                    {associatedDepartments.map((dept) => (
                      <div key={dept} className="flex items-center justify-between gap-2 text-xs text-gray-700">
                        <span className="min-w-0 truncate" title={dept}>{dept}</span>
                        <button type="button" className="text-gray-400 hover:text-red-500" onClick={() => removeAssociatedDept(dept)}>
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-gray-400">可在下拉列表中勾选多个关联部门。</div>
                )}
              </div>
            )}

            {dialogMode === "nc" && (
              <div className="space-y-2">
                <Label className="text-sm font-medium text-gray-700">选择NC项目</Label>
                <NCProjectSelect
                  value={selectedNc}
                  tree={projectTreeQuery.data || []}
                  onChange={(value) => {
                    setSelectedNc(value);
                    setAssociatedNcProjects((prev) => prev.filter((project) => project !== value));
                    setName("");
                  }}
                  placeholder="请选择NC项目"
                  disabled={projectTreeQuery.isLoading}
                />
              </div>
            )}

            {dialogMode === "nc" && editNode && (
              <div className="space-y-2">
                <Label className="text-sm font-medium text-gray-700">关联NC项目</Label>
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <NCProjectSelect
                      value={selectedAssociatedNc}
                      tree={projectTreeQuery.data || []}
                      onChange={setSelectedAssociatedNc}
                      placeholder="选择一个NC项目"
                      disabled={projectTreeQuery.isLoading}
                    />
                  </div>
                  <Button type="button" size="sm" variant="outline" className="h-9" onClick={handleAddAssociatedNc}>
                    <Plus className="h-4 w-4 mr-1" />
                    添加
                  </Button>
                </div>
                {associatedNcProjects.length > 0 ? (
                  <div className={`space-y-1 rounded-md border border-gray-100 bg-gray-50 p-2 ${associatedNcProjects.length > 15 ? "max-h-[342px] overflow-y-auto" : ""}`}>
                    {associatedNcProjects.map((project) => (
                      <div key={project} className="flex items-center justify-between gap-2 text-xs text-gray-700">
                        <span className="min-w-0 truncate" title={project}>{project}</span>
                        <button type="button" className="text-gray-400 hover:text-red-500" onClick={() => removeAssociatedNc(project)}>
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-gray-400">仅编辑已有NC项目时可添加关联；新建时不关联。</div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">
                编号 {dialogMode !== "channel" && <span className="text-red-500">*</span>}
              </Label>
              <Input
                value={segment}
                onChange={(e) => setSegment(e.target.value.replace(/\D/g, ""))}
                placeholder={dialogMode === "channel" ? "不填则继承NC项目编号" : "请输入数字编号"}
              />
            </div>

            {((dialogMode === "department" && !selectedDept) || dialogMode === "channel") && (
              <div className="space-y-2">
                <Label className="text-sm font-medium text-gray-700">
                  {dialogMode === "department" ? "自定义部门" : "渠道名称"} <span className="text-red-500">*</span>
                </Label>
                <Input
                  value={name}
                  onChange={(event) => {
                    const nextName = event.target.value;
                    setName(nextName);
                    if (dialogMode === "department") {
                      setAssociatedDepartments((prev) => prev.filter(
                        (dept) => normalizeDepartmentValue(dept) !== normalizeDepartmentValue(nextName),
                      ));
                    }
                  }}
                  placeholder={dialogMode === "channel" ? "如：蚂蚁森林基金会" : "请输入名称"}
                />
              </div>
            )}

            {dialogMode === "channel" && (
              <div className="space-y-2">
                <Label className="text-sm font-medium text-gray-700">对应公益平台</Label>
                <select
                  value={selectedPlatformId}
                  onChange={(e) => setSelectedPlatformId(e.target.value)}
                  disabled={platformsQuery.isLoading}
                  className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-100 disabled:text-gray-400"
                >
                  <option value="">不指定</option>
                  {platformsQuery.data?.map((platform: any) => (
                    <option key={platform.platformId} value={platform.platformId}>
                      {platform.platformId}_{platform.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {dialogMode === "channel" && (
              <div className="text-xs text-gray-400">
                预算编码格式：{parentNode?.code || editNode?.code?.split(".").slice(0, 2).join(".") || "n1.n2"}{segment ? `.${segment}` : ""}-{name || "渠道"}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={closeDialog}>取消</Button>
            <Button
              size="sm"
              className="bg-blue-600 hover:bg-blue-700"
              onClick={handleSave}
              disabled={createCategory.isPending || createChannel.isPending || updateCategory.isPending || updateChannel.isPending}
            >
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>渠道修改历史</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {historyNode && <div className="text-sm text-gray-500">当前：{historyNode.code}-{historyNode.name}</div>}
            {historyQuery.isLoading ? (
              <div className="text-center text-gray-400 py-4">加载中...</div>
            ) : historyQuery.data?.length === 0 ? (
              <div className="text-center text-gray-400 py-4">暂无历史记录</div>
            ) : (
              <div className="space-y-2">
                {historyQuery.data?.map((h: any, idx: number) => (
                  <div key={h.id} className="border rounded-lg p-3 text-sm">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-medium text-gray-700">版本 {historyQuery.data!.length - idx}</span>
                      <span className="text-xs text-gray-400">{new Date(h.effectiveDate).toLocaleDateString("zh-CN")}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div><span className="text-gray-400">预算编码：</span><span className="font-mono text-orange-600">{h.code}</span></div>
                      <div><span className="text-gray-400">渠道：</span>{h.name}</div>
                      {h.incomeProject && <div className="col-span-2"><span className="text-gray-400">NC项目：</span><span className="text-blue-600">{h.incomeProject}</span></div>}
                      {h.platformId && <div className="col-span-2"><span className="text-gray-400">公益平台：</span><span className="text-blue-600">{platformNameMap.get(h.platformId) || h.platformId}</span></div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
