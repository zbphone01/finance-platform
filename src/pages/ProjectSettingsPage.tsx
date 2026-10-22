import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FolderOpen,
  History,
  Layers,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";

interface ProjNode {
  id: number;
  code: string;
  name: string;
  parentCode: string | null;
  level: number;
  platformId: string | null;
  platformName?: string | null;
  sortOrder: number;
  children: ProjNode[];
}

const levelLabels: Record<number, string> = {
  1: "项目",
  2: "NC项目名称",
  3: "平台项目名称",
};

function flattenProjects(nodes: ProjNode[]): ProjNode[] {
  return nodes.flatMap((node) => [node, ...flattenProjects(node.children || [])]);
}

function nextCode(nodes: ProjNode[], level: number, siblingCount: number) {
  if (level === 1) {
    return String(siblingCount + 1).padStart(2, "0");
  }

  const prefix = level === 2 ? "PM" : "PP";
  const max = flattenProjects(nodes).reduce((current, node) => {
    if (node.level !== level) return current;
    const match = node.code.match(new RegExp(`^${prefix}(\\d+)$`, "i"));
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `${prefix}${String(max + 1).padStart(7, "0")}`;
}

function ProjectRow({
  node,
  depth = 0,
  expanded,
  toggle,
  onAddChild,
  onEdit,
  onDelete,
  onHistory,
  forceExpanded = false,
  canDelete,
}: {
  node: ProjNode;
  depth?: number;
  expanded: Set<number>;
  toggle: (id: number) => void;
  onAddChild: (n: ProjNode) => void;
  onEdit: (n: ProjNode) => void;
  onDelete: (n: ProjNode) => void;
  onHistory: (n: ProjNode) => void;
  forceExpanded?: boolean;
  canDelete: boolean;
}) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = forceExpanded || expanded.has(node.id);
  const indent = depth * 24;
  const isPlatformProject = node.level === 3;
  const Icon = node.level === 1 ? FolderOpen : node.level === 3 ? Layers : FileText;

  return (
    <div>
      <div
        className="flex items-center justify-between py-2 px-3 hover:bg-gray-50 border-b border-gray-100"
        style={{ paddingLeft: `${12 + indent}px` }}
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
          <Icon className={`h-4 w-4 flex-shrink-0 ${node.level === 1 ? "text-green-600" : isPlatformProject ? "text-blue-600" : "text-orange-500"}`} />
          <span className="font-mono text-xs text-gray-500 flex-shrink-0">{node.code}</span>
          <span className="font-medium truncate text-gray-800">{node.name}</span>
          {isPlatformProject && node.platformName && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">{node.platformName}</span>
          )}
          <span className="text-xs text-gray-400 ml-1">{levelLabels[node.level]}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {node.level < 3 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-green-600 text-xs"
              onClick={() => onAddChild(node)}
            >
              <Plus className="h-3.5 w-3.5 mr-0.5" />
              {node.level === 1 ? "添加NC项目名称" : "添加平台项目名称"}
            </Button>
          )}
          {isPlatformProject && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-gray-600 text-xs"
              onClick={() => onHistory(node)}
            >
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
            <ProjectRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              toggle={toggle}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onDelete={onDelete}
              onHistory={onHistory}
              forceExpanded={forceExpanded}
              canDelete={canDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProjectSettingsPage() {
  const { hasPermission } = usePermissions();
  const canDeleteRecognitionInfo = hasPermission("recognition_info_delete");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<ProjNode | null>(null);
  const [parentNode, setParentNode] = useState<ProjNode | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [level, setLevel] = useState(1);
  const [platformId, setPlatformId] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyNode, setHistoryNode] = useState<ProjNode | null>(null);

  const utils = trpc.useUtils();
  const treeQuery = trpc.project.tree.useQuery();
  const platformsQuery = trpc.fundraisingPlatform.list.useQuery();
  const historyQuery = trpc.project.histories.useQuery(
    { projectId: historyNode?.id || 0 },
    { enabled: historyOpen && !!historyNode }
  );
  const createMutation = trpc.project.create.useMutation({
    onSuccess: () => {
      utils.project.tree.invalidate();
      toast.success("创建成功");
      closeDialog();
    },
    onError: (err: any) => toast.error(err.message || "创建失败"),
  });
  const updateMutation = trpc.project.update.useMutation({
    onSuccess: () => {
      utils.project.tree.invalidate();
      utils.project.histories.invalidate();
      toast.success("更新成功");
      closeDialog();
    },
    onError: (err: any) => toast.error(err.message || "更新失败"),
  });
  const deleteMutation = trpc.project.delete.useMutation({
    onSuccess: () => {
      utils.project.tree.invalidate();
      toast.success("删除成功");
    },
    onError: (err: any) => toast.error(err.message || "删除失败"),
  });

  const tree = treeQuery.data || [];
  const hasData = tree.length > 0;
  const filteredTree = filterProjectTree(tree, search);
  const isSearching = search.trim().length > 0;

  const resetForm = () => {
    setEditItem(null);
    setParentNode(null);
    setCode("");
    setName("");
    setLevel(1);
    setPlatformId("");
  };

  const closeDialog = () => {
    setDialogOpen(false);
    resetForm();
  };

  const openCreateRoot = () => {
    resetForm();
    setLevel(1);
    setCode(nextCode(tree, 1, tree.length));
    setDialogOpen(true);
  };

  const openAddChild = (parent: ProjNode) => {
    resetForm();
    const childLevel = parent.level + 1;
    setParentNode(parent);
    setLevel(childLevel);
    setCode(nextCode(tree, childLevel, parent.children?.length || 0));
    setDialogOpen(true);
  };

  const openEdit = (node: ProjNode) => {
    setEditItem(node);
    setCode(node.code);
    setName(node.name);
    setLevel(node.level);
    setPlatformId(node.platformId || "");
    setDialogOpen(true);
  };

  const openHistory = (node: ProjNode) => {
    setHistoryNode(node);
    setHistoryOpen(true);
  };

  const handleDelete = (node: ProjNode) => {
    if (confirm(`确定删除 [${node.code}] ${node.name}？`)) {
      deleteMutation.mutate({ id: node.id });
    }
  };

  const handleSave = () => {
    const trimmedCode = code.trim();
    const trimmedName = name.trim();
    if (!trimmedCode) {
      toast.error("请输入编号");
      return;
    }
    if (level === 1 && !/^\d+$/.test(trimmedCode)) {
      toast.error("项目编号必须是数字，如 01");
      return;
    }
    if (level === 2 && !/^PM\d{1,11}$/i.test(trimmedCode)) {
      toast.error("NC项目编号必须以 PM 开头加最多11位数字，如 PM0000001");
      return;
    }
    if (level === 3 && !/^PP\d{7}$/i.test(trimmedCode)) {
      toast.error("平台项目编号必须以 PP 开头加7位数字，如 PP0000001");
      return;
    }
    if (!trimmedName) {
      toast.error(`请输入${levelLabels[level] || "项目"}名称`);
      return;
    }
    if (level === 3 && !platformId) {
      toast.error("请选择公益平台");
      return;
    }

    if (editItem) {
      updateMutation.mutate({
        id: editItem.id,
        code: trimmedCode,
        name: trimmedName,
      });
    } else {
      createMutation.mutate({
        code: trimmedCode,
        name: trimmedName,
        parentCode: parentNode?.code || null,
        level,
        platformId: level === 3 ? platformId : null,
        sortOrder: 0,
      });
    }
  };

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">项目管理</h1>
        <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={openCreateRoot}>
          <Plus className="h-4 w-4 mr-1" />
          新增项目
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 p-4 pb-3 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-gray-500">
              共 {tree.length} 个项目{isSearching ? `，匹配 ${filteredTree.length} 个项目` : ""}
            </div>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索项目、NC项目、平台项目或公益平台"
              className="h-9 md:w-96"
            />
          </div>
          {treeQuery.isLoading ? (
            <div className="text-center py-8 text-gray-400">加载中...</div>
          ) : !hasData ? (
            <div className="text-center py-12 text-gray-400">
              <FolderOpen className="h-10 w-10 mx-auto mb-2 text-gray-300" />
              <p>暂无项目数据</p>
            </div>
          ) : filteredTree.length === 0 ? (
            <div className="text-center py-10 text-gray-400">未找到匹配项目</div>
          ) : (
            <div>
              {filteredTree.map((node: ProjNode) => (
                <ProjectRow
                  key={node.id}
                  node={node}
                  expanded={expanded}
                  toggle={toggle}
                  onAddChild={openAddChild}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                  onHistory={openHistory}
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
            <DialogTitle>{editItem ? `编辑${levelLabels[level]}` : `新增${levelLabels[level]}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">编号</Label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="font-mono"
                placeholder={level === 2 ? "如 PM0000001，PM 后最多11位数字" : level === 3 ? "如 PP0000001" : "如 01"}
              />
            </div>
            {parentNode && (
              <div className="space-y-2">
                <Label className="text-sm font-medium text-gray-700">上级</Label>
                <Input value={`${parentNode.code}_${parentNode.name}`} disabled className="bg-gray-100" />
              </div>
            )}
            {level === 3 && (
              <div className="space-y-2">
                <Label className="text-sm font-medium text-gray-700">
                  公益平台 <span className="text-red-500">*</span>
                </Label>
                {editItem ? (
                  <Input
                    value={editItem.platformName ? `${editItem.platformId}_${editItem.platformName}` : editItem.platformId || ""}
                    disabled
                    className="bg-gray-100"
                  />
                ) : (
                  <select
                    value={platformId}
                    onChange={(e) => setPlatformId(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">请选择公益平台</option>
                    {(platformsQuery.data || []).map((platform: any) => (
                      <option key={platform.platformId} value={platform.platformId}>
                        {platform.platformId}_{platform.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">
                {levelLabels[level]} <span className="text-red-500">*</span>
              </Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`请输入${levelLabels[level]}`}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={closeDialog}>取消</Button>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700"
              onClick={handleSave}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>平台项目名称修改历史</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {historyNode && (
              <div className="text-sm text-gray-500">
                当前：{historyNode.code} {historyNode.name}
              </div>
            )}
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
                      <div><span className="text-gray-400">编号：</span><span className="font-mono text-blue-600">{h.code}</span></div>
                      <div><span className="text-gray-400">公益平台：</span>{h.platformName || h.platformId || "-"}</div>
                      <div className="col-span-2"><span className="text-gray-400">平台项目名称：</span>{h.name}</div>
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

function filterProjectTree(nodes: ProjNode[], keyword: string): ProjNode[] {
  const text = keyword.trim().toLowerCase();
  if (!text) return nodes;
  return nodes
    .map((node) => {
      const children = filterProjectTree(node.children || [], keyword);
      const selfText = `${node.code} ${node.name} ${node.platformId || ""} ${node.platformName || ""}`.toLowerCase();
      if (selfText.includes(text) || children.length > 0) {
        return { ...node, children };
      }
      return null;
    })
    .filter(Boolean) as ProjNode[];
}
