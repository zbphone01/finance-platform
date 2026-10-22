import { useState } from "react";
import { CheckCircle, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type RuleForm = {
  ruleName: string;
  dateField: string;
  timeField: string;
  incomeField: string;
  orderNoField: string;
  invoiceOtherOrderNo1Field: string;
  invoiceOtherOrderNo2Field: string;
  descriptionField: string;
};

const emptyForm: RuleForm = {
  ruleName: "",
  dateField: "",
  timeField: "时间",
  incomeField: "金额",
  orderNoField: "订单号",
  invoiceOtherOrderNo1Field: "",
  invoiceOtherOrderNo2Field: "",
  descriptionField: "商品名称",
};

export default function InvoiceOnlyRulesPage() {
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<RuleForm>(emptyForm);
  const { hasPermission } = usePermissions();
  const canDelete = hasPermission("recognition_rule_delete");
  const utils = trpc.useUtils();
  const rulesQuery = trpc.invoiceOnlyRule.list.useQuery({
    search: searchQuery || undefined,
    all: true,
  });
  const statsQuery = trpc.invoiceOnlyRule.stats.useQuery();
  const createRule = trpc.invoiceOnlyRule.create.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.invoiceOnlyRule.list.invalidate(),
        utils.invoiceOnlyRule.stats.invalidate(),
      ]);
      toast.success("不认账明细规则已创建");
      setDialogOpen(false);
    },
    onError: (error: any) => toast.error(error.message || "创建失败"),
  });
  const updateRule = trpc.invoiceOnlyRule.update.useMutation({
    onSuccess: async () => {
      await utils.invoiceOnlyRule.list.invalidate();
      toast.success("不认账明细规则已更新");
      setDialogOpen(false);
    },
    onError: (error: any) => toast.error(error.message || "更新失败"),
  });
  const toggleActive = trpc.invoiceOnlyRule.toggleActive.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.invoiceOnlyRule.list.invalidate(),
        utils.invoiceOnlyRule.stats.invalidate(),
      ]);
    },
    onError: (error: any) => toast.error(error.message || "更新状态失败"),
  });
  const deleteRule = trpc.invoiceOnlyRule.delete.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.invoiceOnlyRule.list.invalidate(),
        utils.invoiceOnlyRule.stats.invalidate(),
      ]);
      toast.success("不认账明细规则已删除");
    },
    onError: (error: any) => toast.error(error.message || "删除失败"),
  });

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (rule: any) => {
    setEditingId(Number(rule.id));
    setForm({
      ruleName: rule.ruleName || "",
      dateField: rule.dateField || "",
      timeField: rule.timeField || "",
      incomeField: rule.incomeField || "",
      orderNoField: rule.orderNoField || "",
      invoiceOtherOrderNo1Field: rule.invoiceOtherOrderNo1Field || "",
      invoiceOtherOrderNo2Field: rule.invoiceOtherOrderNo2Field || "",
      descriptionField: rule.descriptionField || "",
    });
    setDialogOpen(true);
  };

  const submit = () => {
    const payload = {
      ...form,
      invoiceOtherOrderNo1Field: form.invoiceOtherOrderNo1Field.trim() || null,
      invoiceOtherOrderNo2Field: form.invoiceOtherOrderNo2Field.trim() || null,
    };
    if (editingId) updateRule.mutate({ id: editingId, ...payload });
    else createRule.mutate(payload);
  };

  const pending = createRule.isPending || updateRule.isPending;
  const rules = rulesQuery.data?.items || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">不认账明细</h1>
        <div className="flex items-center gap-4">
          <div className="flex gap-3 text-sm text-gray-500">
            <span>规则：<span className="font-medium text-gray-700">{statsQuery.data?.total || 0}</span></span>
            <span className="flex items-center gap-1">
              <CheckCircle className="h-4 w-4 text-green-600" />
              启用：<span className="font-medium text-gray-700">{statsQuery.data?.active || 0}</span>
            </span>
          </div>
          <Button onClick={openCreate}><Plus className="mr-1 h-4 w-4" />新建规则</Button>
        </div>
      </div>

      <div className="flex gap-2">
        <Input
          className="w-64"
          placeholder="搜索规则名称"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button variant="outline" onClick={() => setSearchQuery(search)}>
          <Search className="mr-1 h-4 w-4" />搜索
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
                <TableHead>日期 / 时间字段</TableHead>
                <TableHead>收入字段</TableHead>
                <TableHead>订单号字段</TableHead>
                <TableHead>创建人</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rulesQuery.isLoading ? (
                <TableRow><TableCell colSpan={8} className="py-8 text-center">加载中...</TableCell></TableRow>
              ) : rules.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-gray-400">暂无不认账明细规则</TableCell></TableRow>
              ) : rules.map((rule: any) => (
                <TableRow key={rule.id}>
                  <TableCell className="font-mono text-xs">{rule.id}</TableCell>
                  <TableCell className="font-medium">{rule.ruleName}</TableCell>
                  <TableCell>
                    {rule.dateField
                      ? `${rule.dateField} / ${rule.timeField}`
                      : `${rule.timeField}（日期时间同列）`}
                  </TableCell>
                  <TableCell>{rule.incomeField}</TableCell>
                  <TableCell>{rule.orderNoField}</TableCell>
                  <TableCell>{rule.creator?.name || rule.creator?.username || "-"}</TableCell>
                  <TableCell>
                    <Switch
                      checked={Boolean(rule.isActive)}
                      disabled={toggleActive.isPending}
                      onCheckedChange={(isActive) => toggleActive.mutate({ id: Number(rule.id), isActive })}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-orange-500" onClick={() => openEdit(rule)} title="编辑">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className={`h-7 w-7 p-0 ${canDelete ? "text-red-500" : "text-gray-300"}`}
                        disabled={!canDelete || deleteRule.isPending}
                        onClick={() => {
                          if (confirm("确定删除此规则？")) deleteRule.mutate({ id: Number(rule.id) });
                        }}
                        title={canDelete ? "删除" : "无删除权限"}
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

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!pending) setDialogOpen(open); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "编辑不认账明细规则" : "新建不认账明细规则"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            {([
              ["ruleName", "规则名称", "例：某平台开票明细"],
              ["descriptionField", "订单描述字段", "例：商品名称"],
              ["dateField", "日期字段（选填）", "例：交易日期"],
              ["timeField", "时间字段", "例：交易时间；日期为空时需包含完整日期时间"],
              ["incomeField", "收入字段", "例：收入金额"],
              ["orderNoField", "订单号字段", "例：商户订单号"],
              ["invoiceOtherOrderNo1Field", "其他单号1字段（选填）", ""],
              ["invoiceOtherOrderNo2Field", "其他单号2字段（选填）", ""],
            ] as Array<[keyof RuleForm, string, string]>).map(([key, label, placeholder]) => (
              <div key={key} className="space-y-2">
                <Label>{label}{!label.includes("选填") && <span className="text-red-500"> *</span>}</Label>
                <Input
                  value={form[key]}
                  placeholder={placeholder}
                  onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500">
            日期字段填写时，上传会将日期和时间合并为订单时间；日期字段不填写时，直接从时间字段读取完整订单时间。该规则不包含任何认账、退款判断或明细分账设置。
          </p>
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setDialogOpen(false)}>取消</Button>
            <Button disabled={pending} onClick={submit}>{pending ? "保存中..." : "保存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
