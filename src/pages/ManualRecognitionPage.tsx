import { useEffect, useState } from "react";
import { useParams } from "react-router";
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
import { toast } from "sonner";
import { ArrowLeft, Banknote } from "lucide-react";
import {
  ManualRecognitionForm,
  createManualSplit,
  createManualSplitForAmount,
  serializeManualRecognitionSplits,
  validateManualRecognitionSplits,
  type ManualSplit,
} from "@/components/ManualRecognitionForm";
import { IncomeRuleAmountRecognitionForm } from "@/components/IncomeRuleAmountRecognitionForm";
import { isSignedAmountWithinAvailable, sanitizeSignedDecimalInput, toSignedAmountCents } from "@/lib/signedAmount";

export default function ManualRecognitionPage() {
  const { taskId, flowId } = useParams<{ taskId: string; flowId: string }>();
  const tId = Number(taskId);
  const fId = Number(flowId);
  const [splits, setSplits] = useState<ManualSplit[]>([createManualSplit()]);
  const [recognitionAmount, setRecognitionAmount] = useState("");
  const [voucherReceiptChannelCode, setVoucherReceiptChannelCode] = useState("");
  const [manualValidationDialogMessage, setManualValidationDialogMessage] = useState("");

  const flowQuery = trpc.task.getFlows.useQuery(
    { taskId: tId, page: 1, pageSize: 500 },
    { enabled: !!tId }
  );
  const flow = flowQuery.data?.items.find((f: any) => f.id === fId);

  useEffect(() => {
    if (!flow) return;
    const availableAmount = Number(flow.recognitionAvailableAmount || flow.income || 0);
    setRecognitionAmount(availableAmount.toFixed(2));
    setSplits([createManualSplitForAmount(availableAmount, "income")]);
  }, [flow]);

  const manualRecognize = trpc.task.manualRecognize.useMutation({
    onSuccess: () => {
      toast.success("手动认账成功");
      window.close();
    },
    onError: (err: any) => toast.error(err.message || "认账失败"),
  });

  const handleSave = () => {
    if (!flow) return;
    const availableAmount = Number(flow.recognitionAvailableAmount || flow.income || 0);
    const nextRecognitionAmount = Number(recognitionAmount);
    if (!Number.isFinite(nextRecognitionAmount) || toSignedAmountCents(nextRecognitionAmount) === 0) {
      window.alert("认账金额不能为0");
      return;
    }
    if (!isSignedAmountWithinAvailable(nextRecognitionAmount, availableAmount)) {
      window.alert(`认账金额必须与可认账金额同方向，且绝对值不能超过 ${availableAmount.toFixed(2)}`);
      return;
    }
    const validationResult = validateManualRecognitionSplits(splits, nextRecognitionAmount);
    if (validationResult) {
      if (validationResult.presentation === "dialog") {
        setManualValidationDialogMessage(validationResult.message);
      } else {
        toast.error(validationResult.message);
      }
      return;
    }

    manualRecognize.mutate({
      flowId: fId,
      taskId: tId,
      recognitionAmount: nextRecognitionAmount.toFixed(2),
      voucherReceiptChannelCode: voucherReceiptChannelCode || null,
      splits: serializeManualRecognitionSplits(splits),
    });
  };

  if (!flow) {
    return (
      <div className="p-8">
        <Button variant="outline" size="sm" onClick={() => window.close()}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          关闭
        </Button>
        <div className="text-center py-12 text-gray-400">未找到该银行流水</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">{flow.pendingIncomeRuleRecognition ? "到账认账" : "手动认账"}</h1>
          <Button variant="outline" size="sm" onClick={() => window.close()}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            关闭
          </Button>
        </div>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Banknote className="h-5 w-5 text-blue-600" />
              <span className="font-semibold">银行流水信息</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><span className="text-gray-400">流水号：</span><span className="font-mono">{flow.referenceNo}</span></div>
              <div><span className="text-gray-400">交易时间：</span>{flow.transactionTime}</div>
              <div><span className="text-gray-400">金额：</span><span className="font-medium text-blue-700">{flow.income}</span></div>
              <div><span className="text-gray-400">对方户名：</span>{flow.counterpartyName || "-"}</div>
              <div><span className="text-gray-400">对方账号：</span>{flow.counterpartyAccount || "-"}</div>
              <div><span className="text-gray-400">用途：</span>{flow.purpose || "-"}</div>
              <div><span className="text-gray-400">附言：</span>{flow.postScript || "-"}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            {flow.pendingIncomeRuleRecognition ? (
              <IncomeRuleAmountRecognitionForm
                flow={flow}
                onCancel={() => window.close()}
                onSuccess={() => window.close()}
              />
            ) : (
              <ManualRecognitionForm
                selectedFlow={flow}
                manualRecognitionContext="income"
                splits={splits}
                onSplitsChange={setSplits}
                voucherReceiptChannelCode={voucherReceiptChannelCode}
                onVoucherReceiptChannelCodeChange={setVoucherReceiptChannelCode}
                amountSection={
                  <div className="grid max-w-lg grid-cols-2 gap-3 rounded-md border bg-white p-3">
                    <div className="space-y-1">
                      <Label className="text-xs">认账金额 <span className="text-red-500">*</span></Label>
                      <Input
                        className="h-9"
                        value={recognitionAmount}
                        onChange={(e) => setRecognitionAmount(sanitizeSignedDecimalInput(
                          e.target.value,
                          Number(flow.income || 0) < 0,
                        ))}
                        placeholder="请输入认账金额"
                        inputMode="decimal"
                      />
                    </div>
                    <div className="space-y-1 text-sm">
                      <div className="text-xs text-gray-500">可认账金额</div>
                      <div className="pt-2 font-semibold text-orange-700">
                        {Number(flow.recognitionAvailableAmount || flow.income || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>
                }
                footer={
                  <>
                    <Button variant="outline" size="sm" onClick={() => window.close()}>取消</Button>
                    <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={handleSave} disabled={manualRecognize.isPending}>
                      {manualRecognize.isPending ? "保存中..." : "确认认账"}
                    </Button>
                  </>
                }
              />
            )}
          </CardContent>
        </Card>
      </div>
      <AlertDialog
        open={Boolean(manualValidationDialogMessage)}
        onOpenChange={(open) => {
          if (!open) setManualValidationDialogMessage("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>分账校验失败</AlertDialogTitle>
            <AlertDialogDescription>{manualValidationDialogMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setManualValidationDialogMessage("")}>知道了</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
