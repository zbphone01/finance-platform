import { useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";

const PAGE_SIZE = 50;

function formatAmount(value: unknown) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toLocaleString("zh-CN", { minimumFractionDigits: 2 }) : "-";
}

export default function VoucherResultsPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const canCreateVouchers = hasPermission("voucher_create");
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [flowStatus, setFlowStatus] = useState("");
  const listQuery = trpc.voucherSummary.list.useQuery({
    page,
    pageSize: PAGE_SIZE,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    flowStatus: (flowStatus || undefined) as any,
  });
  const cancelManualVoucher = trpc.voucherSummary.cancelManual.useMutation({
    onSuccess: async (result) => {
      toast.success(`已取消${result.incomeType}手工凭证`);
      await Promise.all([
        utils.voucherSummary.list.invalidate(),
        utils.task.getFlows.invalidate(),
        utils.result.list.invalidate(),
        utils.result.dayGroups.invalidate(),
      ]);
    },
    onError: (err: any) => toast.error(err.message || "取消手工凭证失败"),
  });
  const items = listQuery.data?.items || [];
  const totalPages = Math.max(1, Math.ceil((listQuery.data?.total || 0) / PAGE_SIZE));
  const updateStartDate = (value: string) => {
    setStartDate(value);
    setPage(1);
  };
  const updateEndDate = (value: string) => {
    setEndDate(value);
    setPage(1);
  };
  const updateFlowStatus = (value: string) => {
    setFlowStatus(value === "__all" ? "" : value);
    setPage(1);
  };
  const resetFilters = () => {
    setStartDate("");
    setEndDate("");
    setFlowStatus("");
    setPage(1);
  };
  const handleCancelManualVoucher = (item: (typeof items)[number]) => {
    if (!item.voucherResultId || item.voucherKind !== "manual") return;
    if (!confirm(`确定取消${item.voucherIncomeType || ""}手工凭证 ${item.voucherId || "-"}？\n取消后对应收入类型将恢复为待制单。`)) return;
    cancelManualVoucher.mutate({ voucherResultId: Number(item.voucherResultId) });
  };
  const renderStatus = (item: (typeof items)[number]) => {
    if (item.status === "processing") {
      return <Badge className="bg-blue-100 text-blue-800">认账执行中</Badge>;
    }
    if (item.status === "recognized") {
      return (
        <Badge className="bg-green-100 text-green-800">
          {item.hasVoucher ? "已认账/已制单" : "已认账"}
        </Badge>
      );
    }
    if (item.status === "variance_partial_matched") {
      return <Badge className="bg-red-100 text-red-800">部分认账</Badge>;
    }
    if (item.status === "variance_unrecognized") {
      return <Badge className="bg-red-100 text-red-800">未认账</Badge>;
    }
    if (item.status === "partial_matched") {
      return <Badge className="bg-orange-100 text-orange-800">部分认账</Badge>;
    }
    return <Badge className="bg-gray-100 text-gray-600">未认账</Badge>;
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">凭证汇总</h1>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <div className="text-xs text-gray-500">开始日期</div>
          <Input className="h-9 w-40" type="date" value={startDate} onChange={(e) => updateStartDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-gray-500">结束日期</div>
          <Input className="h-9 w-40" type="date" value={endDate} onChange={(e) => updateEndDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-gray-500">流水状态</div>
          <Select value={flowStatus || "__all"} onValueChange={updateFlowStatus}>
            <SelectTrigger className="h-9 w-44">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">全部状态</SelectItem>
              <SelectItem value="unrecognized">未认账</SelectItem>
              <SelectItem value="recognized">已认账</SelectItem>
              <SelectItem value="recognized_with_voucher">已认账/已制单</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" className="h-9" onClick={resetFilters}>重置</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">凭证日期</TableHead>
                <TableHead>银行流水</TableHead>
                <TableHead className="w-32 text-right">到账金额</TableHead>
                <TableHead className="w-36 text-center">流水状态</TableHead>
                <TableHead className="w-28">凭证ID</TableHead>
                <TableHead className="w-32 text-right">凭证金额</TableHead>
                <TableHead className="w-40 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-gray-500">加载中...</TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-gray-400">暂无数据</TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.groupKey || `${item.id}-${item.voucherId || "none"}`}>
                    <TableCell className="font-mono text-sm">{item.voucherDate || item.flowDate || "-"}</TableCell>
                    <TableCell className="min-w-[260px] whitespace-normal break-words">
                      {item.referenceNo || "-"}
                    </TableCell>
                    <TableCell className="text-right font-medium text-blue-700">{formatAmount(item.income)}</TableCell>
                    <TableCell className="text-center">{renderStatus(item)}</TableCell>
                    <TableCell className="font-medium">{item.voucherId || "-"}</TableCell>
                    <TableCell className="text-right">{item.voucherAmount ? formatAmount(item.voucherAmount) : "-"}</TableCell>
                    <TableCell className="text-right">
                      {item.voucherKind === "manual" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-3 text-orange-600 hover:text-orange-700"
                          title={canCreateVouchers ? "取消手工凭证" : "无制单权限"}
                          disabled={!canCreateVouchers || cancelManualVoucher.isPending}
                          onClick={() => handleCancelManualVoucher(item)}
                        >
                          取消手工凭证
                        </Button>
                      ) : item.hasView ? (
                        <Button size="sm" variant="outline" className="h-7 px-3" onClick={() => navigate(`/voucher-results/${item.id}`)}>
                          查看凭证
                        </Button>
                      ) : "-"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious onClick={() => setPage((current) => Math.max(1, current - 1))} />
            </PaginationItem>
            {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNo) => (
              <PaginationItem key={pageNo}>
                <PaginationLink isActive={pageNo === page} onClick={() => setPage(pageNo)}>
                  {pageNo}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext onClick={() => setPage((current) => Math.min(totalPages, current + 1))} />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
