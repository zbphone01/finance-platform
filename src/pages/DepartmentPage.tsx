import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, ChevronRight, ChevronDown, Building, Users } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";

interface DeptNode {
  id: number;
  code: string;
  name: string;
  parentCode: string | null;
  level: number;
  sortOrder: number;
  children: DeptNode[];
}

function DeptRow({
  node,
  depth = 0,
  onEdit,
  onDelete,
  onAddChild,
  expanded,
  toggle,
  forceExpanded = false,
  canDelete,
}: {
  node: DeptNode;
  depth?: number;
  onEdit: (d: DeptNode) => void;
  onDelete: (d: DeptNode) => void;
  onAddChild: (d: DeptNode) => void;
  expanded: Set<number>;
  toggle: (id: number) => void;
  forceExpanded?: boolean;
  canDelete: boolean;
}) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = forceExpanded || expanded.has(node.id);
  const indent = depth * 24;

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
          {/* 部门 vs 分组 使用不同图标 */}
          {node.level === 3 ? (
            <Users className="h-4 w-4 text-purple-600 flex-shrink-0" />
          ) : (
            <Building className="h-4 w-4 text-blue-600 flex-shrink-0" />
          )}
          <span className="font-mono text-xs text-gray-500 w-16 flex-shrink-0">{node.code}</span>
          <span className="font-medium text-gray-800 truncate">{node.name}</span>
          <span className="text-xs text-gray-400 ml-2">
            {node.level === 1 ? "一级部门" : node.level === 2 ? "二级部门" : "三级分组"}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* 只有一级和二级才能添加下级（最多三级） */}
          {node.level < 3 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-green-600"
              onClick={() => onAddChild(node)}
              title={`添加${node.level === 1 ? "二级部门" : "三级分组"}`}
            >
              <Plus className="h-3.5 w-3.5 mr-0.5" />
              {node.level === 1 ? "添加二级" : "添加分组"}
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
            <DeptRow
              key={child.id}
              node={child}
              depth={depth + 1}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddChild={onAddChild}
              expanded={expanded}
              toggle={toggle}
              forceExpanded={forceExpanded}
              canDelete={canDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DepartmentPage() {
  const { hasPermission } = usePermissions();
  const canDeleteRecognitionInfo = hasPermission("recognition_info_delete");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [parentCode, setParentCode] = useState("");
  const [level, setLevel] = useState(1);
  const [autoInitRequested, setAutoInitRequested] = useState(false);

  const utils = trpc.useUtils();
  const treeQuery = trpc.department.tree.useQuery();
  const ensurePresetMutation = trpc.department.ensurePreset.useMutation({
    onSuccess: (result) => {
      if (result.initialized) {
        utils.department.tree.invalidate();
      }
    },
    onError: (err: any) => toast.error(err.message || "部门初始数据初始化失败"),
  });
  const createMutation = trpc.department.create.useMutation({
    onSuccess: () => {
      utils.department.tree.invalidate();
      toast.success("创建成功");
      setDialogOpen(false);
      resetForm();
    },
    onError: (err: any) => toast.error(err.message || "创建失败"),
  });
  const updateMutation = trpc.department.update.useMutation({
    onSuccess: () => {
      utils.department.tree.invalidate();
      toast.success("更新成功");
      setDialogOpen(false);
      resetForm();
    },
    onError: (err: any) => toast.error(err.message || "更新失败"),
  });
  const deleteMutation = trpc.department.delete.useMutation({
    onSuccess: () => {
      utils.department.tree.invalidate();
      toast.success("删除成功");
    },
    onError: (err: any) => toast.error(err.message || "删除失败"),
  });

  const resetForm = () => {
    setEditId(null);
    setCode("");
    setName("");
    setParentCode("");
    setLevel(1);
  };

  const openCreate = (parent?: DeptNode) => {
    resetForm();
    if (parent) {
      setParentCode(parent.code);
      setLevel(parent.level + 1);
      // 自动建议编码
      if (parent.level === 1) {
        // 一级下创建二级，默认从 01 开始
        const nextNum = String(parent.children.length + 1).padStart(2, "0");
        setCode(`${parent.code}${nextNum}`);
      } else if (parent.level === 2) {
        // 二级下创建三级
        const nextNum = String(parent.children.length + 1).padStart(2, "0");
        setCode(`${parent.code}${nextNum}`);
      }
    }
    setDialogOpen(true);
  };

  const openEdit = (node: DeptNode) => {
    setEditId(node.id);
    setCode(node.code);
    setName(node.name);
    setParentCode(node.parentCode || "");
    setLevel(node.level);
    setDialogOpen(true);
  };

  const handleDelete = (node: DeptNode) => {
    if (confirm(`确定删除 [${node.code}] ${node.name}？`)) {
      deleteMutation.mutate({ id: node.id });
    }
  };

  const handleSave = () => {
    const trimmedCode = code.trim();
    const trimmedName = name.trim();
    if (!trimmedCode) {
      toast.error("请输入部门编码");
      return;
    }
    if (!trimmedName) {
      toast.error("请输入部门名称");
      return;
    }
    if (editId) {
      updateMutation.mutate({ id: editId, name: trimmedName });
    } else {
      createMutation.mutate({
        code: trimmedCode,
        name: trimmedName,
        parentCode: parentCode || null,
        level,
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

  const hasData = treeQuery.data && treeQuery.data.length > 0;
  const filteredTree = filterDeptTree(treeQuery.data || [], search);
  const isSearching = search.trim().length > 0;

  useEffect(() => {
    if (treeQuery.isLoading || treeQuery.isError || autoInitRequested || hasData) return;
    setAutoInitRequested(true);
    ensurePresetMutation.mutate();
  }, [autoInitRequested, ensurePresetMutation, hasData, treeQuery.isError, treeQuery.isLoading]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">部门管理</h1>
        <div className="flex gap-2">
          <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={() => openCreate()}>
            <Plus className="h-4 w-4 mr-1" />
            新增一级部门
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 p-4 pb-3 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-gray-500">
              共 {treeQuery.data?.length || 0} 个一级部门{isSearching ? `，匹配 ${filteredTree.length} 个一级部门` : ""}
            </div>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索部门编码或名称"
              className="h-9 md:w-80"
            />
          </div>
          {treeQuery.isLoading ? (
            <div className="text-center py-8 text-gray-400">加载中...</div>
          ) : !hasData ? (
            <div className="text-center py-12 text-gray-400">
              <Building className="h-10 w-10 mx-auto mb-2 text-gray-300" />
              <p>{ensurePresetMutation.isPending ? "正在初始化部门数据..." : "暂无部门数据"}</p>
            </div>
          ) : filteredTree.length === 0 ? (
            <div className="text-center py-10 text-gray-400">未找到匹配部门</div>
          ) : (
            <div>
              {filteredTree.map((node: DeptNode) => (
                <DeptRow
                  key={node.id}
                  node={node}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                  onAddChild={openCreate}
                  expanded={expanded}
                  toggle={toggle}
                  forceExpanded={isSearching}
                  canDelete={canDeleteRecognitionInfo}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 创建/编辑对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editId ? "编辑部门" : "新增部门"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">部门编码 <span className="text-red-500">*</span></label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={level === 1 ? "如：00" : level === 2 ? "如：0001" : "如：000101"}
                disabled={!!editId}
                className={editId ? "bg-gray-100" : ""}
              />
              <p className="text-xs text-gray-400">
                {level === 1 ? "一级部门：2位数字" : level === 2 ? "二级部门：4位数字（父级+2位）" : "三级分组：6位数字（父级+2位）"}
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">部门名称 <span className="text-red-500">*</span></label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="请输入部门名称"
              />
            </div>
            {parentCode && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">上级部门</label>
                <Input value={parentCode} disabled className="bg-gray-100" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={handleSave}
              disabled={createMutation.isPending || updateMutation.isPending}>
              {createMutation.isPending || updateMutation.isPending ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function filterDeptTree(nodes: DeptNode[], keyword: string): DeptNode[] {
  const text = keyword.trim().toLowerCase();
  if (!text) return nodes;
  return nodes
    .map((node) => {
      const children = filterDeptTree(node.children || [], keyword);
      const selfText = `${node.code} ${node.name}`.toLowerCase();
      if (selfText.includes(text) || children.length > 0) {
        return { ...node, children };
      }
      return null;
    })
    .filter(Boolean) as DeptNode[];
}
