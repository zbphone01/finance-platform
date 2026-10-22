import { useState } from "react";
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
import { Landmark, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

type VoucherReceiptChannelDraft = {
  id: number | null;
  channelCode: string;
  channelName: string;
};

function createVoucherReceiptChannel(id: number | null = null, channelCode = "", channelName = ""): VoucherReceiptChannelDraft {
  return { id, channelCode, channelName };
}

export default function IncomeChannelManagementPage() {
  const [voucherChannelFormMode, setVoucherChannelFormMode] = useState<"create" | "edit" | null>(null);
  const [voucherChannelForm, setVoucherChannelForm] = useState<VoucherReceiptChannelDraft>(createVoucherReceiptChannel());
  const utils = trpc.useUtils();

  const voucherReceiptChannelsQuery = trpc.counterparty.listVoucherReceiptChannels.useQuery();

  const createVoucherChannelMutation = trpc.counterparty.createVoucherReceiptChannel.useMutation({
    onSuccess: () => {
      utils.counterparty.listVoucherReceiptChannels.invalidate();
      toast.success("已新增");
      resetVoucherChannelForm();
    },
    onError: (err: any) => toast.error(err.message || "新增失败"),
  });

  const updateVoucherChannelMutation = trpc.counterparty.updateVoucherReceiptChannel.useMutation({
    onSuccess: () => {
      utils.counterparty.listVoucherReceiptChannels.invalidate();
      toast.success("已保存");
      resetVoucherChannelForm();
    },
    onError: (err: any) => toast.error(err.message || "保存失败"),
  });

  const deleteVoucherChannelMutation = trpc.counterparty.deleteVoucherReceiptChannel.useMutation({
    onSuccess: () => {
      utils.counterparty.listVoucherReceiptChannels.invalidate();
      toast.success("已删除");
    },
    onError: (err: any) => toast.error(err.message || "删除失败"),
  });

  const resetVoucherChannelForm = () => {
    setVoucherChannelFormMode(null);
    setVoucherChannelForm(createVoucherReceiptChannel());
  };

  const openCreateVoucherChannelForm = () => {
    setVoucherChannelFormMode("create");
    setVoucherChannelForm(createVoucherReceiptChannel());
  };

  const openEditVoucherChannelForm = (item: any) => {
    setVoucherChannelFormMode("edit");
    setVoucherChannelForm(createVoucherReceiptChannel(
      Number(item.id),
      item.channelCode || "",
      item.channelName || "",
    ));
  };

  const handleSaveVoucherChannel = () => {
    const channelCode = voucherChannelForm.channelCode.trim();
    const channelName = voucherChannelForm.channelName.trim();
    if (!channelCode) {
      toast.error("请输入收款渠道编号");
      return;
    }
    if (!channelName) {
      toast.error("请输入收款渠道名称");
      return;
    }
    if (voucherChannelFormMode === "edit" && voucherChannelForm.id) {
      updateVoucherChannelMutation.mutate({
        id: voucherChannelForm.id,
        channelCode,
        channelName,
      });
      return;
    }
    createVoucherChannelMutation.mutate({ channelCode, channelName });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">收款渠道管理</h1>
        <div className="flex items-center gap-4">
          <div className="flex gap-3 text-sm text-gray-500">
            <div className="flex items-center gap-1">
              <Landmark className="h-4 w-4 text-blue-600" />
              渠道: <span className="font-medium text-gray-700">{voucherReceiptChannelsQuery.data?.total || 0}</span>
            </div>
          </div>
          <Button onClick={openCreateVoucherChannelForm}>
            <Plus className="h-4 w-4 mr-1" />
            新增渠道
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>收款渠道编号</TableHead>
                  <TableHead>收款渠道名称</TableHead>
                  <TableHead className="w-24">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {voucherReceiptChannelsQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-8">加载中...</TableCell>
                  </TableRow>
                ) : voucherReceiptChannelsQuery.data?.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-8 text-gray-400">暂无收款渠道</TableCell>
                  </TableRow>
                ) : (
                  voucherReceiptChannelsQuery.data?.items.map((item: any) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-sm">{item.channelCode}</TableCell>
                      <TableCell>{item.channelName}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-blue-600 h-7 w-7 p-0"
                            onClick={() => openEditVoucherChannelForm(item)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-red-500"
                            disabled={deleteVoucherChannelMutation.isPending}
                            onClick={() => {
                              if (confirm("确定删除此收款渠道？")) {
                                deleteVoucherChannelMutation.mutate({ id: Number(item.id) });
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(voucherChannelFormMode)} onOpenChange={(open) => {
        if (!open) resetVoucherChannelForm();
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{voucherChannelFormMode === "edit" ? "编辑收款渠道" : "新增收款渠道"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>收款渠道编号 <span className="text-red-500">*</span></Label>
              <Input
                value={voucherChannelForm.channelCode}
                onChange={(event) => setVoucherChannelForm((item) => ({ ...item, channelCode: event.target.value }))}
                placeholder="请输入收款渠道编号"
                maxLength={100}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>收款渠道名称 <span className="text-red-500">*</span></Label>
              <Input
                value={voucherChannelForm.channelName}
                onChange={(event) => setVoucherChannelForm((item) => ({ ...item, channelName: event.target.value }))}
                placeholder="请输入收款渠道名称"
                maxLength={200}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={resetVoucherChannelForm}
              disabled={createVoucherChannelMutation.isPending || updateVoucherChannelMutation.isPending}
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={handleSaveVoucherChannel}
              disabled={createVoucherChannelMutation.isPending || updateVoucherChannelMutation.isPending}
            >
              {createVoucherChannelMutation.isPending || updateVoucherChannelMutation.isPending ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
