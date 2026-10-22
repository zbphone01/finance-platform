import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { sanitizeSignedDecimalInput, toSignedAmountCents } from "@/lib/signedAmount";

type IncomeRuleAmountRecognitionFormProps = {
  flow: any;
  onCancel: () => void;
  onSuccess: () => void | Promise<void>;
};

type PendingAmountSplit = {
  id: number;
  incomeDept: string | null;
  incomeProject: string | null;
  budgetCode: string | null;
};

function toAmountCents(value: unknown) {
  const cents = toSignedAmountCents(String(value ?? "").trim() || 0);
  return Number.isFinite(cents) ? cents : 0;
}

function formatAmount(value: unknown) {
  return Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function IncomeRuleAmountRecognitionForm({
  flow,
  onCancel,
  onSuccess,
}: IncomeRuleAmountRecognitionFormProps) {
  const [amountBySplitId, setAmountBySplitId] = useState<Record<number, string>>({});
  const [voucherReceiptChannelCode, setVoucherReceiptChannelCode] = useState("");
  const [validationMessage, setValidationMessage] = useState("");
  const contextQuery = trpc.incomeRule.getPendingAmountRecognition.useQuery(
    { flowId: Number(flow.id) },
    { enabled: Boolean(flow.id) },
  );
  const voucherReceiptChannelsQuery = trpc.counterparty.listVoucherReceiptChannels.useQuery();
  const confirmMutation = trpc.incomeRule.confirmPendingAmountRecognition.useMutation({
    onSuccess: async () => {
      toast.success("认账成功");
      await onSuccess();
    },
    onError: (err: any) => toast.error(err.message || "认账失败"),
  });

  useEffect(() => {
    setAmountBySplitId({});
    setVoucherReceiptChannelCode("");
    setValidationMessage("");
  }, [flow.id]);

  const splits = (contextQuery.data?.splits || []) as PendingAmountSplit[];
  const recognitionAmountCents = useMemo(() => splits.reduce(
    (sum: number, split: PendingAmountSplit) => sum + toAmountCents(amountBySplitId[Number(split.id)]),
    0,
  ), [amountBySplitId, splits]);
  const recognitionAmount = (recognitionAmountCents / 100).toFixed(2);
  const availableAmountCents = toAmountCents(contextQuery.data?.availableAmount || flow.recognitionAvailableAmount || flow.income || 0);

  const handleConfirm = () => {
    if (!contextQuery.data) return;
    if (recognitionAmountCents !== availableAmountCents) {
      setValidationMessage(
        `认账金额合计必须等于可认账金额 ${(availableAmountCents / 100).toFixed(2)}，当前为 ${recognitionAmount}`,
      );
      return;
    }
    confirmMutation.mutate({
      flowId: Number(flow.id),
      voucherReceiptChannelCode: voucherReceiptChannelCode || null,
      splits: splits.map((split: PendingAmountSplit) => ({
        splitId: Number(split.id),
        recognitionAmount: amountBySplitId[Number(split.id)] || null,
      })),
    });
  };

  if (contextQuery.isLoading) {
    return <div className="py-8 text-center text-sm text-gray-500">正在加载分账规则...</div>;
  }

  if (contextQuery.isError || !contextQuery.data) {
    return (
      <div className="space-y-4 py-6 text-center">
        <div className="text-sm text-red-600">{contextQuery.error?.message || "无法加载待认账规则"}</div>
        <Button size="sm" variant="outline" onClick={onCancel}>关闭</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid max-w-lg grid-cols-2 gap-3 rounded-md border bg-white p-3">
        <div className="space-y-1 text-sm">
          <div className="text-xs text-gray-500">认账金额</div>
          <div className="pt-2 font-semibold text-blue-700">{formatAmount(recognitionAmount)}</div>
          <div className="text-xs text-gray-400">自动汇总下方各行认账金额</div>
        </div>
        <div className="space-y-1 text-sm">
          <div className="text-xs text-gray-500">可认账金额</div>
          <div className="pt-2 font-semibold text-orange-700">{formatAmount(contextQuery.data.availableAmount)}</div>
        </div>
      </div>

      <div className="max-w-lg rounded-md border bg-white p-3">
        <div className="space-y-1">
          <Label className="text-xs">收款渠道</Label>
          <Select
            value={voucherReceiptChannelCode || undefined}
            onValueChange={setVoucherReceiptChannelCode}
            disabled={voucherReceiptChannelsQuery.isLoading}
          >
            <SelectTrigger className="h-9 w-full">
              <SelectValue placeholder={voucherReceiptChannelsQuery.isLoading ? "加载渠道中..." : "请选择收款渠道"} />
            </SelectTrigger>
            <SelectContent>
              {voucherReceiptChannelsQuery.data?.items.map((item: any) => (
                <SelectItem key={item.id} value={item.channelCode}>{item.channelName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold">分账设置</span>
          <span className="text-xs text-gray-400">已应用规则：{contextQuery.data.ruleName}</span>
        </div>
        <div className="overflow-hidden rounded-md border bg-white">
          <Table className="table-auto">
            <TableHeader>
              <TableRow className="bg-gray-50">
                <TableHead className="w-px">部门</TableHead>
                <TableHead className="w-px">NC项目名称</TableHead>
                <TableHead className="w-px">预算编码</TableHead>
                <TableHead className="w-[180px] min-w-[180px]">认账金额</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {splits.map((split: PendingAmountSplit) => (
                <TableRow key={split.id}>
                  <TableCell className="w-px">{split.incomeDept || "-"}</TableCell>
                  <TableCell className="w-px">{split.incomeProject || "-"}</TableCell>
                  <TableCell className="w-px font-mono">{split.budgetCode || "-"}</TableCell>
                  <TableCell>
                    <Input
                      className="h-9 text-right"
                      value={amountBySplitId[Number(split.id)] || ""}
                      onChange={(event) => setAmountBySplitId((current) => ({
                        ...current,
                        [Number(split.id)]: sanitizeSignedDecimalInput(
                          event.target.value,
                          availableAmountCents < 0,
                        ),
                      }))}
                      placeholder="可留空"
                      inputMode="decimal"
                      aria-label={`分账 ${split.id} 认账金额`}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onCancel} disabled={confirmMutation.isPending}>取消</Button>
        <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={handleConfirm} disabled={confirmMutation.isPending}>
          {confirmMutation.isPending ? "保存中..." : "确认认账"}
        </Button>
      </div>

      <AlertDialog open={Boolean(validationMessage)} onOpenChange={(open) => !open && setValidationMessage("")}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>认账金额不一致</AlertDialogTitle>
            <AlertDialogDescription>{validationMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setValidationMessage("")}>知道了</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
