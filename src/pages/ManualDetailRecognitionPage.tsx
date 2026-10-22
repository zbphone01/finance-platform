import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ManualRecognitionForm,
  createManualSplit,
  serializeManualRecognitionSplits,
  validateManualRecognitionSplits,
  type ManualSplit,
} from "@/components/ManualRecognitionForm";

const selectableFlowStatuses = ["unrecognized", "partial_matched", "variance_unrecognized", "variance_partial_matched"];
const RAW_VALUE_SUFFIX_FIELDS = new Set([
  "商户数据包",
  "订单金额",
  "费率备注",
  "商户退款单号",
  "微信退款单号",
  "退款金额",
  "充值券退款金额",
  "申请退款金额",
  "退款类型",
  "退款状态",
]);

function formatRawCell(header: string, value: unknown) {
  const text = String(value ?? "").trim();
  if (RAW_VALUE_SUFFIX_FIELDS.has(header)) {
    if (/^-?\d+(?:\.\d+)?_\d+$/.test(text)) return text.replace(/_\d+$/, "");
    if (/^_\d+$/.test(text)) return "-";
  }
  return text || "-";
}

function getManualDetailRawHeaders(detail: any) {
  const rawData = detail?.rawData && typeof detail.rawData === "object" ? detail.rawData as Record<string, unknown> : {};
  const rawColumns = String(detail?.rawColumns || "");
  const headers = rawColumns
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const rawHeaders = Object.keys(rawData).filter(Boolean);
  const merged = Array.from(new Set([...headers, ...rawHeaders]));
  if (merged.length > 0) return merged;
  return ["订单日期/匹配日期", "订单号", "明细认账规则", "认账关键字", "订单金额"];
}

function getManualDetailRawValue(detail: any, header: string, detailAmount: number) {
  const rawData = detail?.rawData && typeof detail.rawData === "object" ? detail.rawData as Record<string, unknown> : {};
  if (Object.prototype.hasOwnProperty.call(rawData, header)) return rawData[header];
  if (header === "订单日期/匹配日期") return detail?.detailPackageType === "打包明细" ? detail?.uploadDate || "-" : detail?.billDate || "-";
  if (header === "订单号") return detail?.billNo || "-";
  if (header === "明细认账规则") return detail?.ruleName || "-";
  if (header === "认账关键字") return detail?.description || "-";
  if (header === "订单金额") return detailAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 });
  return "-";
}

export default function ManualDetailRecognitionPage() {
  const { taskId: taskIdParam, detailId: detailIdParam } = useParams<{ taskId: string; detailId: string }>();
  const taskId = Number(taskIdParam || 0);
  const detailId = Number(detailIdParam || 0);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const partitionDate = String(searchParams.get("partitionDate") || "").trim();
  const hasValidPartitionDate = /^\d{4}-\d{2}-\d{2}$/.test(partitionDate);
  const utils = trpc.useUtils();
  const [manualFlowId, setManualFlowId] = useState("");
  const [splits, setSplits] = useState<ManualSplit[]>([createManualSplit()]);
  const [manualValidationDialogMessage, setManualValidationDialogMessage] = useState("");

  const detailQuery = trpc.task.getDetailForManualRecognition.useQuery(
    { detailId, partitionDate },
    { enabled: detailId > 0 && hasValidPartitionDate },
  );
  const flowsQuery = trpc.task.getFlows.useQuery({ taskId, page: 1, pageSize: 500 }, { enabled: taskId > 0 });

  const detail = detailQuery.data;
  const detailAmount = Number(detail?.amount || detail?.totalAmount || 0);
  const matchedFlowIds = new Set((detail?.matchedFlowIds || []).map((id: any) => Number(id)));
  const candidateFlows = (flowsQuery.data?.items || []).filter((flow: any) =>
    matchedFlowIds.has(Number(flow.id)) &&
    selectableFlowStatuses.includes(String(flow.status || "")) &&
    Number(flow.recognitionAvailableAmount || flow.income || 0) >= detailAmount - 0.01
  );
  const selectedFlow = candidateFlows.find((flow: any) => String(flow.id) === manualFlowId) || null;
  const matchedFlowText = (detail?.matchedFlowReferenceNos || []).length > 0
    ? (detail?.matchedFlowReferenceNos || []).join("，")
    : "-";

  useEffect(() => {
    if (manualFlowId && candidateFlows.some((flow: any) => String(flow.id) === manualFlowId)) return;
    setManualFlowId(candidateFlows.length > 0 ? String(candidateFlows[0].id) : "");
  }, [candidateFlows, manualFlowId]);

  const manualRecognizeDetail = trpc.task.manualRecognizeDetail.useMutation({
    onSuccess: async () => {
      toast.success("手动认账成功");
      await Promise.all([
        utils.task.getDetails.invalidate(),
        utils.task.getById.invalidate(),
        utils.task.list.invalidate(),
        utils.task.getFlows.invalidate(),
        utils.result.list.invalidate(),
        utils.result.dayGroups.invalidate(),
      ]);
      navigate(`/tasks/${taskId}?tab=details`);
    },
    onError: (err: any) => toast.error(err.message || "认账失败"),
  });

  const handleSave = () => {
    if (!detail) return;
    if (detail.matchResultId) {
      toast.error("该订单明细已认账");
      return;
    }
    if (!manualFlowId || !selectedFlow) {
      toast.error("未找到可认账的匹配银行流水");
      return;
    }
    if (!Number.isFinite(detailAmount) || detailAmount <= 0) {
      toast.error("订单明细金额必须大于0");
      return;
    }
    const availableAmount = Number(selectedFlow.recognitionAvailableAmount || selectedFlow.income || 0);
    if (detailAmount > availableAmount + 0.01) {
      toast.error(`订单明细金额不能大于可认账金额 ${availableAmount.toFixed(2)}`);
      return;
    }
    const validationResult = validateManualRecognitionSplits(splits, detailAmount);
    if (validationResult) {
      if (validationResult.presentation === "dialog") {
        setManualValidationDialogMessage(validationResult.message);
      } else {
        toast.error(validationResult.message);
      }
      return;
    }

    manualRecognizeDetail.mutate({
      detailId,
      partitionDate,
      flowId: Number(manualFlowId),
      splits: serializeManualRecognitionSplits(splits),
    });
  };

  if (detailQuery.isLoading) {
    return <div className="py-8 text-gray-500">加载中...</div>;
  }

  if (!hasValidPartitionDate) {
    return <div className="py-8 text-gray-500">订单明细缺少有效归属日期，请返回明细列表后重新进入</div>;
  }

  if (!detail) {
    return <div className="py-8 text-gray-500">订单明细不存在或已被删除</div>;
  }

  const manualDetailHeaders = getManualDetailRawHeaders(detail);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => navigate(`/tasks/${taskId}?tab=details`)}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          返回
        </Button>
        <h1 className="text-xl font-semibold">订单明细手动认账</h1>
      </div>

      <Card className="py-0">
        <CardContent className="p-0">
          <div className="border-b px-4 py-3">
            <div className="text-sm font-medium text-gray-700">
              匹配的银行流水号：<span className="font-mono">{matchedFlowText}</span>
            </div>
          </div>
          <div className="overflow-auto px-4">
            <Table className="w-max min-w-full table-auto text-xs">
              <TableHeader>
                <TableRow>
                  {manualDetailHeaders.map((header) => {
                    const isAmountColumn = header.includes("金额");
                    return (
                      <TableHead key={header} className={`${isAmountColumn ? "text-right" : ""} whitespace-nowrap`}>
                        {header}
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  {manualDetailHeaders.map((header) => {
                    const value = getManualDetailRawValue(detail, header, detailAmount);
                    const isAmountColumn = header.includes("金额");
                    return (
                      <TableCell
                        key={header}
                        className={`${isAmountColumn ? "text-right font-medium text-blue-700" : "text-gray-700"} whitespace-nowrap`}
                        title={String(formatRawCell(header, value))}
                      >
                        {formatRawCell(header, value)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4">
          <ManualRecognitionForm
            selectedFlow={selectedFlow}
            manualRecognitionContext="detail"
            splits={splits}
            onSplitsChange={setSplits}
            treeEnabled={Boolean(selectedFlow)}
            splitCardClassName="space-y-3 rounded-lg border bg-white p-4"
            footer={
              <>
                <Button variant="outline" size="sm" disabled={manualRecognizeDetail.isPending} onClick={() => navigate(`/tasks/${taskId}?tab=details`)}>
                  取消
                </Button>
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700" disabled={!manualFlowId || manualRecognizeDetail.isPending} onClick={handleSave}>
                  {manualRecognizeDetail.isPending ? "保存中..." : "确认认账"}
                </Button>
              </>
            }
          />
        </CardContent>
      </Card>
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
