import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, CalendarArrowUp, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

type ProcessingStatus = "ignored" | "transferred" | "transferred_recognized";

export default function IgnoredOrderDetailsPage() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const [ruleIdFilter, setRuleIdFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProcessingStatus | "">("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferDate, setTransferDate] = useState("");
  const [cancelOperationTarget, setCancelOperationTarget] = useState<any | null>(null);
  const [cancelOperationWarning, setCancelOperationWarning] = useState<any | null>(null);

  const detailsQuery = trpc.task.listIgnoredDetails.useQuery({
    ruleId: ruleIdFilter ? Number(ruleIdFilter) : undefined,
    status: statusFilter || undefined,
    page,
    pageSize: 20,
  });

  const transferMutation = trpc.task.transferIgnoredDetails.useMutation({
    onSuccess: (result) => {
      toast.success(`已转移 ${result.transferredCount || 0} 条明细`);
      setSelectedIds([]);
      setTransferOpen(false);
      setTransferDate("");
      utils.task.listIgnoredDetails.invalidate();
      utils.task.list.invalidate();
      utils.task.getById.invalidate();
    },
    onError: (err: any) => toast.error(err.message || "转移失败"),
  });

  const cancelOperation = trpc.task.cancelDetailOperation.useMutation({
    onSuccess: async (result) => {
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
      setSelectedIds([]);
      await Promise.all([
        utils.task.listIgnoredDetails.invalidate(),
        utils.task.list.invalidate(),
        utils.task.getById.invalidate(),
        utils.task.getDetails.invalidate(),
        utils.task.getFlows.invalidate(),
        utils.result.list.invalidate(),
        utils.result.dayGroups.invalidate(),
      ]);
    },
    onError: (err: any) => toast.error(err.message || "取消失败"),
  });

  const items = useMemo(() => detailsQuery.data?.items || [], [detailsQuery.data?.items]);
  const itemIds = useMemo(() => items
    .filter((item: any) =>
      item.operationStatus === "ignored"
      && item.detailPackageType !== "打包明细"
    )
    .map((item: any) => Number(item.id))
    .filter(Boolean), [items]);
  const allPageSelected = itemIds.length > 0 && itemIds.every((id: number) => selectedIds.includes(id));
  const totalPages = Math.max(1, Math.ceil((detailsQuery.data?.total || 0) / 20));

  const updateRuleFilter = (value: string) => {
    setRuleIdFilter(value === "__all" ? "" : value);
    setPage(1);
    setSelectedIds([]);
  };

  const updateStatusFilter = (value: string) => {
    setStatusFilter(value === "__all" ? "" : value as ProcessingStatus);
    setPage(1);
    setSelectedIds([]);
  };

  const getItemStatus = (item: any): ProcessingStatus => {
    if (item.operationStatus === "transferred" && item.matchResultId) {
      return "transferred_recognized";
    }
    return item.operationStatus === "transferred" ? "transferred" : "ignored";
  };

  const toggleSelected = (id: number) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const togglePageSelected = () => {
    setSelectedIds((current) => {
      if (allPageSelected) return current.filter((id) => !itemIds.includes(id));
      return Array.from(new Set([...current, ...itemIds]));
    });
  };

  const handleTransfer = () => {
    if (selectedIds.length === 0) {
      toast.error("请选择订单明细");
      return;
    }
    if (!transferDate) {
      toast.error("请选择目标日期");
      return;
    }
    transferMutation.mutate({ detailIds: selectedIds, targetDate: transferDate });
  };

  const requestCancelOperation = (item: any) => {
    setCancelOperationTarget(item);
    setCancelOperationWarning(null);
    cancelOperation.mutate({ detailId: Number(item.id) });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate("/")}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            返回
          </Button>
          <h1 className="text-xl font-semibold">人工处理订单</h1>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
              <div>
                <div className="text-xs text-gray-500">已忽略条数</div>
                <div className="mt-1 text-lg font-semibold text-gray-900">
                  {Number(detailsQuery.data?.summary?.ignoredCount || 0).toLocaleString("zh-CN")}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">已转移条数</div>
                <div className="mt-1 text-lg font-semibold text-blue-700">
                  {Number(detailsQuery.data?.summary?.transferredCount || 0).toLocaleString("zh-CN")}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">已转移/已认账条数</div>
                <div className="mt-1 text-lg font-semibold text-emerald-700">
                  {Number(detailsQuery.data?.summary?.transferredRecognizedCount || 0).toLocaleString("zh-CN")}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select value={statusFilter || "__all"} onValueChange={updateStatusFilter}>
                <SelectTrigger className="h-8 w-[180px]">
                  <SelectValue placeholder="全部状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">全部状态</SelectItem>
                  <SelectItem value="ignored">已忽略</SelectItem>
                  <SelectItem value="transferred">已转移</SelectItem>
                  <SelectItem value="transferred_recognized">已转移/已认账</SelectItem>
                </SelectContent>
              </Select>
              <Select value={ruleIdFilter || "__all"} onValueChange={updateRuleFilter}>
                <SelectTrigger className="h-8 w-[240px]">
                  <SelectValue placeholder="全部明细认账规则" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">全部明细认账规则</SelectItem>
                  {(detailsQuery.data?.ruleOptions || []).map((rule: any) => (
                    <SelectItem key={rule.id} value={String(rule.id)}>{rule.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="p-4 pb-0">
            <span className="text-sm text-gray-500">共 {detailsQuery.data?.total || 0} 条</span>
          </div>
          <div className="overflow-auto">
            <Table className="w-max min-w-full table-auto">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input type="checkbox" checked={allPageSelected} onChange={togglePageSelected} aria-label="选择当前页" />
                  </TableHead>
                  <TableHead className="whitespace-nowrap">日期汇总</TableHead>
                  <TableHead className="whitespace-nowrap">订单日期/匹配日期</TableHead>
                  <TableHead className="whitespace-nowrap">订单号</TableHead>
                  <TableHead className="whitespace-nowrap">明细认账规则</TableHead>
                  <TableHead className="whitespace-nowrap">认账关键字</TableHead>
                  <TableHead className="text-right whitespace-nowrap">订单金额</TableHead>
                  <TableHead className="whitespace-nowrap">操作原因</TableHead>
                  <TableHead className="sticky right-0 z-10 min-w-[190px] whitespace-nowrap bg-white text-center shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]">状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detailsQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8">加载中...</TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-gray-400">暂无人工处理订单</TableCell>
                  </TableRow>
                ) : (
                  items.map((item: any) => {
                    const id = Number(item.id);
                    const selected = selectedIds.includes(id);
                    const itemStatus = getItemStatus(item);
                    const transferable = itemStatus === "ignored"
                      && item.detailPackageType !== "打包明细";
                    return (
                      <TableRow key={id} data-state={selected ? "selected" : undefined}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={!transferable}
                            title={transferable
                              ? "选择订单明细"
                              : itemStatus !== "ignored"
                                ? "已转移订单不能再次转移"
                                : "打包明细不支持转移"}
                            onChange={() => toggleSelected(id)}
                            aria-label={`选择订单明细 ${id}`}
                          />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-gray-600">{item.summaryDate || "-"}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-gray-600">
                          {item.detailPackageType === "打包明细" ? item.uploadDate || "-" : item.billDate || "-"}
                        </TableCell>
                        <TableCell className="font-mono text-xs whitespace-nowrap" title={item.billNo || ""}>{item.billNo || "-"}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap" title={item.ruleName || ""}>{item.ruleName || "-"}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap" title={item.description || ""}>{item.description || "-"}</TableCell>
                        <TableCell className="font-medium text-blue-700 text-right whitespace-nowrap">
                          {Number(item.amount || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="w-auto whitespace-nowrap text-sm text-gray-500">
                          {item.ignoreReason || "-"}
                        </TableCell>
                        <TableCell className="sticky right-0 z-10 min-w-[190px] bg-white text-center shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]">
                          <div className="flex items-center justify-center gap-1">
                            <Badge className={
                              itemStatus === "ignored"
                                ? "bg-slate-100 text-slate-700"
                                : itemStatus === "transferred"
                                  ? "bg-blue-100 text-blue-800"
                                  : "bg-emerald-100 text-emerald-800"
                            }>
                              {itemStatus === "ignored"
                                ? "已忽略"
                                : itemStatus === "transferred"
                                  ? "已转移"
                                  : "已转移/已认账"}
                            </Badge>
                            {item.archived && <Badge variant="outline" className="text-gray-500">已归档</Badge>}
                            {itemStatus !== "transferred_recognized" && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7">
                                    <MoreHorizontal className="h-3.5 w-3.5 text-gray-500" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    disabled={cancelOperation.isPending}
                                    onClick={() => requestCancelOperation(item)}
                                  >
                                    取消{itemStatus === "ignored" ? "忽略" : "转移"}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 p-4">
            <Button size="sm" onClick={() => setTransferOpen(true)} disabled={selectedIds.length === 0}>
              <CalendarArrowUp className="h-4 w-4 mr-1" />
              转移日期
            </Button>
            {detailsQuery.data && detailsQuery.data.total > 20 && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}>
                  上一页
                </Button>
                <span className="text-sm text-gray-500 self-center">第 {page} 页 / 共 {totalPages} 页</span>
                <Button variant="outline" size="sm" onClick={() => setPage((value) => value + 1)} disabled={page >= totalPages}>
                  下一页
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

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

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>转移日期</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-gray-500">已选择 {selectedIds.length} 条已忽略订单</div>
            <div className="space-y-1">
              <Label>目标日期</Label>
              <Input type="date" value={transferDate} onChange={(e) => setTransferDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setTransferOpen(false)}>取消</Button>
            <Button size="sm" disabled={!transferDate || selectedIds.length === 0 || transferMutation.isPending} onClick={handleTransfer}>
              确认转移
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
