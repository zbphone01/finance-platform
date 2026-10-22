import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Search, Trash2, Eye, Pencil, ListOrdered, CheckCircle, Download, Upload, Copy } from "lucide-react";
import { toast } from "sonner";
import Papa from "papaparse";
import { usePermissions } from "@/hooks/usePermissions";

function formatDetailRuleName(rule: any) {
  return rule.detailPackageType ? `${rule.ruleName}（${rule.detailPackageType}）` : rule.ruleName;
}

const detailRuleCsvColumns = [
  "条件序号",
  "分账序号",
  "关键字字段",
  "匹配方式",
  "关键字",
  "分账比例",
  "收入类型",
  "收入属性",
  "收入部门",
  "预算编码",
  "NC项目名称",
  "平台项目名称",
  "平台项目详情",
  "管理费比例",
  "支出资金来源",
] as const;

type DetailRuleCsvColumn = (typeof detailRuleCsvColumns)[number];
type DetailRuleCsvRow = Record<DetailRuleCsvColumn, string>;

function getCsvCell(row: Record<string, unknown>, column: DetailRuleCsvColumn) {
  return String(row[column] ?? "").trim();
}

function parsePositiveOrder(value: string, label: string, rowNumber: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`第${rowNumber}行${label}必须是大于0的整数`);
  }
  return parsed;
}

function parseDetailRuleItems(text: string) {
  const result = Papa.parse<Record<string, unknown>>(text, { header: true, skipEmptyLines: "greedy" });
  if (result.errors.length > 0) {
    throw new Error(result.errors[0]?.message || "CSV解析失败");
  }

  const fields = new Set(result.meta.fields || []);
  const missingColumns = detailRuleCsvColumns.filter((column) => !fields.has(column));
  if (missingColumns.length > 0) {
    throw new Error(`CSV缺少列：${missingColumns.join("、")}`);
  }
  if (result.data.length === 0) {
    throw new Error("CSV中没有条件内容");
  }

  const items = new Map<number, {
    keywordField: string;
    keywordMatchType: "等于" | "包含";
    detailKeyword: string;
    splits: Array<{
      order: number;
      splitRatio: string;
      incomeType: string;
      incomeAttr: string;
      incomeDept: string;
      budgetCode: string;
      incomeProject: string;
      platformProjectName: string;
      platformProjectDetail: string;
      managementFeeRatio: string;
      expenseFundSource: string;
    }>;
  }>();

  result.data.forEach((rawRow, index) => {
    const rowNumber = index + 2;
    const row = Object.fromEntries(detailRuleCsvColumns.map((column) => [column, getCsvCell(rawRow, column)])) as DetailRuleCsvRow;
    const itemOrder = parsePositiveOrder(row["条件序号"], "条件序号", rowNumber);
    const splitOrder = parsePositiveOrder(row["分账序号"], "分账序号", rowNumber);
    const keywordMatchType = row["匹配方式"];
    if (keywordMatchType !== "等于" && keywordMatchType !== "包含") {
      throw new Error(`第${rowNumber}行匹配方式必须是“等于”或“包含”`);
    }
    const existing = items.get(itemOrder);

    if (!existing) {
      items.set(itemOrder, {
        keywordField: row["关键字字段"],
        keywordMatchType,
        detailKeyword: row["关键字"],
        splits: [],
      });
    } else if (existing.keywordField !== row["关键字字段"] || existing.keywordMatchType !== keywordMatchType || existing.detailKeyword !== row["关键字"]) {
      throw new Error(`第${rowNumber}行与条件${itemOrder}的关键字内容不一致`);
    }

    items.get(itemOrder)?.splits.push({
      order: splitOrder,
      splitRatio: row["分账比例"],
      incomeType: row["收入类型"],
      incomeAttr: row["收入属性"],
      incomeDept: row["收入部门"],
      budgetCode: row["预算编码"],
      incomeProject: row["NC项目名称"],
      platformProjectName: row["平台项目名称"],
      platformProjectDetail: row["平台项目详情"],
      managementFeeRatio: row["管理费比例"],
      expenseFundSource: row["支出资金来源"],
    });
  });

  return Array.from(items.entries())
    .sort(([a], [b]) => a - b)
    .map(([, item]) => ({
      keywordField: item.keywordField,
      keywordMatchType: item.keywordMatchType,
      detailKeyword: item.detailKeyword,
      splits: item.splits
        .sort((a, b) => a.order - b.order)
        .map(({ order: _order, ...split }) => split),
    }));
}

export default function RulesPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const canDeleteRecognitionRule = hasPermission("recognition_rule_delete");
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copySourceId, setCopySourceId] = useState<number | null>(null);
  const [copyRuleName, setCopyRuleName] = useState("");
  const [copyCounterpartyAlias, setCopyCounterpartyAlias] = useState("");
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [transferRuleId, setTransferRuleId] = useState("");
  const [transferMode, setTransferMode] = useState<"import" | "export">("export");
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const utils = trpc.useUtils();
  const rulesQuery = trpc.rule.list.useQuery({ search: searchQuery || undefined, all: true });
  const transferRulesQuery = trpc.rule.transferOptions.useQuery();
  const statsQuery = trpc.rule.stats.useQuery();
  const exportQuery = trpc.rule.exportConditions.useQuery({ id: Number(transferRuleId || 0) }, { enabled: false });
  const counterpartyQuery = trpc.counterparty.listRecorded.useQuery({ page: 1, pageSize: 500, recognitionType: "明细认账" });
  const importRules = trpc.rule.importConditions.useMutation({
    onSuccess: (data) => {
      utils.rule.list.invalidate();
      utils.rule.stats.invalidate();
      toast.success(`导入成功：已更新 ${data.imported} 条条件`);
    },
    onError: (err: any) => toast.error(err.message || "导入失败"),
  });
  const toggleActive = trpc.rule.toggleActive.useMutation({
    onSuccess: () => {
      utils.rule.list.invalidate();
      utils.rule.stats.invalidate();
    },
  });
  const deleteRule = trpc.rule.delete.useMutation({
    onSuccess: () => {
      utils.rule.list.invalidate();
      utils.rule.stats.invalidate();
      utils.rule.transferOptions.invalidate();
    },
  });
  const copyRule = trpc.rule.copy.useMutation({
    onSuccess: () => {
      utils.rule.list.invalidate();
      utils.rule.stats.invalidate();
      utils.rule.transferOptions.invalidate();
      toast.success("复制成功");
      setCopyDialogOpen(false);
      setCopySourceId(null);
      setCopyRuleName("");
      setCopyCounterpartyAlias("");
    },
    onError: (err: any) => toast.error(err.message || "复制失败"),
  });

  const handleDelete = async (id: number) => {
    if (confirm("确定删除此规则？此操作不可撤销。")) {
      await deleteRule.mutateAsync({ id });
    }
  };

  const openCopyDialog = (rule: any) => {
    setCopySourceId(rule.id);
    setCopyRuleName(`${rule.ruleName} 副本`);
    setCopyCounterpartyAlias("");
    setCopyDialogOpen(true);
  };

  const handleCopy = () => {
    const ruleName = copyRuleName.trim();
    if (!copySourceId) return;
    if (!ruleName) {
      toast.error("请输入规则名称");
      return;
    }
    if (!copyCounterpartyAlias) {
      toast.error("请选择匹配到账信息");
      return;
    }
    copyRule.mutate({
      sourceId: copySourceId,
      ruleName,
      matchedCounterpartyAlias: copyCounterpartyAlias,
    });
  };

  const openExportDialog = () => {
    setTransferMode("export");
    setTransferRuleId("");
    setExportDialogOpen(true);
  };

  const openImportDialog = () => {
    setTransferMode("import");
    setTransferRuleId("");
    setImportDialogOpen(true);
  };

  const downloadCsv = (data: string, filename: string) => {
    const blob = new Blob([`\ufeff${data}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = async () => {
    if (!transferRuleId) {
      toast.error("请先选择规则");
      return;
    }
    const result = await exportQuery.refetch();
    if (!result.data) {
      toast.error("导出失败");
      return;
    }
    const rows = result.data.items.flatMap((item: any, itemIndex: number) =>
      item.splits.map((split: any, splitIndex: number) => ({
        "条件序号": String(itemIndex + 1),
        "分账序号": String(splitIndex + 1),
        "关键字字段": item.keywordField,
        "匹配方式": item.keywordMatchType || "等于",
        "关键字": item.detailKeyword,
        "分账比例": split.splitRatio,
        "收入类型": split.incomeType,
        "收入属性": split.incomeAttr,
        "收入部门": split.incomeDept,
        "预算编码": split.budgetCode,
        "NC项目名称": split.incomeProject,
        "平台项目名称": split.platformProjectName,
        "平台项目详情": split.platformProjectDetail,
        "管理费比例": split.managementFeeRatio,
        "支出资金来源": split.expenseFundSource,
      })),
    );
    const csv = Papa.unparse(rows, { columns: [...detailRuleCsvColumns] });
    const filenameRuleName = result.data.ruleName.replace(/[\\/:*?"<>|]/g, "_");
    downloadCsv(csv, `明细认账规则条件_${filenameRuleName}_${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success("规则条件已导出");
    setExportDialogOpen(false);
  };

  const handleImportFile = async (file: File) => {
    try {
      if (!transferRuleId) {
        throw new Error("请先选择规则");
      }
      const text = await file.text();
      const items = parseDetailRuleItems(text);
      if (!confirm("导入将替换所选规则当前的条件内容，确认继续？")) {
        return;
      }
      await importRules.mutateAsync({ id: Number(transferRuleId), items: items as any });
      setImportDialogOpen(false);
    } catch (err: any) {
      toast.error(err?.message || "导入失败，请检查文件");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const rules = rulesQuery.data?.items || [];
  const transferRules = transferRulesQuery.data || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">明细认账</h1>
        <div className="flex items-center gap-4">
          <div className="flex gap-3 text-sm text-gray-500">
            <div className="flex items-center gap-1">
              <ListOrdered className="h-4 w-4 text-blue-600" />
              规则: <span className="font-medium text-gray-700">{statsQuery.data?.total || 0}</span>
            </div>
            <div className="flex items-center gap-1">
              <CheckCircle className="h-4 w-4 text-green-600" />
              启用: <span className="font-medium text-gray-700">{statsQuery.data?.active || 0}</span>
            </div>
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept="text/csv,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportFile(file);
            }}
          />
          <Button variant="outline" onClick={openExportDialog} disabled={exportQuery.isFetching}>
            <Download className="h-4 w-4 mr-1" />
            导出条件
          </Button>
          <Button variant="outline" onClick={openImportDialog} disabled={importRules.isPending}>
            <Upload className="h-4 w-4 mr-1" />
            导入条件
          </Button>
          <Button onClick={() => navigate("/rules/new")}>
            <Plus className="h-4 w-4 mr-1" />
            新建规则
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <Input placeholder="搜索规则名称" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
        <Button variant="outline" onClick={() => setSearchQuery(search)}>
          <Search className="h-4 w-4 mr-1" />搜索
        </Button>
        <Button variant="ghost" onClick={() => { setSearch(""); setSearchQuery(""); }}>重置</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>规则名称</TableHead>
                <TableHead>创建人</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>修改时间</TableHead>
                <TableHead>规则条数</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rulesQuery.isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8">加载中...</TableCell></TableRow>
              ) : rules.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-400">暂无数据</TableCell></TableRow>
              ) : rules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell className="font-mono text-xs">{rule.id}</TableCell>
                  <TableCell className="font-medium">{formatDetailRuleName(rule)}</TableCell>
                  <TableCell>{rule.creator?.name || "-"}</TableCell>
                  <TableCell className="text-sm text-gray-500">{new Date(rule.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell className="text-sm text-gray-500">{new Date(rule.updatedAt).toLocaleDateString()}</TableCell>
                  <TableCell>{rule.conditionRecognitionEnabled === false ? "整包入账" : `${rule.items?.length || 0} 条`}</TableCell>
                  <TableCell>
                    <Switch
                      checked={rule.isActive}
                      onCheckedChange={(checked) => {
                        toggleActive.mutate({ id: rule.id, isActive: checked });
                      }}
                      disabled={toggleActive.isPending}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-blue-500 h-7 w-7 p-0"
                        onClick={() => navigate(`/rules/${rule.id}`)}
                        title="查看"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-orange-500 h-7 w-7 p-0"
                        onClick={() => navigate(`/rules/edit/${rule.id}`)}
                        title="编辑"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-green-600 h-7 w-7 p-0"
                        onClick={() => openCopyDialog(rule)}
                        title="复制"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className={`h-7 w-7 p-0 ${canDeleteRecognitionRule ? "text-red-500 hover:text-red-700" : "text-gray-300"}`}
                        onClick={() => handleDelete(rule.id)}
                        disabled={!canDeleteRecognitionRule}
                        title={canDeleteRecognitionRule ? "删除" : "无删除权限"}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>复制明细认账规则</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>规则名称 <span className="text-red-500">*</span></Label>
              <Input
                value={copyRuleName}
                onChange={(e) => setCopyRuleName(e.target.value)}
                placeholder="请输入新规则名称"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>匹配到账信息 <span className="text-red-500">*</span></Label>
              <Select value={copyCounterpartyAlias} onValueChange={setCopyCounterpartyAlias}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择明细认账到账别称" />
                </SelectTrigger>
                <SelectContent>
                  {counterpartyQuery.data?.items.map((item: any) => (
                    <SelectItem key={item.id} value={item.alias}>
                      {item.alias}（{item.detailPackageType || "T+1"}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-400">仅可选择到账信息汇总中认账类型为明细认账的到账别称</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCopyDialogOpen(false)} disabled={copyRule.isPending}>
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleCopy}
              disabled={copyRule.isPending || !copyRuleName.trim() || !copyCounterpartyAlias}
            >
              {copyRule.isPending ? "复制中..." : "确认复制"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>导出规则条件</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>选择规则 <span className="text-red-500">*</span></Label>
            <Select value={transferMode === "export" ? transferRuleId : ""} onValueChange={setTransferRuleId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="请选择要导出的规则" />
              </SelectTrigger>
              <SelectContent>
                {transferRules.map((rule) => (
                  <SelectItem key={rule.id} value={String(rule.id)}>{formatDetailRuleName(rule)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setExportDialogOpen(false)} disabled={exportQuery.isFetching}>
              取消
            </Button>
            <Button size="sm" onClick={handleExport} disabled={!transferRuleId || exportQuery.isFetching}>
              {exportQuery.isFetching ? "导出中..." : "导出"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>导入规则条件</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label>选择规则 <span className="text-red-500">*</span></Label>
            <Select value={transferMode === "import" ? transferRuleId : ""} onValueChange={setTransferRuleId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="请选择要导入到的规则" />
              </SelectTrigger>
              <SelectContent>
                {transferRules.map((rule) => (
                  <SelectItem key={rule.id} value={String(rule.id)}>{formatDetailRuleName(rule)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setImportDialogOpen(false)} disabled={importRules.isPending}>
              取消
            </Button>
            <Button size="sm" onClick={() => importInputRef.current?.click()} disabled={!transferRuleId || importRules.isPending}>
              {importRules.isPending ? "导入中..." : "选择CSV文件"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
