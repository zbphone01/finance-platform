import { useRef, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, ChevronRight, ChevronDown, FolderOpen, FileText, Bookmark, HeartHandshake, Download, Upload } from "lucide-react";
import Papa from "papaparse";
import { usePermissions } from "@/hooks/usePermissions";

interface ActivityNode {
  id: number;
  code: string;
  name: string;
  parentCode: string | null;
  level: number;
  isLeaf: number;
  sortOrder: number;
  children: ActivityNode[];
}

const donationActivityCsvColumns = ["分类编号", "分类", "活动说明编号", "活动说明"] as const;
type DonationActivityCsvColumn = (typeof donationActivityCsvColumns)[number];

function getCsvCell(row: Record<string, unknown>, column: DonationActivityCsvColumn) {
  return String(row[column] ?? "").trim();
}

function parseDonationActivityCsv(text: string) {
  const result = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: "greedy" });
  if (result.errors.length > 0) {
    throw new Error(result.errors[0]?.message || "CSV解析失败");
  }

  const fields = new Set(result.meta.fields || []);
  const missingColumns = donationActivityCsvColumns.filter((column) => !fields.has(column));
  if (missingColumns.length > 0) {
    throw new Error(`CSV缺少列：${missingColumns.join("、")}`);
  }
  if (result.data.length === 0) {
    throw new Error("CSV中没有可导入内容");
  }

  return result.data.map((row) => ({
    categoryCode: getCsvCell(row, "分类编号"),
    categoryName: getCsvCell(row, "分类"),
    activityCode: getCsvCell(row, "活动说明编号"),
    activityName: getCsvCell(row, "活动说明"),
  }));
}

function buildDonationActivityCsvRows(nodes: ActivityNode[]) {
  return nodes.flatMap((category) => {
    if (category.level === 2) {
      return [{
        "分类编号": "",
        "分类": "",
        "活动说明编号": category.code,
        "活动说明": category.name,
      }];
    }
    if (!category.children || category.children.length === 0) {
      return [{
        "分类编号": category.code,
        "分类": category.name,
        "活动说明编号": "",
        "活动说明": "",
      }];
    }
    return category.children.map((activity) => ({
      "分类编号": category.code,
      "分类": category.name,
      "活动说明编号": activity.code,
      "活动说明": activity.name,
    }));
  });
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function ActivityRow({
  node,
  depth = 0,
  onEdit,
  onDelete,
  onAddChild,
  expanded,
  toggle,
  canDelete,
}: {
  node: ActivityNode;
  depth?: number;
  onEdit: (n: ActivityNode) => void;
  onDelete: (n: ActivityNode) => void;
  onAddChild: (n: ActivityNode) => void;
  expanded: Set<number>;
  toggle: (id: number) => void;
  canDelete: boolean;
}) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const indent = depth * 24;
  const isCategory = node.level === 1;

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
          {isCategory ? (
            <FolderOpen className="h-4 w-4 text-purple-600 flex-shrink-0" />
          ) : (
            <FileText className="h-4 w-4 text-pink-500 flex-shrink-0" />
          )}
          <span className="font-mono text-xs text-gray-500 flex-shrink-0">{node.code}</span>
          <span className="font-medium truncate text-gray-800">{node.name}</span>
          <span className="text-xs text-gray-400 ml-1">
            {isCategory ? "分类" : "活动说明"}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {isCategory && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-purple-600"
              onClick={() => onAddChild(node)}
              title="添加活动说明"
            >
              <Plus className="h-3.5 w-3.5 mr-0.5" />
              添加说明
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
            <ActivityRow
              key={child.id}
              node={child}
              depth={depth + 1}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddChild={onAddChild}
              expanded={expanded}
              toggle={toggle}
              canDelete={canDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DonationActivityPage() {
  const { hasPermission } = usePermissions();
  const canDeleteRecognitionInfo = hasPermission("recognition_info_delete");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [parentCode, setParentCode] = useState("");
  const [level, setLevel] = useState(1);
  const [formError, setFormError] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const treeQuery = trpc.donationActivity.tree.useQuery();
  const createMutation = trpc.donationActivity.create.useMutation({
    onSuccess: () => {
      utils.donationActivity.tree.invalidate();
      toast.success("创建成功");
      setDialogOpen(false);
      resetForm();
    },
    onError: (err: any) => setFormError(err.message || "创建失败"),
  });
  const updateMutation = trpc.donationActivity.update.useMutation({
    onSuccess: () => {
      utils.donationActivity.tree.invalidate();
      toast.success("更新成功");
      setDialogOpen(false);
      resetForm();
    },
    onError: (err: any) => setFormError(err.message || "更新失败"),
  });
  const deleteMutation = trpc.donationActivity.delete.useMutation({
    onSuccess: () => {
      utils.donationActivity.tree.invalidate();
      toast.success("删除成功");
    },
    onError: (err: any) => toast.error(err.message || "删除失败"),
  });
  const batchCreateMutation = trpc.donationActivity.batchCreate.useMutation({
    onSuccess: () => {
      utils.donationActivity.tree.invalidate();
      toast.success("预设数据导入完成");
    },
    onError: (err: any) => toast.error(err.message || "导入失败"),
  });
  const importCsvMutation = trpc.donationActivity.importCsv.useMutation({
    onSuccess: (result) => {
      utils.donationActivity.tree.invalidate();
      toast.success(`导入成功：分类 ${result.categories} 个，活动说明 ${result.activities} 个`);
    },
    onError: (err: any) => toast.error(err.message || "导入失败"),
  });

  const resetForm = () => {
    setEditId(null);
    setCode("");
    setName("");
    setParentCode("");
    setLevel(1);
    setFormError("");
  };

  const openCreateCategory = () => {
    resetForm();
    setLevel(1);
    setDialogOpen(true);
  };

  const openCreateLeaf = () => {
    resetForm();
    setLevel(2);
    setParentCode("");
    setDialogOpen(true);
  };

  const openAddChild = (parent: ActivityNode) => {
    resetForm();
    setParentCode(parent.code);
    setLevel(2);
    // 自动建议编号（3位数字）
    const nextNum = String(parent.children.length + 1).padStart(3, "0");
    setCode(nextNum);
    setDialogOpen(true);
  };

  const openEdit = (node: ActivityNode) => {
    setEditId(node.id);
    setCode(node.code);
    setName(node.name);
    setParentCode(node.parentCode || "");
    setLevel(node.level);
    setDialogOpen(true);
  };

  const handleDelete = (node: ActivityNode) => {
    if (confirm(`确定删除 [${node.code}] ${node.name}？`)) {
      deleteMutation.mutate({ id: node.id });
    }
  };

  const handleSave = () => {
    setFormError("");
    const trimmedCode = code.trim();
    const trimmedName = name.trim();
    if (!trimmedCode) {
      setFormError("请输入编号");
      return;
    }
    if (!trimmedName) {
      setFormError("请输入名称");
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

  const handleExportCsv = () => {
    const rows = buildDonationActivityCsvRows(treeQuery.data || []);
    if (rows.length === 0) {
      toast.error("暂无可导出的捐赠活动");
      return;
    }
    const csv = Papa.unparse(rows, { columns: [...donationActivityCsvColumns] });
    downloadCsv(csv, `捐赠活动_${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success("捐赠活动已导出");
  };

  const handleImportCsvFile = async (file: File) => {
    try {
      const text = await file.text();
      const rows = parseDonationActivityCsv(text);
      await importCsvMutation.mutateAsync(rows);
    } catch (err: any) {
      toast.error(err?.message || "导入失败，请检查文件");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  // 预设数据
  const presetData = [
    { code: "1", name: "日常", parentCode: null, level: 1, sortOrder: 0 },
    { code: "2", name: "专项", parentCode: null, level: 1, sortOrder: 1 },
    { code: "001", name: "2025春季助学行动", parentCode: "1", level: 2, sortOrder: 0 },
    { code: "002", name: "社区环保清洁日", parentCode: "1", level: 2, sortOrder: 1 },
    { code: "003", name: "阿拉善梭梭种植", parentCode: "2", level: 2, sortOrder: 0 },
  ];

  const hasData = treeQuery.data && treeQuery.data.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">捐赠活动</h1>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={handleExportCsv} disabled={treeQuery.isLoading}>
            <Download className="h-4 w-4 mr-1" />
            导出
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => importInputRef.current?.click()}
            disabled={importCsvMutation.isPending}
          >
            <Upload className="h-4 w-4 mr-1" />
            {importCsvMutation.isPending ? "导入中..." : "导入"}
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleImportCsvFile(file);
            }}
          />
          {!hasData && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (confirm("将导入预设捐赠活动数据，确认？")) {
                  batchCreateMutation.mutate(presetData);
                }
              }}
            >
              <Bookmark className="h-4 w-4 mr-1" />
              导入预设数据
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={openCreateCategory}>
            <Plus className="h-4 w-4 mr-1" />
            新增分类
          </Button>
          <Button size="sm" className="bg-pink-600 hover:bg-pink-700" onClick={openCreateLeaf}>
            <Plus className="h-4 w-4 mr-1" />
            新增活动说明
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="text-sm text-gray-500 p-4 pb-0">
            共 {treeQuery.data?.length || 0} 个分类/活动
          </div>
          {treeQuery.isLoading ? (
            <div className="text-center py-8 text-gray-400">加载中...</div>
          ) : !hasData ? (
            <div className="text-center py-12 text-gray-400">
              <HeartHandshake className="h-10 w-10 mx-auto mb-2 text-gray-300" />
              <p>暂无捐赠活动数据</p>
              <p className="text-xs mt-1">点击"导入预设数据"或手动添加</p>
            </div>
          ) : (
            <div>
              {treeQuery.data.map((node: ActivityNode) => (
                <ActivityRow
                  key={node.id}
                  node={node}
                  onEdit={openEdit}
                  onDelete={handleDelete}
                  onAddChild={openAddChild}
                  expanded={expanded}
                  toggle={toggle}
                  canDelete={canDeleteRecognitionInfo}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editId
                ? "编辑"
                : level === 1
                  ? "新增分类"
                  : parentCode
                    ? "添加活动说明"
                    : "新增活动说明"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {formError && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {formError}
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">
                {level === 1 ? "分类编号" : "活动编号"} <span className="text-red-500">*</span>
              </Label>
              <Input
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  if (formError) setFormError("");
                }}
                placeholder={level === 1 ? "如：1" : "如：A01"}
                disabled={!!editId}
                className={editId ? "bg-gray-100" : ""}
              />
              <p className="text-xs text-gray-400">
                {level === 1
                  ? "分类编号：1位数字，如 1、2、3"
                  : "活动说明编号：3至6位数字或字母，如 001、A01"}
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-gray-700">
                {level === 1 ? "分类名称" : "活动详情"} <span className="text-red-500">*</span>
              </Label>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (formError) setFormError("");
                }}
                placeholder={level === 1 ? "如：日常、专项" : "请输入活动详情说明"}
              />
            </div>
            {parentCode && (
              <div className="space-y-2">
                <Label className="text-sm font-medium text-gray-700">所属分类</Label>
                <Input value={parentCode} disabled className="bg-gray-100" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button
              size="sm"
              className={level === 1 ? "bg-purple-600 hover:bg-purple-700" : "bg-pink-600 hover:bg-pink-700"}
              onClick={handleSave}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
