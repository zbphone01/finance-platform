import { useState } from "react";
import { Landmark, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type BankName = "广发银行" | "工商银行" | "中国银行";
type BankAccountDraft = {
  id: number | null;
  bankName: BankName;
  accountNo: string;
  accountAlias: string;
  sourceType: "upload" | "manual";
  isDefault: boolean;
};

function createDraft(): BankAccountDraft {
  return {
    id: null,
    bankName: "工商银行",
    accountNo: "",
    accountAlias: "",
    sourceType: "manual",
    isDefault: false,
  };
}

export default function BankAccountManagementPage() {
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [draft, setDraft] = useState<BankAccountDraft>(createDraft());
  const utils = trpc.useUtils();
  const listQuery = trpc.bankAccount.list.useQuery();

  const resetForm = () => {
    setFormMode(null);
    setDraft(createDraft());
  };

  const createMutation = trpc.bankAccount.create.useMutation({
    onSuccess: () => {
      utils.bankAccount.list.invalidate();
      toast.success("已新增银行账号");
      resetForm();
    },
    onError: (error: any) => toast.error(error.message || "新增失败"),
  });

  const updateMutation = trpc.bankAccount.update.useMutation({
    onSuccess: () => {
      utils.bankAccount.list.invalidate();
      toast.success("已保存银行账号");
      resetForm();
    },
    onError: (error: any) => toast.error(error.message || "保存失败"),
  });

  const openCreate = () => {
    setDraft(createDraft());
    setFormMode("create");
  };

  const openEdit = (item: any) => {
    setDraft({
      id: Number(item.id),
      bankName: item.bankName,
      accountNo: item.accountNo || "",
      accountAlias: item.accountAlias || "",
      sourceType: item.sourceType,
      isDefault: Boolean(item.isDefault),
    });
    setFormMode("edit");
  };

  const save = () => {
    const accountNo = draft.accountNo.replace(/\s+/g, "");
    if (!accountNo) {
      toast.error("请输入到账账号");
      return;
    }
    if (formMode === "edit" && draft.id) {
      updateMutation.mutate({
        id: draft.id,
        accountNo,
        accountAlias: draft.accountAlias.trim(),
        isDefault: draft.isDefault,
      });
      return;
    }
    createMutation.mutate({
      bankName: draft.bankName,
      accountNo,
      accountAlias: draft.accountAlias.trim(),
      isDefault: draft.isDefault,
    });
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">银行/到账账号</h1>
          <p className="mt-1 text-sm text-gray-500">广发银行账号由上传文件自动采集，工商银行和中国银行账号可手工维护。</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 text-sm text-gray-500">
            <Landmark className="h-4 w-4 text-blue-600" />
            账号：<span className="font-medium text-gray-700">{listQuery.data?.total || 0}</span>
          </div>
          <Button onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" />
            新增账号
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>银行</TableHead>
                  <TableHead>到账账号</TableHead>
                  <TableHead>凭证名称</TableHead>
                  <TableHead className="w-28">来源</TableHead>
                  <TableHead className="w-28">默认账号</TableHead>
                  <TableHead className="w-20">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center">加载中...</TableCell>
                  </TableRow>
                ) : listQuery.data?.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-gray-400">暂无银行账号</TableCell>
                  </TableRow>
                ) : listQuery.data?.items.map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.bankName}</TableCell>
                    <TableCell className="font-mono text-sm">{item.accountNo}</TableCell>
                    <TableCell>{item.accountAlias || <span className="text-gray-400">未设置</span>}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{item.sourceType === "upload" ? "上传采集" : "手工维护"}</Badge>
                    </TableCell>
                    <TableCell>
                      {item.isDefault ? <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">默认</Badge> : "-"}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-blue-600"
                        onClick={() => openEdit(item)}
                        title="编辑"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(formMode)} onOpenChange={(open) => !open && resetForm()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{formMode === "edit" ? "编辑银行账号" : "新增银行账号"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>银行</Label>
              <Select
                value={draft.bankName}
                disabled={formMode === "edit"}
                onValueChange={(value: BankName) => setDraft((current) => ({ ...current, bankName: value }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="广发银行">广发银行</SelectItem>
                  <SelectItem value="工商银行">工商银行</SelectItem>
                  <SelectItem value="中国银行">中国银行</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>到账账号 <span className="text-red-500">*</span></Label>
              <Input
                value={draft.accountNo}
                disabled={formMode === "edit" && draft.sourceType === "upload"}
                onChange={(event) => setDraft((current) => ({ ...current, accountNo: event.target.value }))}
                placeholder="请输入到账账号"
                maxLength={100}
                autoFocus={formMode === "create"}
              />
              {formMode === "edit" && draft.sourceType === "upload" && (
                <p className="text-xs text-gray-500">上传采集的账号不可修改，避免改变历史流水对应关系。</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>凭证名称</Label>
              <Input
                value={draft.accountAlias}
                onChange={(event) => setDraft((current) => ({ ...current, accountAlias: event.target.value }))}
                placeholder="例如：工商银行0733账户"
                maxLength={200}
              />
            </div>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3">
              <Checkbox
                className="mt-0.5"
                checked={draft.isDefault}
                onCheckedChange={(checked) => setDraft((current) => ({ ...current, isDefault: checked === true }))}
              />
              <span>
                <span className="block text-sm font-medium">设为该银行默认账号</span>
                <span className="block text-xs text-gray-500">文件不含本方账号时，银行流水将关联到默认账号。</span>
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetForm} disabled={saving}>取消</Button>
            <Button onClick={save} disabled={saving}>{saving ? "保存中..." : "保存"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
