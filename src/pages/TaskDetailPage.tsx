import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  FileCheck2,
  FileText,
  Banknote,
  ListOrdered,
  MoreHorizontal,
  Link2Off,
  RefreshCw,
  Trash2,
  Undo2,
} from "lucide-react";
import {
  ManualRecognitionForm,
  createManualSplit,
  createManualSplitForAmount,
  serializeManualRecognitionSplits,
  validateManualRecognitionSplits,
  type ManualSplit,
} from "@/components/ManualRecognitionForm";
import { IncomeRuleAmountRecognitionForm } from "@/components/IncomeRuleAmountRecognitionForm";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";
import { getRecognitionStatusMeta } from "@/lib/recognitionStatus";
import { isSignedAmountWithinAvailable, sanitizeSignedDecimalInput, toSignedAmountCents } from "@/lib/signedAmount";
import {
  bankFlowBankNames,
  getBankFlowDisplayColumns,
  type BankFlowBankName,
  type BankFlowDisplayField,
} from "@/lib/bankFlowDisplay";

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const taskId = parseInt(id || "0");
  const fromPage = Math.max(1, Number(searchParams.get("fromPage") || 1) || 1);
  const backPath = fromPage > 1 ? `/?page=${fromPage}` : "/";
  const initialTab = searchParams.get("tab") === "details"
    ? "details"
    : searchParams.get("tab") === "results"
      ? "results"
      : "flows";
  const [activeTab, setActiveTab] = useState(initialTab);
  const [bankName, setBankName] = useState<BankFlowBankName>("广发银行");
  const [flowDirection, setFlowDirection] = useState<"income" | "expense">("income");

  const taskQuery = trpc.task.getById.useQuery(
    { id: taskId },
    {
      enabled: taskId > 0,
      refetchOnMount: "always",
      refetchInterval: (query) => query.state.data?.status === "processing" ? 2000 : false,
    },
  );
  const task = taskQuery.data;

  const status = task ? getRecognitionStatusMeta(task.status) : null;
  const StatusIcon = status?.icon;

  if (taskQuery.isLoading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="text-gray-500">任务不存在或已被删除</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate(backPath)}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          返回
        </Button>
        <h1 className="text-xl font-semibold">日期汇总 - {task.billDate}</h1>
        {status && StatusIcon && (
          <Badge className={status.color}>
            <StatusIcon className="h-3 w-3 mr-1" />
            {status.label}
          </Badge>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">银行流水收入总额</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-700">
              ¥{Number(task.bankFlowIncomeTotal || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
            </div>
            <div className="text-xs text-gray-400 mt-1">{task.bankFlowCount || 0} 条流水</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">订单明细认账金额</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-700">
              ¥{Number(task.billDetailTotal || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
            </div>
            <div className="text-xs text-gray-400 mt-1">{task.billDetailCount || 0} 条明细</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">订单异常金额</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${Number(task.diffAmount || 0) > 0.01 ? "text-red-600" : "text-gray-700"}`}>
              {Number(task.diffAmount || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {Number(task.diffAmount || 0) > 0.01 ? "存在差异" : "无差异"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">认账情况</CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const recognizedBankFlowCount = Number(task.recognizedBankFlowCount || 0);
              const bankFlowCount = Number(task.bankFlowCount || 0);
              return (
                <>
                  <div className="text-2xl font-bold text-gray-700">
                    {recognizedBankFlowCount} <span className="text-sm font-normal text-gray-400">/ {bankFlowCount}</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-1">已认账 / 流水条数</div>
                </>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="flex items-center gap-4">
          <TabsList>
            <TabsTrigger value="flows">
              <Banknote className="h-4 w-4 mr-1" />
              银行流水
            </TabsTrigger>
            <TabsTrigger value="details">
              <ListOrdered className="h-4 w-4 mr-1" />
              订单明细
            </TabsTrigger>
            <TabsTrigger value="results">
              <FileText className="h-4 w-4 mr-1" />
              入账结果
            </TabsTrigger>
          </TabsList>
        </div>
        {activeTab === "flows" && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <Tabs
              value={bankName}
              onValueChange={(value) => setBankName(value as BankFlowBankName)}
              className="min-w-0"
            >
              <TabsList>
                {bankFlowBankNames.map((name) => (
                  <TabsTrigger key={name} value={name}>{name}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Tabs
              value={flowDirection}
              onValueChange={(value) => setFlowDirection(value as "income" | "expense")}
              className="w-fit shrink-0"
            >
              <TabsList>
                <TabsTrigger value="income">收入</TabsTrigger>
                <TabsTrigger value="expense">支出</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        )}

        <TabsContent value="flows">
          {activeTab === "flows" && (
            <BankFlowTable
              key={`${taskId}-${bankName}-${flowDirection}`}
              taskId={taskId}
              summaryStatus={task.status}
              bankName={bankName}
              flowDirection={flowDirection}
            />
          )}
        </TabsContent>

        <TabsContent value="details">
          {activeTab === "details" && <BillDetailTable taskId={taskId} summaryDate={task.billDate} summary={task} />}
        </TabsContent>

        <TabsContent value="results">
          {activeTab === "results" && <MatchResultTable taskId={taskId} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ====== 银行流水表格 ======
function BankFlowTable({
  taskId,
  summaryStatus,
  bankName,
  flowDirection,
}: {
  taskId: number;
  summaryStatus?: string;
  bankName: BankFlowBankName;
  flowDirection: "income" | "expense";
}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { hasPermission } = usePermissions();
  const canCancelRecognition = hasPermission("manual_recognition_cancel");
  const canCreateVouchers = hasPermission("voucher_create");
  const canDeleteBankFlow = hasPermission("bank_flow_delete");
  const canManageBankFlowMatch = hasPermission("bank_flow_match_manage");
  const [page, setPage] = useState(1);
  const [selectedFlow, setSelectedFlow] = useState<any>(null);
  const [deletingFlow, setDeletingFlow] = useState<any | null>(null);
  const [cancellingMatchFlow, setCancellingMatchFlow] = useState<any | null>(null);
  const [manualFormHighlight, setManualFormHighlight] = useState(false);
  const [splits, setSplits] = useState<ManualSplit[]>([createManualSplit()]);
  const [recognitionAmount, setRecognitionAmount] = useState("");
  const [voucherReceiptChannelCode, setVoucherReceiptChannelCode] = useState("");
  const [manualValidationDialogMessage, setManualValidationDialogMessage] = useState("");
  const [voucherCreationFlow, setVoucherCreationFlow] = useState<any | null>(null);
  const [manualVoucherRequirements, setManualVoucherRequirements] = useState<Array<{ incomeType: string; amount: string }>>([]);
  const [manualVoucherIds, setManualVoucherIds] = useState<Record<string, string>>({});
  const [voucherTemplateChoices, setVoucherTemplateChoices] = useState<Array<{
    templateType: string;
    requiresSelection: boolean;
    options: Array<{ id: string; name: string }>;
  }>>([]);
  const [voucherTemplateSelections, setVoucherTemplateSelections] = useState<Record<string, string>>({});
  const [needsInterestSummaryContent, setNeedsInterestSummaryContent] = useState(false);
  const [interestSummaryContent, setInterestSummaryContent] = useState("");
  const [interestSummaryPreview, setInterestSummaryPreview] = useState("");
  const [manualVoucherCancelFlow, setManualVoucherCancelFlow] = useState<any | null>(null);
  const [selectedManualVoucherResultId, setSelectedManualVoucherResultId] = useState(0);
  const [cancelRecognitionFlow, setCancelRecognitionFlow] = useState<any | null>(null);
  const [varianceCandidateFlow, setVarianceCandidateFlow] = useState<any | null>(null);
  const [selectedVarianceDetailIds, setSelectedVarianceDetailIds] = useState<number[]>([]);
  const [selectedVarianceTransferDetailIds, setSelectedVarianceTransferDetailIds] = useState<number[]>([]);
  const [partialTransferFlow, setPartialTransferFlow] = useState<any | null>(null);
  const [selectedPartialTransferDetailIds, setSelectedPartialTransferDetailIds] = useState<number[]>([]);
  const manualFormRef = useRef<HTMLDivElement | null>(null);
  const flowsQuery = trpc.task.getFlows.useQuery(
    { taskId, bankName, direction: flowDirection, page, pageSize: 40 },
    {
      refetchOnMount: "always",
    },
  );
  const refetchFlows = flowsQuery.refetch;
  const previousSummaryStatusRef = useRef(summaryStatus);
  useEffect(() => {
    const previousStatus = previousSummaryStatusRef.current;
    previousSummaryStatusRef.current = summaryStatus;
    if (previousStatus === "processing" && summaryStatus && summaryStatus !== "processing") {
      void refetchFlows();
    }
  }, [summaryStatus, refetchFlows]);
  const varianceCandidatesQuery = trpc.task.findVarianceIgnoreCandidates.useQuery(
    { flowId: Number(varianceCandidateFlow?.id || 0) },
    { enabled: Boolean(varianceCandidateFlow?.id) },
  );
  const partialTransferCandidatesQuery = trpc.task.findPartialTransferCandidates.useQuery(
    { flowId: Number(partialTransferFlow?.id || 0) },
    { enabled: Boolean(partialTransferFlow?.id) },
  );
  const utils = trpc.useUtils();

  const deleteBankFlow = trpc.task.deleteBankFlow.useMutation({
    onSuccess: async (result) => {
      const deletedFlowId = Number(deletingFlow?.id || 0);
      setDeletingFlow(null);
      if (Number(selectedFlow?.id || 0) === deletedFlowId) setSelectedFlow(null);
      if (page > 1 && Number(flowsQuery.data?.items.length || 0) <= 1) {
        setPage((current) => Math.max(1, current - 1));
      }

      if (Number(result.deletedTaskId || 0) === taskId) {
        if (Number(result.nextTaskId || 0) > 0) {
          const query = searchParams.toString();
          navigate(`/tasks/${result.nextTaskId}${query ? `?${query}` : ""}`, { replace: true });
        } else {
          const fromPage = Math.max(1, Number(searchParams.get("fromPage") || 1) || 1);
          navigate(fromPage > 1 ? `/?page=${fromPage}` : "/", { replace: true });
        }
      }

      await Promise.all([
        utils.task.getFlows.invalidate(),
        utils.task.getById.invalidate(),
        utils.task.list.invalidate(),
      ]);
      if (result.summaryRefreshFailed) {
        toast.warning("银行流水已删除，汇总状态刷新失败，请刷新页面确认");
      } else {
        toast.success("银行流水已删除");
      }
    },
    onError: (err: any) => toast.error(err.message || "删除银行流水失败"),
  });

  const cancelBankFlowArrivalMatch = trpc.task.cancelBankFlowArrivalMatch.useMutation({
    onSuccess: async () => {
      setCancellingMatchFlow(null);
      setSelectedFlow(null);
      await Promise.all([
        utils.task.getFlows.invalidate(),
        utils.task.getById.invalidate(),
        utils.task.list.invalidate(),
      ]);
      toast.success("已取消到账信息匹配，该流水不会自动认账");
    },
    onError: (err: any) => toast.error(err.message || "取消匹配失败"),
  });

  const rematchBankFlowArrival = trpc.task.rematchBankFlowArrival.useMutation({
    onSuccess: async (result) => {
      setSelectedFlow(null);
      await Promise.all([
        utils.task.getFlows.invalidate(),
        utils.task.getById.invalidate(),
        utils.task.list.invalidate(),
        utils.result.list.invalidate(),
      ]);
      if (result.kind === "matched") {
        toast.success(`已重新匹配到账信息：${result.aliases.join("、")}`);
      } else if (result.kind === "ambiguous") {
        toast.warning(`仍匹配到多个到账信息：${result.aliases.join("、")}`);
      } else {
        toast.warning("当前到账信息配置仍未匹配该流水");
      }
      if (Number(result.taskId || 0) > 0 && Number(result.taskId) !== taskId) {
        const query = searchParams.toString();
        navigate(`/tasks/${result.taskId}${query ? `?${query}` : ""}`, { replace: true });
      }
    },
    onError: (err: any) => toast.error(err.message || "重新匹配失败"),
  });

  const manualRecognize = trpc.task.manualRecognize.useMutation({
    onSuccess: () => {
      toast.success("手动认账成功");
      setSelectedFlow(null);
      setSplits([createManualSplit()]);
      setRecognitionAmount("");
      setVoucherReceiptChannelCode("");
      utils.task.getFlows.invalidate();
      utils.task.getById.invalidate();
      utils.result.list.invalidate();
    },
    onError: (err: any) => toast.error(err.message || "认账失败"),
  });
  const validateCreateVoucher = trpc.voucherSummary.validateCreateByFlow.useMutation({
    onSuccess: (_result, variables) => {
      setVoucherCreationFlow(null);
      setManualVoucherRequirements([]);
      setManualVoucherIds({});
      setVoucherTemplateChoices([]);
      setVoucherTemplateSelections({});
      setNeedsInterestSummaryContent(false);
      setInterestSummaryContent("");
      setInterestSummaryPreview("");
      utils.task.getFlows.invalidate();
      utils.voucherSummary.list.invalidate();
      utils.voucherSummary.previewByFlow.invalidate({ flowId: Number(variables.flowId) });
      utils.result.list.invalidate();
      utils.result.dayGroups.invalidate();
      toast.success("已完成制单");
    },
    onError: (err: any) => {
      const message = err.message || "生成凭证失败";
      window.alert(message);
      toast.error(message);
    },
  });
  const previewInterestSummary = trpc.voucherSummary.previewInterestSummaryByFlow.useMutation({
    onSuccess: (result) => setInterestSummaryPreview(result.interestSummaryPreview),
    onError: (err: any) => toast.error(err.message || "利息摘要预览生成失败"),
  });
  const prepareCreateVoucher = trpc.voucherSummary.prepareCreateByFlow.useMutation({
    onSuccess: (result, variables) => {
      if (result.alreadyCompleted) {
        setVoucherCreationFlow(null);
        setVoucherTemplateChoices([]);
        setVoucherTemplateSelections({});
        setNeedsInterestSummaryContent(false);
        setInterestSummaryContent("");
        setInterestSummaryPreview("");
        toast.success("该银行流水已完成制单");
        utils.task.getFlows.invalidate();
        return;
      }
      const initialTemplateSelections = Object.fromEntries(
        result.templateChoices.map((item) => [
          item.templateType,
          item.requiresSelection ? "" : (item.options[0]?.id || ""),
        ]),
      );
      if (result.manualVouchers.length === 0 && !result.needsInterestSummaryContent && !result.needsTemplateSelection) {
        validateCreateVoucher.mutate({
          flowId: Number(variables.flowId),
          manualVouchers: [],
          interestSummaryContent: "",
          templateSelections: result.templateChoices
            .filter((item) => item.options[0]?.id)
            .map((item) => ({
              templateType: item.templateType,
              templateId: item.options[0].id,
            })),
        });
        return;
      }
      setManualVoucherRequirements(result.manualVouchers);
      setManualVoucherIds(Object.fromEntries(result.manualVouchers.map((item) => [item.incomeType, ""])));
      setVoucherTemplateChoices(result.templateChoices);
      setVoucherTemplateSelections(initialTemplateSelections);
      setNeedsInterestSummaryContent(result.needsInterestSummaryContent);
      setInterestSummaryContent("");
      setInterestSummaryPreview(result.interestSummaryPreview);
    },
    onError: (err: any) => {
      const message = err.message || "制单检查失败";
      setVoucherCreationFlow(null);
      window.alert(message);
      toast.error(message);
    },
  });
  const manualVouchersQuery = trpc.voucherSummary.listManualByFlow.useQuery(
    { flowId: Number(manualVoucherCancelFlow?.id || 0) },
    { enabled: Boolean(manualVoucherCancelFlow?.id) && canCreateVouchers },
  );
  const cancelManualVoucher = trpc.voucherSummary.cancelManual.useMutation({
    onSuccess: async (result) => {
      toast.success(`已取消${result.incomeType}手工凭证`);
      setManualVoucherCancelFlow(null);
      setSelectedManualVoucherResultId(0);
      await Promise.all([
        utils.task.getFlows.invalidate(),
        utils.voucherSummary.list.invalidate(),
        utils.result.list.invalidate(),
        utils.result.dayGroups.invalidate(),
      ]);
    },
    onError: (err: any) => toast.error(err.message || "取消手工凭证失败"),
  });
  const cancelRecognitionQuery = trpc.task.getFlowRecognitionCancellation.useQuery(
    { flowId: Number(cancelRecognitionFlow?.id || 0) },
    { enabled: Boolean(cancelRecognitionFlow?.id) },
  );
  const refreshCancellationViews = async () => {
    await Promise.allSettled([
      utils.task.getFlowRecognitionCancellation.invalidate(),
      utils.task.getFlows.invalidate(),
      utils.task.getById.invalidate(),
      utils.task.list.invalidate(),
      utils.result.list.invalidate(),
      utils.result.dayGroups.invalidate(),
      utils.voucherSummary.list.invalidate(),
    ]);
  };
  const scheduleCancellationViewRefresh = () => {
    void refreshCancellationViews();
    for (const delay of [1000, 3000]) {
      window.setTimeout(() => {
        void refreshCancellationViews();
      }, delay);
    }
  };
  const cancelFlowRecognition = trpc.task.cancelFlowRecognition.useMutation({
    onSuccess: (result) => {
      setCancelRecognitionFlow(null);
      setSelectedFlow(null);
      toast.success(
        Number(result.orphanedDetailCount || 0) > 0
          ? `已清理残留入账结果并恢复银行流水状态`
          : result.scopeType === "multi_day"
          ? `已取消多日汇总 ${result.cancelledFlowCount} 笔到账的认账结果`
          : result.scopeType === "same_day"
            ? `已取消同日汇总 ${result.cancelledFlowCount} 笔到账的认账结果`
            : "已取消该银行到账的全部认账结果",
      );
      scheduleCancellationViewRefresh();
    },
    onError: async (err: any, variables) => {
      try {
        await utils.task.getFlowRecognitionCancellation.invalidate({ flowId: Number(variables.flowId) });
        const latest = await utils.task.getFlowRecognitionCancellation.fetch({
          flowId: Number(variables.flowId),
        });
        if (Number(latest.resultCount || 0) === 0) {
          setCancelRecognitionFlow(null);
          setSelectedFlow(null);
          toast.success("认账结果已取消，页面状态正在刷新");
          scheduleCancellationViewRefresh();
          return;
        }
      } catch {
        // Keep the original error when the committed state cannot be confirmed.
      }
      toast.error(err.message || "取消认账失败");
    },
  });
  const batchMarkIgnore = trpc.task.batchMarkIgnore.useMutation({
    onSuccess: async (result) => {
      toast.success(
        result.transferredCount > 0
          ? `已忽略 ${result.ignoredCount || 0} 条、转移 ${result.transferredCount || 0} 条订单明细，已自动重新认账`
          : `已忽略 ${result.ignoredCount || 0} 条订单明细，已自动重新认账`,
      );
      setVarianceCandidateFlow(null);
      setSelectedVarianceDetailIds([]);
      setSelectedVarianceTransferDetailIds([]);
      await Promise.all([
        utils.task.getFlows.invalidate(),
        utils.task.getById.invalidate(),
        utils.task.getDetails.invalidate(),
        utils.task.list.invalidate(),
        utils.task.listIgnoredDetails.invalidate(),
        utils.result.list.invalidate(),
        utils.result.dayGroups.invalidate(),
      ]);
    },
    onError: (err: any) => toast.error(err.message || "批量忽略失败"),
  });
  const transferIgnoredDetailsAndRecognize = trpc.task.transferIgnoredDetailsAndRecognize.useMutation({
    onSuccess: async (result) => {
      toast.success(`已转移 ${result.transferredCount || 0} 条 T+1 订单明细，已自动增量认账`);
      setPartialTransferFlow(null);
      setSelectedPartialTransferDetailIds([]);
      await Promise.all([
        utils.task.getFlows.invalidate(),
        utils.task.getById.invalidate(),
        utils.task.getDetails.invalidate(),
        utils.task.list.invalidate(),
        utils.task.listIgnoredDetails.invalidate(),
        utils.result.list.invalidate(),
        utils.result.dayGroups.invalidate(),
      ]);
    },
    onError: (err: any) => toast.error(err.message || "转移并补认账失败"),
  });

  useEffect(() => {
    const data = varianceCandidatesQuery.data;
    if (!data) return;
    const ids = (data.selectedIds || []).map(Number);
    setSelectedVarianceDetailIds(ids.length > 0
      ? ids
      : data.items?.length === 1
        ? [Number(data.items[0].id)]
        : []);
    setSelectedVarianceTransferDetailIds((data.selectedTransferIds || []).map(Number));
  }, [varianceCandidatesQuery.data]);

  useEffect(() => {
    const data = partialTransferCandidatesQuery.data;
    if (!data) return;
    setSelectedPartialTransferDetailIds((data.suggestedIds || []).map(Number));
  }, [partialTransferCandidatesQuery.data]);

  useEffect(() => {
    if (!manualVoucherCancelFlow) {
      setSelectedManualVoucherResultId(0);
      return;
    }
    const items = manualVouchersQuery.data?.items || [];
    if (items.length === 0) {
      setSelectedManualVoucherResultId(0);
      return;
    }
    if (items.some((item) => Number(item.voucherResultId) === selectedManualVoucherResultId)) return;
    setSelectedManualVoucherResultId(Number(items[0].voucherResultId));
  }, [manualVoucherCancelFlow, manualVouchersQuery.data, selectedManualVoucherResultId]);

  const handleSave = () => {
    if (!selectedFlow) return;
    const availableAmount = Number(selectedFlow.recognitionAvailableAmount || selectedFlow.income || 0);
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
      flowId: selectedFlow.id,
      taskId,
      recognitionAmount: nextRecognitionAmount.toFixed(2),
      voucherReceiptChannelCode: voucherReceiptChannelCode || null,
      splits: serializeManualRecognitionSplits(splits),
    });
  };

  const selectFlow = (f: any) => {
    if (f.recognitionEligible && ["unrecognized", "partial_matched", "variance_unrecognized", "variance_partial_matched"].includes(f.status)) {
      const availableAmount = Number(f.recognitionAvailableAmount || f.income || 0);
      setSelectedFlow(f);
      setSplits([createManualSplitForAmount(availableAmount, "income")]);
      setVoucherReceiptChannelCode("");
      setRecognitionAmount(availableAmount.toFixed(2));
      setManualFormHighlight(true);
      window.setTimeout(() => {
        manualFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
      window.setTimeout(() => setManualFormHighlight(false), 1600);
    }
  };

  const createVoucher = (f: any) => {
    setVoucherCreationFlow(f);
    setManualVoucherRequirements([]);
    setManualVoucherIds({});
    setVoucherTemplateChoices([]);
    setVoucherTemplateSelections({});
    setNeedsInterestSummaryContent(false);
    setInterestSummaryContent("");
    setInterestSummaryPreview("");
    prepareCreateVoucher.mutate({ flowId: Number(f.id) });
  };

  const confirmCreateVoucher = () => {
    if (!voucherCreationFlow) return;
    const missingRequirement = manualVoucherRequirements.find((item) => !String(manualVoucherIds[item.incomeType] || "").trim());
    if (missingRequirement) {
      toast.error(`请填写${missingRequirement.incomeType}凭证ID`);
      return;
    }
    const missingTemplate = voucherTemplateChoices.find((item) =>
      item.requiresSelection && !String(voucherTemplateSelections[item.templateType] || "").trim()
    );
    if (missingTemplate) {
      toast.error(`请选择${missingTemplate.templateType}的模板名称`);
      return;
    }
    validateCreateVoucher.mutate({
      flowId: Number(voucherCreationFlow.id),
      manualVouchers: manualVoucherRequirements.map((item) => ({
        incomeType: item.incomeType as any,
        voucherId: manualVoucherIds[item.incomeType].trim(),
      })),
      interestSummaryContent: interestSummaryContent.trim(),
      templateSelections: voucherTemplateChoices
        .filter((item) => voucherTemplateSelections[item.templateType])
        .map((item) => ({
          templateType: item.templateType as any,
          templateId: voucherTemplateSelections[item.templateType],
        })),
    });
  };

  const canShowCancelRecognition = (f: any) => {
    return Boolean(f.canCancelRecognition) &&
      (f.status === "recognized" || f.status === "partial_matched" || f.status === "variance_partial_matched");
  };

  const renderCancelRecognitionButton = (f: any) => {
    if (!canShowCancelRecognition(f)) return null;
    const pending = cancelFlowRecognition.isPending && Number(cancelRecognitionFlow?.id) === Number(f.id);
    return (
      <button
        type="button"
        title={canCancelRecognition ? "取消认账" : "无取消认账权限"}
        aria-label="取消认账"
        className={`inline-flex h-6 w-6 items-center justify-center rounded disabled:cursor-not-allowed disabled:opacity-60 ${canCancelRecognition ? "text-orange-600 hover:bg-orange-50 hover:text-orange-700" : "text-gray-300"}`}
        disabled={!canCancelRecognition || pending}
        onClick={() => setCancelRecognitionFlow(f)}
      >
        <Undo2 className="h-4 w-4" />
      </button>
    );
  };

  const handleConfirmCancelRecognition = () => {
    if (!cancelRecognitionFlow) return;
    if (!cancelRecognitionQuery.data?.canCancel) {
      toast.error(cancelRecognitionQuery.data?.message || "没有可取消的认账结果");
      return;
    }
    cancelFlowRecognition.mutate({
      flowId: Number(cancelRecognitionFlow.id),
    });
  };

  const renderVoucherStatusBadge = (f: any, label: string) => {
    const hasGeneratedVoucher = Boolean(f.hasGeneratedVoucher);
    const hasManualVoucher = Boolean(f.hasManualVoucher);
    if (!hasGeneratedVoucher && !hasManualVoucher) {
      return <Badge className="bg-green-100 text-green-800">{label}</Badge>;
    }
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            <Badge className="bg-green-100 text-green-800 hover:bg-green-200 cursor-pointer">{label}</Badge>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {hasGeneratedVoucher && (
            <DropdownMenuItem onClick={() => navigate(`/voucher-results/${f.id}`)}>
              查看凭证
            </DropdownMenuItem>
          )}
          {hasManualVoucher && (
            <DropdownMenuItem
              disabled={!canCreateVouchers}
              onClick={() => {
                setSelectedManualVoucherResultId(0);
                setManualVoucherCancelFlow(f);
              }}
            >
              取消手工凭证
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const renderDeleteFlowButton = (f: any) => {
    const pending = deleteBankFlow.isPending && Number(deletingFlow?.id || 0) === Number(f.id);
    const deleteLocked = Boolean(f.deleteLocked);
    const canDelete = canDeleteBankFlow && !deleteLocked;
    return (
      <button
        type="button"
        title={deleteLocked ? "已绑定订单明细包，不能单独删除" : canDeleteBankFlow ? "删除该银行流水" : "无删除银行到账权限"}
        aria-label="删除该银行流水"
        className={`inline-flex h-6 w-6 items-center justify-center rounded disabled:cursor-not-allowed disabled:opacity-60 ${canDelete ? "text-red-500 hover:bg-red-50 hover:text-red-700" : "text-gray-300"}`}
        disabled={!canDelete || pending}
        onClick={() => setDeletingFlow(f)}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    );
  };

  const renderArrivalMatchButton = (f: any) => {
    if (!f.recognitionEligible || f.status !== "unrecognized") return null;
    if (f.pendingMatchedRecognition) {
      const pending = cancelBankFlowArrivalMatch.isPending
        && Number(cancellingMatchFlow?.id || 0) === Number(f.id);
      return (
        <button
          type="button"
          title={canManageBankFlowMatch ? "取消到账信息匹配" : "无管理银行到账匹配权限"}
          aria-label="取消到账信息匹配"
          className={`inline-flex h-6 w-6 items-center justify-center rounded disabled:cursor-not-allowed disabled:opacity-60 ${canManageBankFlowMatch ? "text-orange-600 hover:bg-orange-50 hover:text-orange-700" : "text-gray-300"}`}
          disabled={!canManageBankFlowMatch || pending}
          onClick={() => setCancellingMatchFlow(f)}
        >
          <Link2Off className="h-4 w-4" />
        </button>
      );
    }
    return (
      <button
        type="button"
        title={canManageBankFlowMatch ? "使用当前到账信息配置重新匹配" : "无管理银行到账匹配权限"}
        aria-label="重新匹配到账信息"
        className={`inline-flex h-6 w-6 items-center justify-center rounded disabled:cursor-not-allowed disabled:opacity-60 ${canManageBankFlowMatch ? "text-blue-600 hover:bg-blue-50 hover:text-blue-700" : "text-gray-300"}`}
        disabled={!canManageBankFlowMatch || rematchBankFlowArrival.isPending}
        onClick={() => rematchBankFlowArrival.mutate({ flowId: Number(f.id) })}
      >
        <RefreshCw className={`h-4 w-4 ${rematchBankFlowArrival.isPending ? "animate-spin" : ""}`} />
      </button>
    );
  };

  const renderStatusCell = (f: any) => {
    if (!f.recognitionEligible) {
      return (
        <div className="flex items-center justify-center gap-1">
          {renderDeleteFlowButton(f)}
        </div>
      );
    }
    if (f.status === "processing") {
      return <Badge className="bg-blue-100 text-blue-800">认账执行中</Badge>;
    }
    if (f.status === "recognized") {
      const hasVoucher = Boolean(f.hasVoucher);
      if (hasVoucher) {
        return (
          <div className="flex items-center justify-center gap-1">
            {renderVoucherStatusBadge(f, "已认账/已制单")}
          </div>
        );
      }
      return (
        <div className="flex items-center justify-center gap-1">
          {renderVoucherStatusBadge(f, "已认账")}
          {renderCancelRecognitionButton(f)}
          <button
            type="button"
            title={canCreateVouchers ? "生成凭证" : "无制单权限"}
            aria-label="生成凭证"
            className={`inline-flex h-6 w-6 items-center justify-center rounded disabled:cursor-not-allowed disabled:opacity-60 ${canCreateVouchers ? "text-green-600 hover:bg-green-50 hover:text-green-700" : "text-gray-300"}`}
            disabled={!canCreateVouchers || prepareCreateVoucher.isPending || validateCreateVoucher.isPending}
            onClick={() => createVoucher(f)}
          >
            <FileCheck2 className="h-4 w-4" />
          </button>
        </div>
      );
    }
    if (f.status === "variance_partial_matched") {
      return (
        <div className="flex items-center justify-center gap-1">
          <Badge className="bg-red-100 text-red-800 hover:bg-red-200 cursor-pointer" title="因认账差额跳过后续自动认账" onClick={() => selectFlow(f)}>部分认账</Badge>
          {renderCancelRecognitionButton(f)}
        </div>
      );
    }
    if (f.status === "variance_unrecognized") {
      return (
        <div className="flex items-center justify-center gap-1">
          <Badge className="bg-red-100 text-red-800" title="因认账差额跳过自动认账">未认账</Badge>
          {renderDeleteFlowButton(f)}
        </div>
      );
    }
    if (f.status === "partial_matched") {
      return (
        <div className="flex items-center justify-center gap-1">
          <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-200 cursor-pointer" onClick={() => selectFlow(f)}>部分认账</Badge>
          {renderCancelRecognitionButton(f)}
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center gap-1">
        <Badge
          title={f.pendingMatchedRecognition ? f.matchedCounterpartyAlias || undefined : undefined}
          className={f.pendingMatchedRecognition
            ? `bg-orange-100 text-orange-800 ${f.pendingIncomeRuleRecognition ? "hover:bg-orange-200 cursor-pointer" : ""}`
            : "bg-gray-100 text-gray-600 hover:bg-blue-100 hover:text-blue-700 cursor-pointer"}
          onClick={() => {
            if (!f.pendingMatchedRecognition || f.pendingIncomeRuleRecognition) selectFlow(f);
          }}
        >
          {f.pendingMatchedRecognition ? "待认账" : "未认账"}
        </Badge>
        {renderArrivalMatchButton(f)}
        {renderDeleteFlowButton(f)}
      </div>
    );
  };

  const hasRecognitionDiffAmount = (flow: any) => Number(flow.recognitionDiffAmount || 0) > 0.01;
  const isPartialRecognitionFlow = (flow: any) => flow.status === "partial_matched" || flow.status === "variance_partial_matched";
  const formatAmount = (amount: any) => Number(amount || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 });
  const toggleVarianceDetail = (detailId: number) => {
    setSelectedVarianceDetailIds((current) => current.includes(detailId)
      ? current.filter((id) => id !== detailId)
      : [...current, detailId]);
  };
  const varianceCandidateItems = varianceCandidatesQuery.data?.items || [];
  const varianceTransferCandidateItems = varianceCandidatesQuery.data?.transferItems || [];
  const varianceTargetCents = Math.round(Number(
    varianceCandidatesQuery.data?.diffAmount || varianceCandidateFlow?.recognitionDiffAmount || 0,
  ) * 100);
  const selectedVarianceCents = varianceCandidateItems
    .filter((item: any) => selectedVarianceDetailIds.includes(Number(item.id)))
    .reduce((sum: number, item: any) => sum + Math.round(Number(item.amount || 0) * 100), 0);
  const selectedVarianceAmount = selectedVarianceCents / 100;
  const selectedVarianceTransferCents = varianceTransferCandidateItems
    .filter((item: any) => selectedVarianceTransferDetailIds.includes(Number(item.id)))
    .reduce((sum: number, item: any) => sum + Math.round(Number(item.amount || 0) * 100), 0);
  const selectedVarianceTransferAmount = selectedVarianceTransferCents / 100;
  const selectedVarianceNetCents = selectedVarianceCents - selectedVarianceTransferCents;
  const selectedVarianceNetAmount = selectedVarianceNetCents / 100;
  const varianceAmountMatched = varianceTargetCents > 0 && selectedVarianceNetCents === varianceTargetCents;
  const toggleVarianceTransferDetail = (detailId: number) => {
    setSelectedVarianceTransferDetailIds((current) => current.includes(detailId)
      ? current.filter((id) => id !== detailId)
      : [...current, detailId]);
  };
  const partialTransferCandidateItems = partialTransferCandidatesQuery.data?.items || [];
  const partialRecognitionAvailableCents = Math.round(Number(
    partialTransferCandidatesQuery.data?.recognitionAvailableAmount
      ?? partialTransferFlow?.recognitionAvailableAmount
      ?? 0,
  ) * 100);
  const partialPendingSplitCents = Math.round(Number(
    partialTransferCandidatesQuery.data?.pendingSplitAmount ?? 0,
  ) * 100);
  const partialTransferTargetCents = Math.round(Number(
    partialTransferCandidatesQuery.data?.transferTargetAmount
      ?? partialTransferCandidatesQuery.data?.availableAmount
      ?? partialTransferFlow?.recognitionAvailableAmount
      ?? 0,
  ) * 100);
  const selectedPartialTransferCents = partialTransferCandidateItems
    .filter((item: any) => selectedPartialTransferDetailIds.includes(Number(item.id)))
    .reduce((sum: number, item: any) => sum + Math.round(Number(item.amount || 0) * 100), 0);
  const selectedPartialTransferAmount = selectedPartialTransferCents / 100;
  const partialTransferAmountMatched = partialTransferTargetCents > 0
    && selectedPartialTransferCents === partialTransferTargetCents;
  const togglePartialTransferDetail = (detailId: number) => {
    setSelectedPartialTransferDetailIds((current) => current.includes(detailId)
      ? current.filter((id) => id !== detailId)
      : [...current, detailId]);
  };
  const showRecognitionDiffColumn = flowDirection === "income" && (
    summaryStatus === "large_variance" || !!flowsQuery.data?.items.some(
      (flow: any) => hasRecognitionDiffAmount(flow) || isPartialRecognitionFlow(flow),
    )
  );
  const displayColumns = getBankFlowDisplayColumns(bankName, flowDirection);
  const emptyColSpan = displayColumns.length + (showRecognitionDiffColumn ? 1 : 0) + 1;
  const renderFlowField = (flow: any, field: BankFlowDisplayField) => {
    if (field === "amount") {
      return flowDirection === "expense"
        ? formatAmount(Math.abs(Number(flow.income || 0)))
        : flow.income;
    }
    return flow[field] || "-";
  };
  const getFlowFieldClassName = (field: BankFlowDisplayField) => {
    if (field === "id" || field === "referenceNo" || field === "counterpartyAccount") {
      return "font-mono text-xs";
    }
    if (field === "transactionTime") return "text-xs text-gray-600";
    if (field === "amount") {
      return flowDirection === "expense" ? "font-medium text-red-700" : "font-medium text-blue-700";
    }
    if (field === "summary") return "max-w-[150px] truncate text-xs";
    if (field === "purpose" || field === "postScript") {
      return "min-w-[220px] max-w-[360px] whitespace-normal break-words text-xs";
    }
    return "text-xs";
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-0">
          <div className="text-sm text-gray-500 p-4 pb-0">共 {flowsQuery.data?.total || 0} 条</div>
          <div className="overflow-auto">
            <Table className="w-max min-w-full table-auto">
              <TableHeader>
                <TableRow>
                  {displayColumns.map((column) => (
                    <TableHead key={column.field}>{column.label}</TableHead>
                  ))}
                  {showRecognitionDiffColumn && (
                    <TableHead className="sticky right-[160px] z-30 w-[120px] min-w-[120px] max-w-[120px] bg-white text-right shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]">差额金额</TableHead>
                  )}
                  <TableHead
                    className={flowDirection === "expense"
                      ? "text-center"
                      : "sticky right-0 z-30 w-[160px] min-w-[160px] max-w-[160px] bg-white text-center"}
                  >
                    {flowDirection === "expense" ? "操作" : "状态"}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flowsQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={emptyColSpan} className="text-center py-8">加载中...</TableCell>
                  </TableRow>
                ) : flowsQuery.data?.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={emptyColSpan} className="text-center py-8 text-gray-400">
                      {flowDirection === "expense" ? "暂无支出流水" : "暂无收入流水"}
                    </TableCell>
                  </TableRow>
                ) : (
                  flowsQuery.data?.items.map((f: any) => (
                    <TableRow
                      key={f.id}
                      className={`group ${selectedFlow?.id === f.id ? "bg-blue-50 hover:bg-blue-50" : ""}`}
                    >
                      {displayColumns.map((column) => (
                        <TableCell
                          key={column.field}
                          className={getFlowFieldClassName(column.field)}
                          title={column.field === "purpose" || column.field === "postScript"
                            ? String(f[column.field] || "")
                            : undefined}
                        >
                          {renderFlowField(f, column.field)}
                        </TableCell>
                      ))}
                      {showRecognitionDiffColumn && (
                        <TableCell className={`sticky right-[160px] z-20 w-[120px] min-w-[120px] max-w-[120px] text-right font-medium shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)] ${selectedFlow?.id === f.id ? "bg-blue-50 group-hover:bg-blue-50" : "bg-white group-hover:bg-zinc-50 dark:bg-zinc-950 dark:group-hover:bg-zinc-900"}`}>
                          {hasRecognitionDiffAmount(f) ? (
                            <button
                              type="button"
                              className="text-red-700 underline-offset-2 hover:underline"
                              title="查找可忽略订单明细"
                              onClick={() => {
                                setVarianceCandidateFlow(f);
                                setSelectedVarianceDetailIds([]);
                                setSelectedVarianceTransferDetailIds([]);
                              }}
                            >
                              {formatAmount(f.recognitionDiffAmount)}
                            </button>
                          ) : f.status === "partial_matched" ? (
                            <button
                              type="button"
                              className="text-sky-700 underline-offset-2 hover:underline"
                              title="查找可转移的 T+1 已忽略订单并补认账"
                              onClick={() => {
                                setPartialTransferFlow(f);
                                setSelectedPartialTransferDetailIds([]);
                              }}
                            >
                              {formatAmount(f.recognitionAvailableAmount)}
                            </button>
                          ) : isPartialRecognitionFlow(f) ? (
                            <span className="text-sky-700">{formatAmount(f.recognitionAvailableAmount)}</span>
                          ) : "-"}
                        </TableCell>
                      )}
                      <TableCell
                        className={flowDirection === "expense"
                          ? "text-center"
                          : `sticky right-0 z-20 w-[160px] min-w-[160px] max-w-[160px] text-center ${selectedFlow?.id === f.id ? "bg-blue-50 group-hover:bg-blue-50" : "bg-white group-hover:bg-zinc-50 dark:bg-zinc-950 dark:group-hover:bg-zinc-900"}`}
                      >
                        {renderStatusCell(f)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {flowsQuery.data && flowsQuery.data.total > 40 && (
            <div className="flex justify-center p-4 gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>上一页</Button>
              <span className="text-sm text-gray-500 self-center">第 {page} 页 / 共 {Math.ceil((flowsQuery.data?.total || 0) / 40)} 页</span>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page * 40 >= (flowsQuery.data?.total || 0)}>下一页</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={Boolean(deletingFlow)}
        onOpenChange={(open) => {
          if (!open && !deleteBankFlow.isPending) setDeletingFlow(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除银行流水？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除流水 {deletingFlow?.referenceNo || "-"}，交易时间 {deletingFlow?.transactionTime || "-"}，
              {Number(deletingFlow?.income || 0) < 0 ? "支出" : "收入"} {formatAmount(Math.abs(Number(deletingFlow?.income || 0)))} 元。此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBankFlow.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={deleteBankFlow.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (deletingFlow) deleteBankFlow.mutate({ flowId: Number(deletingFlow.id) });
              }}
            >
              {deleteBankFlow.isPending ? "删除中..." : "确认删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(cancellingMatchFlow)}
        onOpenChange={(open) => {
          if (!open && !cancelBankFlowArrivalMatch.isPending) setCancellingMatchFlow(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认取消到账信息匹配？</AlertDialogTitle>
            <AlertDialogDescription>
              流水 {cancellingMatchFlow?.referenceNo || "-"} 将变为未认账，并停止自动认账。之后可使用“重新匹配”再次按当前到账信息配置匹配。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelBankFlowArrivalMatch.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-orange-600 text-white hover:bg-orange-700"
              disabled={cancelBankFlowArrivalMatch.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (cancellingMatchFlow) {
                  cancelBankFlowArrivalMatch.mutate({ flowId: Number(cancellingMatchFlow.id) });
                }
              }}
            >
              {cancelBankFlowArrivalMatch.isPending ? "处理中..." : "确认取消匹配"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={Boolean(varianceCandidateFlow)}
        onOpenChange={(open) => {
          if (!open && !batchMarkIgnore.isPending) {
            setVarianceCandidateFlow(null);
            setSelectedVarianceDetailIds([]);
            setSelectedVarianceTransferDetailIds([]);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-hidden sm:max-w-[980px]">
          <DialogHeader>
            <DialogTitle>确认异常金额调整订单</DialogTitle>
          </DialogHeader>
          <div className="max-h-[calc(90vh-9rem)] min-w-0 space-y-3 overflow-y-auto pr-1">
            <div className="grid min-w-0 grid-cols-2 gap-3 rounded-md border bg-gray-50 p-3 text-sm md:grid-cols-5">
              <div className="min-w-0">
                <div className="text-xs text-gray-500">流水号</div>
                <div className="mt-1 truncate font-mono text-xs text-gray-800" title={varianceCandidateFlow?.referenceNo || ""}>{varianceCandidateFlow?.referenceNo || "-"}</div>
              </div>
              <div className="min-w-0">
                <div className="text-xs text-gray-500">差额金额</div>
                <div className="mt-1 font-semibold text-red-700">
                  {Number(varianceCandidatesQuery.data?.diffAmount || varianceCandidateFlow?.recognitionDiffAmount || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-xs text-gray-500">建议忽略</div>
                <div className="mt-1 font-semibold text-red-700">
                  {selectedVarianceAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-xs text-gray-500">建议转移</div>
                <div className="mt-1 font-semibold text-sky-700">
                  {selectedVarianceTransferAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-xs text-gray-500">净调整金额</div>
                <div className={`mt-1 font-semibold ${varianceAmountMatched ? "text-emerald-700" : "text-amber-700"}`}>
                  {selectedVarianceNetAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            {varianceCandidatesQuery.isLoading ? (
              <div className="py-8 text-center text-sm text-gray-500">正在查找候选订单明细...</div>
            ) : varianceCandidatesQuery.isError ? (
              <div className="py-8 text-center text-sm text-red-500">
                {varianceCandidatesQuery.error.message || "候选订单明细加载失败"}
              </div>
            ) : varianceCandidateItems.length === 0 && varianceTransferCandidateItems.length === 0 ? (
              <div className="rounded-md border px-3 py-6 text-center text-sm text-gray-500">
                {varianceCandidatesQuery.data?.message || "未找到候选订单明细"}
              </div>
            ) : (
              <>
                <div className="text-sm text-gray-600">
                  {varianceCandidatesQuery.data?.message}
                </div>
                {(selectedVarianceDetailIds.length > 0 || selectedVarianceTransferDetailIds.length > 0) && !varianceAmountMatched && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                    建议忽略金额减建议转移金额必须与差额金额一致。
                  </div>
                )}
                <div className="space-y-2">
                  <div className="text-sm font-medium text-red-700">建议忽略的订单</div>
                  <div className="min-w-0 max-w-full overflow-hidden rounded-md border">
                    <div className="max-h-[220px] min-w-0 overflow-auto">
                      <Table className="w-max min-w-full table-fixed">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10"></TableHead>
                            <TableHead className="w-[220px] whitespace-nowrap">订单号</TableHead>
                            <TableHead className="w-[420px] whitespace-nowrap">认账关键字</TableHead>
                            <TableHead className="w-[100px] whitespace-nowrap text-right">订单金额</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {varianceCandidateItems.map((detail: any) => {
                            const detailId = Number(detail.id);
                            const checked = selectedVarianceDetailIds.includes(detailId);
                            return (
                              <TableRow key={detail.id} className={checked ? "bg-red-50" : ""}>
                                <TableCell>
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4"
                                    checked={checked}
                                    onChange={() => toggleVarianceDetail(detailId)}
                                    aria-label="选择建议忽略的订单明细"
                                  />
                                </TableCell>
                                <TableCell className="w-[220px] truncate whitespace-nowrap font-mono text-xs" title={detail.billNo || ""}>{detail.billNo || "-"}</TableCell>
                                <TableCell className="w-[420px] truncate whitespace-nowrap text-xs" title={detail.description || ""}>{detail.description || "-"}</TableCell>
                                <TableCell className="w-[100px] whitespace-nowrap text-right text-xs font-medium text-red-700">
                                  {Number(detail.amount || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>
                {varianceTransferCandidateItems.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-sky-700">建议转移的订单（同规则 T+1 已忽略订单）</div>
                    <div className="min-w-0 max-w-full overflow-hidden rounded-md border">
                      <div className="max-h-[220px] min-w-0 overflow-auto">
                        <Table className="w-max min-w-full table-fixed">
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-10"></TableHead>
                              <TableHead className="w-[110px] whitespace-nowrap">原日期汇总</TableHead>
                              <TableHead className="w-[210px] whitespace-nowrap">订单号</TableHead>
                              <TableHead className="w-[360px] whitespace-nowrap">认账关键字</TableHead>
                              <TableHead className="w-[100px] whitespace-nowrap text-right">订单金额</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {varianceTransferCandidateItems.map((detail: any) => {
                              const detailId = Number(detail.id);
                              const checked = selectedVarianceTransferDetailIds.includes(detailId);
                              return (
                                <TableRow key={detail.id} className={checked ? "bg-sky-50" : ""}>
                                  <TableCell>
                                    <input
                                      type="checkbox"
                                      className="h-4 w-4"
                                      checked={checked}
                                      onChange={() => toggleVarianceTransferDetail(detailId)}
                                      aria-label="选择建议转移的已忽略订单明细"
                                    />
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap text-xs text-gray-600">{detail.summaryDate || "-"}</TableCell>
                                  <TableCell className="truncate whitespace-nowrap font-mono text-xs" title={detail.billNo || ""}>{detail.billNo || "-"}</TableCell>
                                  <TableCell className="truncate whitespace-nowrap text-xs" title={detail.description || ""}>{detail.description || "-"}</TableCell>
                                  <TableCell className="whitespace-nowrap text-right text-xs font-medium text-sky-700">
                                    {Number(detail.amount || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={batchMarkIgnore.isPending}
              onClick={() => {
                setVarianceCandidateFlow(null);
                setSelectedVarianceDetailIds([]);
                setSelectedVarianceTransferDetailIds([]);
              }}
            >
              取消
            </Button>
            <Button
              size="sm"
              disabled={!varianceAmountMatched || batchMarkIgnore.isPending}
              onClick={() => varianceCandidateFlow && batchMarkIgnore.mutate({
                flowId: Number(varianceCandidateFlow.id),
                detailIds: selectedVarianceDetailIds,
                transferDetailIds: selectedVarianceTransferDetailIds,
              })}
            >
              {batchMarkIgnore.isPending
                ? "调整并提交认账中..."
                : selectedVarianceTransferDetailIds.length > 0
                  ? "确认忽略、转移并重新认账"
                  : "确认忽略并重新认账"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(partialTransferFlow)}
        onOpenChange={(open) => {
          if (!open && !transferIgnoredDetailsAndRecognize.isPending) {
            setPartialTransferFlow(null);
            setSelectedPartialTransferDetailIds([]);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] overflow-hidden sm:max-w-[980px]">
          <DialogHeader>
            <DialogTitle>转移 T+1 已忽略订单并补认账</DialogTitle>
          </DialogHeader>
          <div className="min-w-0 space-y-3 overflow-hidden">
            <div className="grid min-w-0 grid-cols-2 gap-3 rounded-md border bg-gray-50 p-3 text-sm md:grid-cols-3 lg:grid-cols-6">
              <div className="min-w-0">
                <div className="text-xs text-gray-500">流水号</div>
                <div className="mt-1 truncate font-mono text-xs text-gray-800" title={partialTransferFlow?.referenceNo || ""}>
                  {partialTransferFlow?.referenceNo || "-"}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">目标日期</div>
                <div className="mt-1 font-medium text-gray-800">{partialTransferCandidatesQuery.data?.targetDate || "-"}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">待认账金额</div>
                <div className="mt-1 font-semibold text-sky-700">
                  {(partialRecognitionAvailableCents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">待拆分订单金额</div>
                <div className="mt-1 font-semibold text-purple-700">
                  {(partialPendingSplitCents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">推荐转移金额</div>
                <div className="mt-1 font-semibold text-sky-700">
                  {(partialTransferTargetCents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">已选金额</div>
                <div className={`mt-1 font-semibold ${partialTransferAmountMatched ? "text-emerald-700" : "text-amber-700"}`}>
                  {selectedPartialTransferAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            {partialTransferCandidatesQuery.isLoading ? (
              <div className="py-8 text-center text-sm text-gray-500">正在查找同规则的 T+1 已忽略订单...</div>
            ) : partialTransferCandidatesQuery.isError ? (
              <div className="py-8 text-center text-sm text-red-500">
                {partialTransferCandidatesQuery.error.message || "候选订单加载失败"}
              </div>
            ) : partialTransferCandidateItems.length === 0 ? (
              <div className="rounded-md border px-3 py-6 text-center text-sm text-gray-500">
                {partialTransferCandidatesQuery.data?.message || "未找到可转移的 T+1 已忽略订单"}
              </div>
            ) : (
              <>
                <div className="text-sm text-gray-600">{partialTransferCandidatesQuery.data?.message}</div>
                {selectedPartialTransferDetailIds.length > 0 && !partialTransferAmountMatched && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                    已选订单金额合计必须与推荐转移金额一致。
                  </div>
                )}
                <div className="min-w-0 max-w-full overflow-hidden rounded-md border">
                  <div className="max-h-[380px] min-w-0 overflow-auto">
                    <Table className="w-max min-w-full table-fixed">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10"></TableHead>
                          <TableHead className="w-[110px] whitespace-nowrap">原日期汇总</TableHead>
                          <TableHead className="w-[210px] whitespace-nowrap">订单号</TableHead>
                          <TableHead className="w-[360px] whitespace-nowrap">认账关键字</TableHead>
                          <TableHead className="w-[100px] whitespace-nowrap text-right">订单金额</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {partialTransferCandidateItems.map((detail: any) => {
                          const detailId = Number(detail.id);
                          const checked = selectedPartialTransferDetailIds.includes(detailId);
                          return (
                            <TableRow key={detailId} className={checked ? "bg-sky-50" : ""}>
                              <TableCell>
                                <input
                                  type="checkbox"
                                  className="h-4 w-4"
                                  checked={checked}
                                  onChange={() => togglePartialTransferDetail(detailId)}
                                  aria-label="选择已忽略 T+1 订单明细"
                                />
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-xs text-gray-600">{detail.summaryDate || "-"}</TableCell>
                              <TableCell className="truncate whitespace-nowrap font-mono text-xs" title={detail.billNo || ""}>{detail.billNo || "-"}</TableCell>
                              <TableCell className="truncate whitespace-nowrap text-xs" title={detail.description || ""}>{detail.description || "-"}</TableCell>
                              <TableCell className="whitespace-nowrap text-right text-xs font-medium text-blue-700">
                                {Number(detail.amount || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={transferIgnoredDetailsAndRecognize.isPending}
              onClick={() => {
                setPartialTransferFlow(null);
                setSelectedPartialTransferDetailIds([]);
              }}
            >
              取消
            </Button>
            <Button
              size="sm"
              disabled={!partialTransferAmountMatched || transferIgnoredDetailsAndRecognize.isPending}
              onClick={() => partialTransferFlow && transferIgnoredDetailsAndRecognize.mutate({
                flowId: Number(partialTransferFlow.id),
                detailIds: selectedPartialTransferDetailIds,
              })}
            >
              {transferIgnoredDetailsAndRecognize.isPending ? "转移并提交认账中..." : "确认转移并增量认账"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(voucherCreationFlow && (
          manualVoucherRequirements.length > 0
          || needsInterestSummaryContent
          || voucherTemplateChoices.some((item) => item.requiresSelection)
        ))}
        onOpenChange={(open) => {
          if (!open && !validateCreateVoucher.isPending) {
            setVoucherCreationFlow(null);
            setManualVoucherRequirements([]);
            setManualVoucherIds({});
            setVoucherTemplateChoices([]);
            setVoucherTemplateSelections({});
            setNeedsInterestSummaryContent(false);
            setInterestSummaryContent("");
            setInterestSummaryPreview("");
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {voucherTemplateChoices.some((item) => item.requiresSelection)
                ? "请选择凭证模版"
                : "填写制单信息"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-gray-500">
              银行流水号：{voucherCreationFlow?.referenceNo || "-"}
            </div>
            {voucherTemplateChoices.some((item) => item.requiresSelection) && (
              <div className="space-y-3">
                {voucherTemplateChoices.filter((item) => item.requiresSelection).map((item) => (
                  <div key={item.templateType}>
                    <Select
                      value={voucherTemplateSelections[item.templateType] || ""}
                      onValueChange={(value) => {
                        const nextSelections = {
                          ...voucherTemplateSelections,
                          [item.templateType]: value,
                        };
                        setVoucherTemplateSelections(nextSelections);
                        if (item.templateType === "利息收入" && needsInterestSummaryContent && voucherCreationFlow) {
                          previewInterestSummary.mutate({
                            flowId: Number(voucherCreationFlow.id),
                            templateSelections: voucherTemplateChoices
                              .filter((choice) => nextSelections[choice.templateType])
                              .map((choice) => ({
                                templateType: choice.templateType as any,
                                templateId: nextSelections[choice.templateType],
                              })),
                          });
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="请选择模版" />
                      </SelectTrigger>
                      <SelectContent>
                        {item.options.map((option) => (
                          <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            )}
            {needsInterestSummaryContent && (
              <div className="space-y-2 rounded-md border p-3">
                <Label className="text-sm">摘要内容</Label>
                <Input
                  value={interestSummaryContent}
                  maxLength={500}
                  placeholder="不填写时自动使用利息模板摘要"
                  onChange={(event) => setInterestSummaryContent(event.target.value)}
                />
                <div className="space-y-1 rounded-md bg-blue-50 p-3 text-xs leading-5 text-blue-800">
                  <div className="font-medium text-amber-700">凭证除认账信息外会自动填入以下信息</div>
                  <div>
                    摘要：{interestSummaryContent.trim()
                      || (previewInterestSummary.isPending ? "正在按所选模板生成预览..." : interestSummaryPreview)
                      || "-"}
                  </div>
                  <div>客户档案：北京市企业家环保基金会</div>
                  <div>收款活动类型：801_其他收入</div>
                </div>
              </div>
            )}
            {manualVoucherRequirements.length > 0 && (
              <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-800">
                捐赠收入、会费收入和利息会按当前模板自动生成凭证。以下收入类型请填写已生成的凭证ID。
              </div>
            )}
            {manualVoucherRequirements.length > 0 && (
              <div className="space-y-3">
                {manualVoucherRequirements.map((item) => (
                  <div key={item.incomeType} className="grid grid-cols-[120px_120px_minmax(0,1fr)] items-end gap-3 rounded-md border p-3">
                    <div>
                      <div className="text-xs text-gray-500">收入类型</div>
                      <div className="mt-1 text-sm font-medium">{item.incomeType}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">入账金额</div>
                      <div className="mt-1 text-sm font-semibold text-blue-700">
                        {Number(item.amount || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">凭证ID <span className="text-red-500">*</span></Label>
                      <Input
                        className="h-9"
                        value={manualVoucherIds[item.incomeType] || ""}
                        maxLength={200}
                        placeholder="请输入文本凭证ID"
                        onChange={(event) => setManualVoucherIds((current) => ({
                          ...current,
                          [item.incomeType]: event.target.value,
                        }))}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={validateCreateVoucher.isPending}
              onClick={() => {
                setVoucherCreationFlow(null);
                setManualVoucherRequirements([]);
                setManualVoucherIds({});
                setVoucherTemplateChoices([]);
                setVoucherTemplateSelections({});
                setNeedsInterestSummaryContent(false);
                setInterestSummaryContent("");
                setInterestSummaryPreview("");
              }}
            >
              取消
            </Button>
            <Button
              size="sm"
              disabled={validateCreateVoucher.isPending}
              onClick={confirmCreateVoucher}
            >
              {validateCreateVoucher.isPending ? "制单中..." : "确定"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(manualVoucherCancelFlow)}
        onOpenChange={(open) => {
          if (!open && !cancelManualVoucher.isPending) {
            setManualVoucherCancelFlow(null);
            setSelectedManualVoucherResultId(0);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>取消手工凭证</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md bg-orange-50 p-3 text-sm text-orange-800">
              取消后，对应收入类型将恢复为待制单，其他手工凭证和自动凭证不受影响。
            </div>
            <div className="text-sm text-gray-500">
              银行流水：{manualVoucherCancelFlow?.referenceNo || "-"}
            </div>
            {manualVouchersQuery.isLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-gray-500">
                <Spinner className="h-4 w-4" />
                正在读取手工凭证...
              </div>
            ) : manualVouchersQuery.isError ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                {manualVouchersQuery.error.message || "手工凭证加载失败"}
              </div>
            ) : (manualVouchersQuery.data?.items || []).length === 0 ? (
              <div className="rounded-md border p-3 text-sm text-gray-500">暂无可取消的手工凭证</div>
            ) : (
              <div className="space-y-2">
                {(manualVouchersQuery.data?.items || []).map((item) => {
                  const voucherResultId = Number(item.voucherResultId);
                  const checked = selectedManualVoucherResultId === voucherResultId;
                  return (
                    <label
                      key={voucherResultId}
                      className={`grid cursor-pointer grid-cols-[24px_100px_minmax(0,1fr)_110px] items-center gap-2 rounded-md border px-3 py-2 text-sm ${checked ? "border-orange-400 bg-orange-50" : "hover:bg-gray-50"}`}
                    >
                      <input
                        type="radio"
                        name="manual-voucher-cancel"
                        checked={checked}
                        onChange={() => setSelectedManualVoucherResultId(voucherResultId)}
                      />
                      <span className="font-medium">{item.incomeType}</span>
                      <span className="min-w-0 break-all font-mono text-xs text-gray-600">{item.voucherId}</span>
                      <span className="text-right font-medium text-orange-700">
                        {Number(item.voucherAmount || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={cancelManualVoucher.isPending}
              onClick={() => {
                setManualVoucherCancelFlow(null);
                setSelectedManualVoucherResultId(0);
              }}
            >
              取消
            </Button>
            <Button
              size="sm"
              className="bg-orange-600 hover:bg-orange-700"
              disabled={!selectedManualVoucherResultId || cancelManualVoucher.isPending}
              onClick={() => cancelManualVoucher.mutate({ voucherResultId: selectedManualVoucherResultId })}
            >
              {cancelManualVoucher.isPending ? "取消中..." : "确认取消"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(cancelRecognitionFlow)}
        onOpenChange={(open) => {
          if (!open && !cancelFlowRecognition.isPending) setCancelRecognitionFlow(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>取消认账</DialogTitle>
          </DialogHeader>
          {cancelRecognitionQuery.isLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-gray-500">
              <Spinner className="h-4 w-4" />
              正在读取取消范围...
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="rounded-md bg-orange-50 p-3 text-orange-800">
                {cancelRecognitionQuery.data?.scopeType === "multi_day"
                  ? "从该到账取消会回滚整个多日汇总匹配组的全部认账结果。"
                  : cancelRecognitionQuery.data?.scopeType === "same_day"
                    ? "从该到账取消会回滚整个同日汇总任务的全部认账结果。"
                    : `将回滚流水 ${cancelRecognitionFlow?.referenceNo || "-"} 的全部认账结果。`}
              </div>
              {cancelRecognitionQuery.data && (
                <div className="space-y-2 rounded-md border px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-gray-500">取消范围</span>
                    <span className="font-medium">{cancelRecognitionQuery.data.scopeLabel}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-gray-500">银行到账</span>
                    <span className="font-medium">{cancelRecognitionQuery.data.scopeFlowCount} 笔</span>
                  </div>
                  {cancelRecognitionQuery.data.scopeType === "multi_day" && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-gray-500">到账日期</span>
                      <span className="font-medium">
                        {cancelRecognitionQuery.data.startDate === cancelRecognitionQuery.data.endDate
                          ? cancelRecognitionQuery.data.startDate || "-"
                          : `${cancelRecognitionQuery.data.startDate || "-"} 至 ${cancelRecognitionQuery.data.endDate || "-"}`}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-gray-500">入账结果</span>
                    <span className="font-medium">{cancelRecognitionQuery.data.resultCount} 条</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-gray-500">认账金额</span>
                    <span className="font-medium text-orange-700">
                      {Number(cancelRecognitionQuery.data.recognizedAmount || 0).toLocaleString("zh-CN", {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                </div>
              )}
              {cancelRecognitionQuery.data && !cancelRecognitionQuery.data.canCancel && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-700">
                  {cancelRecognitionQuery.data.message}
                </div>
              )}
              {cancelRecognitionQuery.data?.canCancel && cancelRecognitionQuery.data.hasOrphanedDetails && (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800">
                  {cancelRecognitionQuery.data.message}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={cancelFlowRecognition.isPending}
              onClick={() => setCancelRecognitionFlow(null)}
            >
              取消
            </Button>
            <Button
              size="sm"
              className="bg-orange-600 hover:bg-orange-700"
              disabled={
                cancelRecognitionQuery.isLoading ||
                cancelFlowRecognition.isPending ||
                !cancelRecognitionQuery.data?.canCancel
              }
              onClick={handleConfirmCancelRecognition}
            >
              {cancelFlowRecognition.isPending ? "处理中..." : "确认取消"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      {/* 手动认账表单 */}
      {selectedFlow && (
        <Card
          ref={manualFormRef}
          className={`scroll-mt-4 transition-colors duration-500 ${
            manualFormHighlight ? "border-blue-400 bg-blue-50/60 shadow-sm" : ""
          }`}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Banknote className="h-5 w-5 text-blue-600" />
                <span className="font-semibold">
                  {selectedFlow.pendingIncomeRuleRecognition ? "到账认账" : "手动认账"} - 流水 {selectedFlow.referenceNo}
                </span>
                <span className="text-sm text-gray-400">收入 {selectedFlow.income}</span>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setSelectedFlow(null)}>取消</Button>
            </div>

            {selectedFlow.pendingIncomeRuleRecognition ? (
              <IncomeRuleAmountRecognitionForm
                flow={selectedFlow}
                onCancel={() => setSelectedFlow(null)}
                onSuccess={async () => {
                  setSelectedFlow(null);
                  await Promise.all([
                    utils.task.getFlows.invalidate(),
                    utils.task.getById.invalidate(),
                    utils.result.list.invalidate(),
                  ]);
                }}
              />
            ) : (
              <ManualRecognitionForm
                selectedFlow={selectedFlow}
                manualRecognitionContext="income"
                splits={splits}
                onSplitsChange={setSplits}
                voucherReceiptChannelCode={voucherReceiptChannelCode}
                onVoucherReceiptChannelCodeChange={setVoucherReceiptChannelCode}
                treeEnabled={Boolean(selectedFlow)}
                splitCardClassName="bg-gray-50 border rounded-lg p-4 space-y-3"
                amountSection={
                  <div className="grid max-w-lg grid-cols-2 gap-3 rounded-md border bg-white p-3">
                    <div className="space-y-1">
                      <Label className="text-xs">认账金额 <span className="text-red-500">*</span></Label>
                      <Input
                        className="h-9"
                        value={recognitionAmount}
                        onChange={(e) => setRecognitionAmount(sanitizeSignedDecimalInput(
                          e.target.value,
                          Number(selectedFlow.income || 0) < 0,
                        ))}
                        placeholder="请输入认账金额"
                        inputMode="decimal"
                      />
                    </div>
                    <div className="space-y-1 text-sm">
                      <div className="text-xs text-gray-500">可认账金额</div>
                      <div className="pt-2 font-semibold text-orange-700">
                        {Number(selectedFlow.recognitionAvailableAmount || selectedFlow.income || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                  </div>
                }
                footer={
                  <>
                    <Button size="sm" variant="outline" onClick={() => setSelectedFlow(null)}>取消</Button>
                    <Button size="sm" className="bg-blue-600 hover:bg-blue-700" onClick={handleSave} disabled={manualRecognize.isPending}>
                      {manualRecognize.isPending ? "保存中..." : "确认认账"}
                    </Button>
                  </>
                }
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ====== 订单明细表格 ======
function BillDetailTable({ taskId, summaryDate, summary }: { taskId: number; summaryDate: string; summary: any }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [detailsVisible, setDetailsVisible] = useState(searchParams.get("tab") === "details");
  const wasProcessingRef = useRef(summary?.status === "processing");
  const [detailPackageType, setDetailPackageType] = useState<"T+1" | "打包明细">("T+1");
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [transferDetail, setTransferDetail] = useState<any>(null);
  const [transferDate, setTransferDate] = useState("");
  const [cancelOperationTarget, setCancelOperationTarget] = useState<any>(null);
  const [cancelOperationWarning, setCancelOperationWarning] = useState<any>(null);
  const detailsQuery = trpc.task.getDetails.useQuery(
    { taskId, summaryDate, detailPackageType, status: (statusFilter || undefined) as any, page, pageSize: 20 },
    {
      enabled: detailsVisible && taskId > 0,
      refetchInterval: summary?.status === "processing" ? 2000 : false,
    }
  );
  const utils = trpc.useUtils();

  const refreshDetails = () => {
    utils.task.getDetails.invalidate();
    utils.task.getById.invalidate();
    utils.task.list.invalidate();
    utils.task.getFlows.invalidate();
    utils.result.list.invalidate();
    utils.result.dayGroups.invalidate();
  };

  useEffect(() => {
    if (!detailsVisible) return;
    const isProcessing = summary?.status === "processing";
    if (wasProcessingRef.current && !isProcessing) {
      refreshDetails();
      window.setTimeout(refreshDetails, 800);
    }
    wasProcessingRef.current = isProcessing;
  }, [detailsVisible, summary?.status, summary?.updatedAt]);

  const markIgnore = trpc.task.markIgnore.useMutation({
    onSuccess: () => {
      toast.success("已忽略该明细");
      refreshDetails();
    },
    onError: (err: any) => toast.error(err.message || "操作失败"),
  });

  const transferMutation = trpc.task.transferDetail.useMutation({
    onSuccess: () => {
      toast.success("已转移该明细");
      setTransferDetail(null);
      setTransferDate("");
      refreshDetails();
    },
    onError: (err: any) => toast.error(err.message || "转移失败"),
  });

  const cancelOperation = trpc.task.cancelDetailOperation.useMutation({
    onSuccess: (result) => {
      if (!result.success && result.requiresConfirmation) {
        setCancelOperationWarning(result);
        return;
      }
      const cancelledRecognitionCount = Number(result.cancelledRecognitionCount || 0);
      toast.success(
        cancelledRecognitionCount > 0
          ? `已取消${result.operationLabel}，同时取消原日期汇总 ${cancelledRecognitionCount} 条认账结果`
          : `已取消${result.operationLabel}`,
      );
      setCancelOperationTarget(null);
      setCancelOperationWarning(null);
      refreshDetails();
    },
    onError: (err: any) => toast.error(err.message || "取消失败"),
  });

  const cancelManualDetailRecognition = trpc.task.cancelRecognitionResult.useMutation({
    onSuccess: () => {
      toast.success("已取消手动认账");
      refreshDetails();
    },
    onError: (err: any) => toast.error(err.message || "取消认账失败"),
  });

  const statusBadge: Record<string, string> = {
    unrecognized: "bg-gray-100 text-gray-800",
    recognized: "bg-green-100 text-green-800",
    pending_split: "bg-purple-100 text-purple-800",
    split_replaced: "bg-sky-100 text-sky-800",
    ignored: "bg-slate-100 text-slate-700",
    transferred: "bg-blue-100 text-blue-800",
  };

  const statusLabel: Record<string, string> = {
    unrecognized: "未认账",
    recognized: "已认账",
    pending_split: "待拆分",
    split_replaced: "已拆分",
    ignored: "已忽略",
    transferred: "已转移",
  };

  const getDetailStatus = (detail: any) => {
    if (detail.matchResultId) return "recognized";
    if (detail.operationStatus === "split_replaced") return "split_replaced";
    if (detail.operationStatus === "ignored") return "ignored";
    if (detail.operationStatus === "transferred") return "transferred";
    if (detail.matchStatus === "pending_split") return "pending_split";
    return "unrecognized";
  };

  const updateStatusFilter = (status: string) => {
    setStatusFilter(status);
    setPage(1);
  };

  const showFilteredDetails = (status: string) => {
    setDetailsVisible(true);
    setStatusFilter(status);
    setPage(1);
  };

  const requestCancelOperation = (detail: any) => {
    setCancelOperationTarget(detail);
    setCancelOperationWarning(null);
    cancelOperation.mutate({ detailId: Number(detail.id) });
  };

  const updateDetailPackageType = (value: "T+1" | "打包明细") => {
    setDetailPackageType(value);
    setPage(1);
  };

  if (!detailsVisible) {
    const detailCount = Number(summary?.billDetailCount || 0);
    const detailTotal = Number(summary?.billDetailTotal || 0);
    const recognizedCount = Number(summary?.matchedCount || 0);
    const pendingSplitCount = Number(summary?.pendingSplitCount || 0);
    const unrecognizedCount = Math.max(0, detailCount - recognizedCount - pendingSplitCount);

    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="grid flex-1 grid-cols-2 gap-3 md:grid-cols-5">
              <div>
                <div className="text-xs text-gray-500">明细条数</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">{detailCount.toLocaleString("zh-CN")}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">明细金额</div>
                <div className="mt-1 text-lg font-semibold text-green-700">
                  {detailTotal.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">已认账</div>
                <div className="mt-1 text-lg font-semibold text-blue-700">{recognizedCount.toLocaleString("zh-CN")}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">未认账（不包含待拆分）</div>
                <button
                  type="button"
                  className="mt-1 text-left text-lg font-semibold text-orange-700 hover:underline disabled:cursor-default disabled:no-underline disabled:opacity-60"
                  disabled={unrecognizedCount === 0}
                  onClick={() => showFilteredDetails("unrecognized")}
                >
                  {unrecognizedCount.toLocaleString("zh-CN")}
                </button>
              </div>
              <div>
                <div className="text-xs text-gray-500">未认账中待拆分</div>
                <button
                  type="button"
                  className="mt-1 text-left text-lg font-semibold text-purple-700 hover:underline disabled:cursor-default disabled:no-underline disabled:opacity-60"
                  disabled={pendingSplitCount === 0}
                  onClick={() => showFilteredDetails("pending_split")}
                >
                  {pendingSplitCount.toLocaleString("zh-CN")}
                </button>
              </div>
            </div>
            <Button onClick={() => setDetailsVisible(true)} disabled={detailCount === 0}>
              <ListOrdered className="h-4 w-4 mr-1" />
              查看具体明细
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="p-4 pb-0">
          <Tabs value={detailPackageType} onValueChange={(value) => updateDetailPackageType(value as "T+1" | "打包明细")}>
            <TabsList>
              <TabsTrigger value="T+1">T+1明细</TabsTrigger>
              <TabsTrigger value="打包明细">打包明细</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="flex items-center justify-between p-4 pb-0">
          <div className="text-sm text-gray-500">共 {detailsQuery.data?.total || 0} 条</div>
          <div className="flex flex-wrap justify-end gap-2">
            <Select value={statusFilter || "__all"} onValueChange={(value) => updateStatusFilter(value === "__all" ? "" : value)}>
              <SelectTrigger className="h-8 w-[180px]">
                <SelectValue placeholder="全部状态" />
              </SelectTrigger>
              <SelectContent className="min-w-[180px]">
                <SelectItem value="__all">全部状态</SelectItem>
                <SelectItem value="unrecognized_all">未认账</SelectItem>
                <SelectItem value="unrecognized">未认账（不包含待拆分）</SelectItem>
                <SelectItem value="pending_split">待拆分</SelectItem>
                <SelectItem value="recognized">已认账</SelectItem>
                <SelectItem value="transferred_in">转入本日</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="overflow-auto">
          <Table className="w-max min-w-full table-auto">
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">
                  {detailPackageType === "打包明细" ? "匹配日期" : "订单日期"}
                </TableHead>
                <TableHead className="whitespace-nowrap">订单号</TableHead>
                <TableHead className="whitespace-nowrap">明细认账规则</TableHead>
                <TableHead className="whitespace-nowrap">认账关键字</TableHead>
                <TableHead className="text-right whitespace-nowrap">订单金额</TableHead>
                <TableHead className="text-center whitespace-nowrap sticky right-0 bg-white z-10 shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]">状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detailsQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">加载中...</TableCell>
                </TableRow>
              ) : detailsQuery.data?.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-gray-400">暂无订单明细</TableCell>
                </TableRow>
              ) : (
                detailsQuery.data?.items.map((d: any) => (
                  <TableRow key={d.id}>
                    <TableCell className="whitespace-nowrap text-sm text-gray-600">
                      {d.detailPackageType === "打包明细" ? d.uploadDate || "-" : d.billDate || "-"}
                    </TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap" title={d.billNo || ""}>{d.billNo || "-"}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap" title={d.ruleName || ""}>{d.ruleName || "-"}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap" title={d.description || ""}>{d.description || "-"}</TableCell>
                    <TableCell className="font-medium text-blue-700 text-right whitespace-nowrap">
                      {Number(d.amount || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-center sticky right-0 bg-white z-10 shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]">
                      {(() => {
                        const detailStatus = getDetailStatus(d);
                        if (detailStatus === "unrecognized" || detailStatus === "pending_split") {
                          return (
                            <div className="flex items-center justify-center gap-1">
                              <Badge className={statusBadge[detailStatus]}>{statusLabel[detailStatus]}</Badge>
                              {d.archived && <Badge variant="outline" className="text-gray-500">已归档</Badge>}
                              {(detailStatus === "unrecognized" || !d.archived) && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-7 w-7">
                                      <MoreHorizontal className="h-3.5 w-3.5 text-gray-500" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    {detailStatus === "unrecognized" && (
                                      <DropdownMenuItem onClick={() => navigate(
                                        `/tasks/${taskId}/details/${d.id}/manual-recognition?partitionDate=${encodeURIComponent(d.partitionDate || summaryDate)}`,
                                      )}>
                                        认账
                                      </DropdownMenuItem>
                                    )}
                                    {!d.archived && (
                                      <DropdownMenuItem
                                        disabled={markIgnore.isPending}
                                        onClick={() => markIgnore.mutate({ detailId: d.id })}
                                      >
                                        暂时忽略
                                      </DropdownMenuItem>
                                    )}
                                    {!d.archived && d.detailPackageType !== "打包明细" && (
                                      <DropdownMenuItem onClick={() => {
                                        setTransferDetail(d);
                                        setTransferDate("");
                                      }}>
                                        转移日期
                                      </DropdownMenuItem>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                          );
                        }
                        if (detailStatus === "ignored" || detailStatus === "transferred") {
                          return (
                            <div className="flex items-center justify-center gap-1">
                              <Badge className={statusBadge[detailStatus]}>{statusLabel[detailStatus]}</Badge>
                              {d.archived && <Badge variant="outline" className="text-gray-500">已归档</Badge>}
                              {!d.archived && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-7 w-7">
                                      <MoreHorizontal className="h-3.5 w-3.5 text-gray-500" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      disabled={cancelOperation.isPending}
                                      onClick={() => requestCancelOperation(d)}
                                    >
                                      取消{detailStatus === "ignored" ? "忽略" : "转移"}
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                          );
                        }
                        if (d.manualRecognition) {
                          return (
                            <div className="flex items-center justify-center gap-1">
                              <Badge className={statusBadge.recognized}>已认账</Badge>
                              {d.archived && <Badge variant="outline" className="text-gray-500">已归档</Badge>}
                              {!d.archived && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-7 w-7">
                                      <MoreHorizontal className="h-3.5 w-3.5 text-gray-500" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      disabled={cancelManualDetailRecognition.isPending}
                                      onClick={() => {
                                        if (!confirm("确定取消该条订单明细的手动认账？")) return;
                                        cancelManualDetailRecognition.mutate({ id: Number(d.matchResultId) });
                                      }}
                                    >
                                      取消认账
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                          );
                        }
                        return (
                          <div className="flex items-center justify-center gap-1">
                            <Badge className={statusBadge.recognized}>已认账</Badge>
                            {d.archived && <Badge variant="outline" className="text-gray-500">已归档</Badge>}
                          </div>
                        );
                      })()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {detailsQuery.data && detailsQuery.data.total > 20 && (
          <div className="flex justify-center p-4 gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>上一页</Button>
            <span className="text-sm text-gray-500 self-center">第 {page} 页 / 共 {Math.ceil((detailsQuery.data?.total || 0) / 20)} 页</span>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page * 20 >= (detailsQuery.data?.total || 0)}>下一页</Button>
          </div>
        )}
      </CardContent>
      <Dialog open={markIgnore.isPending}>
        <DialogContent className="max-w-xs" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>忽略处理中</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-3 text-sm text-gray-600">
            <Spinner className="size-5 text-blue-600" />
            <span>忽略处理中，请稍后</span>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(cancelOperationWarning)}
        onOpenChange={(open) => {
          if (!open && !cancelOperation.isPending) {
            setCancelOperationTarget(null);
            setCancelOperationWarning(null);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>取消{cancelOperationWarning?.operationLabel || "操作"}前需取消认账</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className={`rounded-md border px-3 py-2 ${
              cancelOperationWarning?.canContinue
                ? "border-orange-200 bg-orange-50 text-orange-800"
                : "border-red-200 bg-red-50 text-red-700"
            }`}>
              {cancelOperationWarning?.message}
            </div>
            <div className="space-y-2 rounded-md border px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-gray-500">原日期汇总</span>
                <span className="font-medium">{cancelOperationWarning?.originalDate || "-"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-gray-500">取消范围</span>
                <span className="font-medium">{cancelOperationWarning?.scopeLabel || "-"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-gray-500">银行到账</span>
                <span className="font-medium">{cancelOperationWarning?.bankFlowCount || 0} 笔</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-gray-500">入账结果</span>
                <span className="font-medium">{cancelOperationWarning?.resultCount || 0} 条</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-gray-500">认账金额</span>
                <span className="font-medium text-orange-700">
                  {Number(cancelOperationWarning?.recognizedAmount || 0).toLocaleString("zh-CN", {
                    minimumFractionDigits: 2,
                  })}
                </span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              disabled={cancelOperation.isPending}
              onClick={() => {
                setCancelOperationTarget(null);
                setCancelOperationWarning(null);
              }}
            >
              取消
            </Button>
            <Button
              size="sm"
              className="bg-orange-600 hover:bg-orange-700"
              disabled={!cancelOperationWarning?.canContinue || cancelOperation.isPending}
              onClick={() => cancelOperationTarget && cancelOperation.mutate({
                detailId: Number(cancelOperationTarget.id),
                confirmCancelRecognition: true,
              })}
            >
              {cancelOperation.isPending ? "处理中..." : "继续并取消认账"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!transferDetail} onOpenChange={(open) => !open && setTransferDetail(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>转移日期</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-gray-500 truncate">{transferDetail?.billNo || "-"}</div>
            <div className="space-y-1">
              <Label>目标日期</Label>
              <Input type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setTransferDetail(null)}>取消</Button>
            <Button
              size="sm"
              disabled={!transferDate || transferMutation.isPending}
              onClick={() => transferDetail && transferMutation.mutate({ detailId: transferDetail.id, targetDate: transferDate })}
            >
              确认转移
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ====== 入账结果表格 ======
function MatchResultTable({ taskId }: { taskId: number }) {
  const [page, setPage] = useState(1);
  const resultsQuery = trpc.result.list.useQuery(
    { taskId, page, pageSize: 20 },
    { enabled: taskId > 0 }
  );

  return (
    <Card>
      <CardContent className="p-0">
        <div className="text-sm text-gray-500 p-4 pb-0">共 {resultsQuery.data?.total || 0} 条</div>
        <div className="overflow-auto">
          <Table className="w-max min-w-full table-auto text-xs">
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">认账类型</TableHead>
                <TableHead className="text-xs">收入类型</TableHead>
                <TableHead className="text-xs">收入属性</TableHead>
                <TableHead className="text-xs">收入部门</TableHead>
                <TableHead className="text-xs">预算编码</TableHead>
                <TableHead className="text-xs">NC项目名称</TableHead>
                <TableHead className="text-xs">平台项目名称</TableHead>
                <TableHead className="text-xs">平台项目详情</TableHead>
                <TableHead className="text-xs">支出资金来源</TableHead>
                <TableHead className="text-xs">地区</TableHead>
                <TableHead className="text-xs">匿名</TableHead>
                <TableHead className="text-xs">会员姓名</TableHead>
                <TableHead className="text-xs">所属项目中心</TableHead>
                <TableHead className="w-[110px] min-w-[110px] text-right text-xs">订单明细数</TableHead>
                <TableHead className="sticky right-0 z-10 w-[120px] min-w-[120px] bg-white text-right text-xs shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]">入账金额</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resultsQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={15} className="text-center py-8">加载中...</TableCell>
                </TableRow>
              ) : resultsQuery.data?.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={15} className="text-center py-8 text-gray-400">暂无入账结果</TableCell>
                </TableRow>
              ) : (
                resultsQuery.data?.items.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs">{r.recognitionType || "-"}</TableCell>
                    <TableCell className="text-xs">{r.incomeType || "-"}</TableCell>
                    <TableCell className="text-xs">{r.incomeAttr || "-"}</TableCell>
                    <TableCell className="text-xs">{r.incomeDept || "-"}</TableCell>
                    <TableCell className="text-xs">{r.budgetCode || "-"}</TableCell>
                    <TableCell className="text-xs">{r.incomeProject || "-"}</TableCell>
                    <TableCell className="text-xs">{r.platformProjectDisplayName || r.platformProjectName || "-"}</TableCell>
                    <TableCell className="text-xs">{r.platformProjectDetail || "-"}</TableCell>
                    <TableCell className="text-xs">{r.expenseFundSource || "-"}</TableCell>
                    <TableCell className="text-xs">{r.region || "-"}</TableCell>
                    <TableCell className="text-xs">{r.isAnonymous ? "是" : "否"}</TableCell>
                    <TableCell className="text-xs">{r.memberName || "-"}</TableCell>
                    <TableCell className="text-xs">{r.projectCenter || "-"}</TableCell>
                    <TableCell className="w-[110px] min-w-[110px] text-right text-xs">
                      {r.ruleItemId ? Number(r.orderDetailCountSnapshot || 0).toLocaleString("zh-CN") : "-"}
                    </TableCell>
                    <TableCell className="sticky right-0 z-10 w-[120px] min-w-[120px] bg-white text-right text-xs font-medium text-blue-700 shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]">
                      {Number(r.splitAmount || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {resultsQuery.data && resultsQuery.data.total > 20 && (
          <div className="flex justify-center p-4 gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>上一页</Button>
            <span className="text-sm text-gray-500 self-center">第 {page} 页 / 共 {Math.ceil((resultsQuery.data?.total || 0) / 20)} 页</span>
            <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page * 20 >= (resultsQuery.data?.total || 0)}>下一页</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
