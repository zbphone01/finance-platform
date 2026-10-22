import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Search, BarChart3, TrendingUp, FileText, X, CalendarDays, FileCheck2, FileX2, MoreHorizontal, Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";

const DAY_PAGE_SIZE = 10;
const DETAIL_PAGE_SIZE = 15;
const detailIncomeTypeOptions = [
  "捐赠收入",
  "会费收入",
  "政府补助",
  "个税返还",
  "本金",
  "投资收益",
  "利息",
  "其他收入",
  "其他",
  "订单退款",
] as const;
type DetailIncomeTypeFilter = "all" | (typeof detailIncomeTypeOptions)[number];

function getProjectFundAmount(result: any) {
  return Number(result?.splitAmount || 0) - Number(result?.managementFeeAmount || 0);
}

const incomeTypesWithoutFundBreakdown = new Set([
  "会费收入",
  "政府补助",
  "个税返还",
  "本金",
  "投资收益",
  "利息",
  "其他收入",
  "其他",
]);

function shouldHideFundBreakdown(result: any) {
  return incomeTypesWithoutFundBreakdown.has(String(result?.incomeType || ""));
}

export default function ResultsPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const [dayPage, setDayPage] = useState(1);
  const [detailPage, setDetailPage] = useState(1);
  const [budgetCode, setBudgetCode] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [appliedFilter, setAppliedFilter] = useState<any>({});
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [detailIncomeType, setDetailIncomeType] = useState<DetailIncomeTypeFilter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedFlows, setSelectedFlows] = useState<any[]>([]);

  const statsQuery = trpc.result.stats.useQuery(undefined, { staleTime: 60_000 });
  const utils = trpc.useUtils();
  const dayGroupsQuery = trpc.result.dayGroups.useQuery({
    budgetCode: appliedFilter.budgetCode || undefined,
    startDate: appliedFilter.startDate || undefined,
    endDate: appliedFilter.endDate || undefined,
    page: dayPage,
    pageSize: DAY_PAGE_SIZE,
  }, { staleTime: 60_000 });
  const resultsQuery = trpc.result.list.useQuery({
    budgetCode: appliedFilter.budgetCode || undefined,
    startDate: selectedDate || undefined,
    endDate: selectedDate || undefined,
    incomeType: detailIncomeType === "all" ? undefined : detailIncomeType,
    page: detailPage,
    pageSize: DETAIL_PAGE_SIZE,
  }, { enabled: !!selectedDate, staleTime: 60_000 });

  const updateResultLockStatus = trpc.result.updateResultLockStatus.useMutation({
    onSuccess: () => {
      toast.success("锁定状态已更新");
      utils.result.list.invalidate();
      utils.result.dayGroups.invalidate();
    },
    onError: (err: any) => toast.error(err.message || "操作失败"),
  });

  useEffect(() => {
    const items = dayGroupsQuery.data?.items || [];
    if (items.length === 0) {
      setSelectedDate(null);
      return;
    }
    if (!selectedDate || !items.some((item: any) => item.entryTime === selectedDate)) {
      setSelectedDate(items[0].entryTime);
      setDetailPage(1);
    }
  }, [dayGroupsQuery.data, selectedDate]);

  const dayTotalPages = Math.ceil((dayGroupsQuery.data?.total || 0) / DAY_PAGE_SIZE);
  const detailTotalPages = Math.ceil((resultsQuery.data?.total || 0) / DETAIL_PAGE_SIZE);

  const handleSearch = () => {
    setDayPage(1);
    setDetailPage(1);
    setSelectedDate(null);
    setAppliedFilter({ budgetCode, startDate, endDate });
  };

  const clearFilters = () => {
    setBudgetCode("");
    setStartDate("");
    setEndDate("");
    setAppliedFilter({});
    setSelectedDate(null);
    setDayPage(1);
    setDetailPage(1);
  };

  const totalAmount = statsQuery.data?.totalAmount || 0;
  const todayAmount = statsQuery.data?.todayAmount || 0;
  const totalCount = statsQuery.data?.totalCount || 0;
  const activeDateTitle = selectedDate ? `${selectedDate} 入账明细` : "入账明细";
  const canManageVouchers = hasPermission("voucher_create");
  const canEditRecognitionAttributes = hasPermission("recognition_result_edit");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">入账结果</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">总入账金额</p>
                <p className="text-2xl font-bold text-blue-600">
                  ¥{Number(totalAmount).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                </p>
              </div>
              <BarChart3 className="h-8 w-8 text-blue-200" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">今日入账</p>
                <p className="text-2xl font-bold text-green-600">
                  ¥{Number(todayAmount).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                </p>
              </div>
              <TrendingUp className="h-8 w-8 text-green-200" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">入账记录数</p>
                <p className="text-2xl font-bold text-gray-700">{totalCount}</p>
              </div>
              <FileText className="h-8 w-8 text-gray-200" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Input
          placeholder="预算编码"
          value={budgetCode}
          onChange={(e) => setBudgetCode(e.target.value)}
          className="w-40"
        />
        <Input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="w-40"
        />
        <span className="text-gray-400">-</span>
        <Input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="w-40"
        />
        <Button variant="outline" onClick={handleSearch}>
          <Search className="h-4 w-4 mr-1" />
          搜索
        </Button>
        {(appliedFilter.budgetCode || appliedFilter.startDate || appliedFilter.endDate) && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-3 w-3 mr-1" />
            清除
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <div className="flex items-center gap-2 font-medium">
              <CalendarDays className="h-4 w-4 text-blue-600" />
              按天汇总
            </div>
            <div className="text-sm text-gray-500">共 {dayGroupsQuery.data?.total || 0} 天</div>
          </div>
          <Table className="w-max min-w-full table-auto">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[160px]">入账日期</TableHead>
                <TableHead className="text-right">当日总金额</TableHead>
                <TableHead className="text-right">入账条目数</TableHead>
                <TableHead className="text-right">已制单数</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dayGroupsQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8">加载中...</TableCell>
                </TableRow>
              ) : dayGroupsQuery.data?.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-gray-400">暂无入账记录</TableCell>
                </TableRow>
              ) : (
                dayGroupsQuery.data?.items.map((day: any) => {
                  const active = selectedDate === day.entryTime;
                  return (
                    <TableRow
                      key={day.entryTime}
                      onClick={() => {
                        setSelectedDate(day.entryTime);
                        setDetailPage(1);
                      }}
                      className={active ? "bg-blue-50 cursor-pointer" : "cursor-pointer hover:bg-gray-50"}
                    >
                      <TableCell className={active ? "font-semibold text-blue-700" : "font-medium"}>
                        {day.entryTime}
                      </TableCell>
                      <TableCell className="text-right font-medium text-blue-700">
                        ¥{Number(day.totalAmount || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right">{day.totalCount}</TableCell>
                      <TableCell className="text-right text-green-700">{day.createdCount}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {dayTotalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious onClick={() => setDayPage((p) => Math.max(1, p - 1))} />
            </PaginationItem>
            {Array.from({ length: Math.min(dayTotalPages, 10) }, (_, i) => i + 1).map((p) => (
              <PaginationItem key={p}>
                <PaginationLink isActive={p === dayPage} onClick={() => setDayPage(p)}>
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext onClick={() => setDayPage((p) => Math.min(dayTotalPages, p + 1))} />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b">
            <div className="font-medium">{activeDateTitle}</div>
            <div className="flex items-center gap-3">
              <Select
                value={detailIncomeType}
                onValueChange={(value) => {
                  setDetailIncomeType(value as DetailIncomeTypeFilter);
                  setDetailPage(1);
                }}
              >
                <SelectTrigger className="h-8 w-[140px] text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部</SelectItem>
                  {detailIncomeTypeOptions.map((incomeType) => (
                    <SelectItem key={incomeType} value={incomeType}>{incomeType}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="text-sm text-gray-500">共 {resultsQuery.data?.total || 0} 条</div>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[120px] text-xs">入账时间</TableHead>
                <TableHead className="text-xs">流水号</TableHead>
                <TableHead className="text-xs">收入类型</TableHead>
                <TableHead className="text-xs">捐赠来源</TableHead>
                <TableHead className="text-xs">收入属性</TableHead>
                <TableHead className="text-xs">收入部门</TableHead>
                <TableHead className="text-xs">预算编码</TableHead>
                <TableHead className="text-xs">NC项目名称</TableHead>
                <TableHead className="text-xs">平台项目名称</TableHead>
                <TableHead className="text-xs">平台项目详情</TableHead>
                <TableHead className="text-xs">支出资金来源</TableHead>
                <TableHead className="text-xs">反馈类型</TableHead>
                <TableHead className="text-xs">地区</TableHead>
                <TableHead className="text-xs">会员姓名</TableHead>
                <TableHead className="text-xs">所属项目中心</TableHead>
                <TableHead className="text-xs">匿名</TableHead>
                <TableHead className="w-[110px] min-w-[110px] text-right text-xs">订单明细数</TableHead>
                <TableHead className="text-xs">备注</TableHead>
                <TableHead className="w-[120px] min-w-[120px] text-right text-xs">入账金额</TableHead>
                <TableHead className="w-[120px] min-w-[120px] text-right text-xs">项目资金</TableHead>
                <TableHead className="w-[120px] min-w-[120px] text-right text-xs">管理费</TableHead>
                <TableHead className="sticky right-0 z-30 w-[124px] min-w-[124px] max-w-[124px] bg-white text-center text-xs">状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!selectedDate ? (
                <TableRow>
                  <TableCell colSpan={22} className="text-center py-8 text-gray-400">请选择入账日期</TableCell>
                </TableRow>
              ) : resultsQuery.isError ? (
                <TableRow>
                  <TableCell colSpan={22} className="text-center py-8 text-red-500">
                    入账明细加载失败，请确认本地数据库迁移已执行
                  </TableCell>
                </TableRow>
              ) : resultsQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={22} className="text-center py-8">加载中...</TableCell>
                </TableRow>
              ) : resultsQuery.data?.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={22} className="text-center py-8 text-gray-400">暂无入账记录</TableCell>
                </TableRow>
              ) : (
                resultsQuery.data?.items.map((r: any) => {
                  const flow = r.bankFlow;
                  const isCreated = r.voucherStatus === "created";
                  const lockedByVoucher = Boolean(r.hasVoucherLine);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="text-sm text-gray-600">{r.entryTime || "-"}</TableCell>
                      <TableCell>
                        {flow ? (
                          <button
                            className="text-blue-600 hover:underline font-mono text-xs cursor-pointer bg-transparent border-0 p-0"
                            onClick={() => {
                              setSelectedFlows([flow]);
                              setDialogOpen(true);
                            }}
                          >
                            {flow.referenceNo || "-"}
                          </button>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{r.incomeType || "-"}</TableCell>
                      <TableCell className="text-xs">{r.donationSource || "-"}</TableCell>
                      <TableCell className="text-xs">{r.incomeAttr || "-"}</TableCell>
                      <TableCell className="text-xs">{r.incomeDept || "-"}</TableCell>
                      <TableCell className="text-xs">{r.budgetCode || "-"}</TableCell>
                      <TableCell className="text-xs">{r.incomeProject || "-"}</TableCell>
                      <TableCell className="text-xs">{r.platformProjectDisplayName || r.platformProjectName || "-"}</TableCell>
                      <TableCell className="text-xs">{r.platformProjectDetail || "-"}</TableCell>
                      <TableCell className="text-xs">{r.expenseFundSource || "-"}</TableCell>
                      <TableCell className="text-xs">{r.feedbackType || "-"}</TableCell>
                      <TableCell className="text-xs">{r.region || "-"}</TableCell>
                      <TableCell className="text-xs">{r.memberName || "-"}</TableCell>
                      <TableCell className="text-xs">{r.projectCenter || "-"}</TableCell>
                      <TableCell className="text-xs">{r.memberName || r.isAnonymous ? (r.isAnonymous ? "是" : "否") : "-"}</TableCell>
                      <TableCell className="w-[110px] min-w-[110px] text-right">
                        {r.ruleItemId ? Number(r.orderDetailCountSnapshot || 0).toLocaleString("zh-CN") : "-"}
                      </TableCell>
                      <TableCell className="text-xs">{r.remark || "-"}</TableCell>
                      <TableCell className="w-[120px] min-w-[120px] text-right font-medium text-blue-700">
                        ¥{Number(r.splitAmount || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="w-[120px] min-w-[120px] text-right font-medium text-emerald-700">
                        {shouldHideFundBreakdown(r) ? "-" : `¥${getProjectFundAmount(r).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </TableCell>
                      <TableCell className="w-[120px] min-w-[120px] text-right font-medium">
                        {shouldHideFundBreakdown(r) ? "-" : `¥${Number(r.managementFeeAmount || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </TableCell>
                      <TableCell className="sticky right-0 z-20 w-[124px] min-w-[124px] max-w-[124px] bg-white text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Badge className={isCreated ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"}>
                            {lockedByVoucher ? "已制单" : isCreated ? "已锁定" : "未锁定"}
                          </Badge>
                          {!lockedByVoucher && (canManageVouchers || canEditRecognitionAttributes) && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="更多操作">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {canEditRecognitionAttributes && (
                                  <DropdownMenuItem
                                    disabled={isCreated}
                                    onClick={() => navigate(`/results/${Number(r.id)}/edit`)}
                                  >
                                    <Pencil className="mr-2 h-4 w-4 text-blue-600" />
                                    {isCreated ? "修改认账（需先取消锁定）" : "修改认账"}
                                  </DropdownMenuItem>
                                )}
                                {canManageVouchers && (
                                  <DropdownMenuItem
                                    disabled={updateResultLockStatus.isPending}
                                    onClick={() => updateResultLockStatus.mutate({
                                      id: Number(r.id),
                                      locked: !isCreated,
                                    })}
                                  >
                                    {isCreated ? (
                                      <FileX2 className="mr-2 h-4 w-4 text-red-600" />
                                    ) : (
                                      <FileCheck2 className="mr-2 h-4 w-4 text-green-600" />
                                    )}
                                    {isCreated ? "取消锁定" : "锁定"}
                                  </DropdownMenuItem>
                                )}
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
        </CardContent>
      </Card>

      {detailTotalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious onClick={() => setDetailPage((p) => Math.max(1, p - 1))} />
            </PaginationItem>
            {Array.from({ length: Math.min(detailTotalPages, 10) }, (_, i) => i + 1).map((p) => (
              <PaginationItem key={p}>
                <PaginationLink isActive={p === detailPage} onClick={() => setDetailPage(p)}>
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext onClick={() => setDetailPage((p) => Math.min(detailTotalPages, p + 1))} />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>银行流水详情</DialogTitle>
          </DialogHeader>
          <div>
            {selectedFlows.length === 0 ? (
              <div className="text-center text-gray-400 py-4">无关联流水</div>
            ) : (
              selectedFlows.map((flow: any, idx: number) => (
                <div key={flow.id || idx} className="border rounded-lg p-4 text-sm space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-gray-700">流水号</span>
                    <span className="font-mono text-blue-600">{flow.referenceNo || "-"}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div><span className="text-gray-400">交易时间:</span> {flow.transactionTime || "-"}</div>
                    <div><span className="text-gray-400">收入金额:</span> <span className="text-blue-700 font-medium">¥{Number(flow.income || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</span></div>
                    <div><span className="text-gray-400">对方账号:</span> {flow.counterpartyAccount || "-"}</div>
                    <div><span className="text-gray-400">对方户名:</span> {flow.counterpartyName || "-"}</div>
                    <div><span className="text-gray-400">用途:</span> {flow.purpose || "-"}</div>
                    <div><span className="text-gray-400">附言:</span> {flow.postScript || "-"}</div>
                    <div><span className="text-gray-400">对方银行:</span> {flow.counterpartyBank || "-"}</div>
                    <div><span className="text-gray-400">摘要:</span> {flow.summary || "-"}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
