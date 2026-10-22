import { useNavigate, useParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { usePermissions } from "@/hooks/usePermissions";

const overviewRowCheckFields = [
  "结算方式",
  "银行账户",
];

const detailRowCheckFields = [
  "年度",
  "部门",
  "客户档案",
  "收款渠道",
  "收入预算",
  "项目名称",
  "资金来源",
  "收款活动类型",
];

type VoucherLineType = "overview" | "project_fund" | "management_fee";
type VoucherLineExplanation = Record<string, string>;

type VoucherPreviewRow = {
  matchResultId: number;
  lineNo: number;
  summary: string;
  subjectCode: string;
  subjectName: string;
  debitAmount: string;
  creditAmount: string;
  lineType?: VoucherLineType;
  explanation?: VoucherLineExplanation | null;
};

type VoucherPreviewSnapshot = {
  voucherId?: number;
  flow?: {
    date?: string;
    referenceNo?: string;
  };
  rows?: VoucherPreviewRow[];
};

export default function VoucherResultDetailPage() {
  const { flowId } = useParams<{ flowId: string }>();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const canCancelVoucher = hasPermission("voucher_cancel");
  const numericFlowId = Number(flowId || 0);
  const previewQuery = trpc.voucherSummary.previewByFlow.useQuery(
    { flowId: numericFlowId },
    { enabled: numericFlowId > 0, refetchOnMount: "always" },
  );
  const utils = trpc.useUtils();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const cancelVoucherMutation = trpc.voucherSummary.cancelByFlow.useMutation({
    onSuccess: () => {
      setCancelDialogOpen(false);
      utils.task.getFlows.invalidate();
      utils.voucherSummary.list.invalidate();
      utils.voucherSummary.previewByFlow.invalidate({ flowId: numericFlowId });
      utils.result.list.invalidate();
      utils.result.dayGroups.invalidate();
      toast.success("已取消凭证");
      navigate(-1);
    },
    onError: (err: any) => toast.error(err.message || "取消凭证失败"),
  });
  const data: VoucherPreviewSnapshot | undefined = previewQuery.data;
  const rows: VoucherPreviewRow[] = data?.rows || [];
  const [openRowKey, setOpenRowKey] = useState("");
  const debitTotal = rows.reduce((sum, row) => sum + Number(row.debitAmount || 0), 0);
  const creditTotal = rows.reduce((sum, row) => sum + Number(row.creditAmount || 0), 0);

  const cancelVoucher = () => {
    if (!numericFlowId || rows.length === 0) return;
    setCancelDialogOpen(true);
  };
  const canOpenExplanation = (row: VoucherPreviewRow) => row.lineType === "overview" || row.lineType === "project_fund" || row.lineType === "management_fee";
  const getRowCheckFields = (row: VoucherPreviewRow) => row.lineType === "overview" ? overviewRowCheckFields : detailRowCheckFields;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            返回
          </Button>
          <div>
            <h1 className="text-xl font-semibold">收入凭证 - {data?.voucherId || "-"}</h1>
            <div className="mt-1 text-sm text-gray-500">
              银行流水：{String(data?.flow?.referenceNo || "").includes("多日汇总")
                ? data?.flow?.referenceNo
                : `${data?.flow?.date || "-"} ${data?.flow?.referenceNo || "-"}`}
            </div>
          </div>
        </div>
        <Button
          variant="destructive"
          size="sm"
          title={canCancelVoucher ? "取消凭证" : "无取消制单权限"}
          disabled={!canCancelVoucher || rows.length === 0 || cancelVoucherMutation.isPending}
          onClick={cancelVoucher}
        >
          取消凭证
        </Button>
      </div>

      <AlertDialog
        open={cancelDialogOpen}
        onOpenChange={(open) => {
          if (!cancelVoucherMutation.isPending) setCancelDialogOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认取消凭证？</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelVoucherMutation.isPending}>返回</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={cancelVoucherMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                cancelVoucherMutation.mutate({ flowId: numericFlowId });
              }}
            >
              {cancelVoucherMutation.isPending ? "取消中..." : "确认取消"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table className="min-w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px] text-center">序号</TableHead>
                  <TableHead>摘要</TableHead>
                  <TableHead>科目编码</TableHead>
                  <TableHead>科目名称</TableHead>
                  <TableHead className="text-right">借方金额</TableHead>
                  <TableHead className="text-right">贷方金额</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-gray-500">加载中...</TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-gray-400">暂无制单数据</TableCell>
                  </TableRow>
                ) : (
                  <>
                    {rows.map((row, index) => {
                      const rowKey = `${row.matchResultId}-${index}`;
                      const isExplainable = canOpenExplanation(row);
                      return (
                        <TableRow
                          key={rowKey}
                          className={`${isExplainable ? "cursor-pointer hover:bg-blue-50/60" : ""} ${openRowKey === rowKey ? "bg-blue-50" : ""}`}
                          onClick={() => {
                            if (isExplainable) setOpenRowKey(openRowKey === rowKey ? "" : rowKey);
                          }}
                        >
                          <TableCell className="text-center">{row.lineNo}</TableCell>
                          <TableCell className="min-w-[360px]">
                            {isExplainable ? (
                              <Popover
                                open={openRowKey === rowKey}
                                onOpenChange={(open) => setOpenRowKey(open ? rowKey : "")}
                              >
                                <PopoverTrigger asChild>
                                  <span className="block">{row.summary}</span>
                                </PopoverTrigger>
                                <PopoverContent side="bottom" align="start" sideOffset={8} className="w-max max-w-[min(720px,calc(100vw-32px))] p-0">
                                  <Table>
                                    <TableBody>
                                      {getRowCheckFields(row).map((field) => (
                                        <TableRow key={field}>
                                          <TableCell className="w-32 whitespace-nowrap px-2 py-1 text-xs text-gray-500">{field}</TableCell>
                                          <TableCell className="max-w-[560px] whitespace-normal break-words px-2 py-1 text-xs">{row.explanation?.[field] || "-"}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </PopoverContent>
                              </Popover>
                            ) : (
                              <span className="block">{row.summary}</span>
                            )}
                          </TableCell>
                          <TableCell>{row.subjectCode}</TableCell>
                          <TableCell>{row.subjectName}</TableCell>
                          <TableCell className="text-right">{row.debitAmount}</TableCell>
                          <TableCell className="text-right">{row.creditAmount}</TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="bg-gray-50 font-medium">
                      <TableCell className="text-center">总计</TableCell>
                      <TableCell />
                      <TableCell />
                      <TableCell />
                      <TableCell className="text-right">{debitTotal.toFixed(2)}</TableCell>
                      <TableCell className="text-right">{creditTotal.toFixed(2)}</TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
