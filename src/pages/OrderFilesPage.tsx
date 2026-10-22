import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Badge } from "@/components/ui/badge";
import { Search, Eye, ListFilter, ListChecks, LoaderCircle, Trash2, RefreshCw, Unlink, CircleHelp } from "lucide-react";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";

function splitGroupText(value: string | null | undefined) {
  return String(value || "")
    .split("||")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getGroupFiles(value: string | null | undefined) {
  return splitGroupText(value)
    .map((item) => {
      const separatorIndex = item.indexOf("::");
      const id = Number(separatorIndex > 0 ? item.slice(0, separatorIndex) : 0);
      const fileName = separatorIndex > 0 ? item.slice(separatorIndex + 2) : "";
      return id > 0 && fileName ? { id, fileName } : null;
    })
    .filter((item): item is { id: number; fileName: string } => Boolean(item));
}

function getUploadFileInfos(group: any) {
  const uploadFileInfos = splitGroupText(group.uploadFileInfos).map((item) => {
    const separatorIndex = item.indexOf("::");
    if (separatorIndex <= 0) return null;
    return {
      uploadInfo: item.slice(0, separatorIndex),
      fileName: item.slice(separatorIndex + 2),
    };
  }).filter((item): item is { uploadInfo: string; fileName: string } => Boolean(item));
  if (uploadFileInfos.length > 0) return uploadFileInfos;

  const fileNames = splitGroupText(group.fileNames);
  const uploadInfos = splitGroupText(group.uploadInfos);
  const length = Math.max(fileNames.length, uploadInfos.length);
  return Array.from({ length }, (_, idx) => ({
    uploadInfo: uploadInfos[idx] || "-",
    fileName: fileNames[idx] || "-",
  }));
}

type UploadFileInfo = {
  uploadInfo: string;
  fileName: string;
};

function getGroupStatus(group: any) {
  if (Number(group.failedCount || 0) > 0) return "failed";
  if (Number(group.abnormalCount || 0) > 0) return "abnormal";
  if (Number(group.processingCount || 0) > 0) return "processing";
  if (Number(group.unboundPackageCount || 0) > 0) return "unbound";
  return "completed";
}

const DELETING_ORDER_PACKAGE_KEY = "financeRecon.deletingOrderPackage";
const DELETING_ORDER_PACKAGE_TTL = 30 * 60 * 1000;
type DeletingPackageState = {
  key: string;
  deleteId: string;
  wholePackage: boolean;
  startedAt: number;
};

function getPackageKey(group: any) {
  return `${group.sourceType || "recognition"}-${group.billDate}-${group.detailPackageType || "T+1"}-${group.ruleId || 0}`;
}

function readPersistedDeletingPackage(): DeletingPackageState | null {
  try {
    const raw = window.localStorage.getItem(DELETING_ORDER_PACKAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<DeletingPackageState>;
    if (!data.key || !data.deleteId || !data.startedAt || Date.now() - data.startedAt > DELETING_ORDER_PACKAGE_TTL) {
      window.localStorage.removeItem(DELETING_ORDER_PACKAGE_KEY);
      return null;
    }
    return {
      key: data.key,
      deleteId: data.deleteId,
      wholePackage: Boolean(data.wholePackage),
      startedAt: data.startedAt,
    };
  } catch {
    return null;
  }
}

function persistDeletingPackage(state: DeletingPackageState) {
  window.localStorage.setItem(DELETING_ORDER_PACKAGE_KEY, JSON.stringify(state));
}

function clearPersistedDeletingPackage() {
  window.localStorage.removeItem(DELETING_ORDER_PACKAGE_KEY);
}

export default function OrderFilesPage() {
  const [listSearchParams] = useSearchParams();
  const initialPage = Number(listSearchParams.get("page"));
  const [page, setPage] = useState(Number.isInteger(initialPage) && initialPage > 0 ? initialPage : 1);
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [deletingPackage, setDeletingPackage] = useState<DeletingPackageState | null>(() => readPersistedDeletingPackage());
  const [hiddenDeletedPackageKeys, setHiddenDeletedPackageKeys] = useState<string[]>([]);
  const [deleteDialogGroup, setDeleteDialogGroup] = useState<any | null>(null);
  const [deleteScope, setDeleteScope] = useState("all");
  const [deleteStepIndex, setDeleteStepIndex] = useState(0);
  const [deleteComplete, setDeleteComplete] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [uploadInfoDialog, setUploadInfoDialog] = useState<{
    group: any;
    infos: UploadFileInfo[];
  } | null>(null);
  const [matchCandidateDialog, setMatchCandidateDialog] = useState<any | null>(null);
  const [selectedMatchSolution, setSelectedMatchSolution] = useState("0");
  const { hasPermission } = usePermissions();
  const canDeleteOrderDetailPackage = hasPermission("order_detail_package_delete");
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const finalizedDeleteIdRef = useRef("");
  const deletingPackageKey = deletingPackage?.key || "";

  const filesQuery = trpc.orderFile.list.useQuery({
    search: searchQuery || undefined,
    page,
    pageSize: 20,
  });
  const startDeletePackage = trpc.orderFile.startDeletePackage.useMutation({
    onError: (err: any) => {
      setDeleteStepIndex(0);
      setDeleteComplete(false);
      setDeleteError(err.message || "删除失败");
      toast.error(err.message || "删除失败");
      clearPersistedDeletingPackage();
      setDeletingPackage(null);
    },
  });
  const deleteStatusQuery = trpc.orderFile.getDeletePackageStatus.useQuery(
    { deleteId: deletingPackage?.deleteId || "" },
    {
      enabled: Boolean(deletingPackage?.deleteId),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "completed" || status === "failed" ? false : 1000;
      },
    },
  );
  const matchCandidatesQuery = trpc.orderFile.getMultiDayMatchCandidates.useQuery(
    { groupId: Number(matchCandidateDialog?.multiDayMatchGroupId || 0) },
    { enabled: Number(matchCandidateDialog?.multiDayMatchGroupId || 0) > 0 },
  );
  const confirmMultiDayMatch = trpc.orderFile.confirmMultiDayMatch.useMutation({
    onSuccess: async (result) => {
      setMatchCandidateDialog(null);
      setSelectedMatchSolution("0");
      await Promise.all([
        utils.orderFile.list.invalidate(),
        utils.task.list.invalidate(),
        utils.task.getById.invalidate(),
      ]);
      toast.success(`已确认 ${result.flowCount} 笔银行到账，认账任务已加入队列`);
    },
    onError: (err: any) => {
      toast.error(err.message || "确认流水组合失败");
      void matchCandidatesQuery.refetch();
    },
  });
  const matchPackageBankFlow = trpc.orderFile.matchPackageBankFlow.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        utils.orderFile.list.invalidate(),
        utils.task.list.invalidate(),
        utils.task.getById.invalidate(),
      ]);
      if ("status" in result && result.status === "pending_confirmation") {
        toast.info(`找到 ${result.solutionCount} 组匹配方案，请在“匹配待确认”中选择`);
      } else if ("status" in result && result.status === "unmatched") {
        toast.info("暂未找到金额一致的银行流水或流水组合");
      } else {
        toast.success(`已匹配 ${result.billDate} 银行流水，认账任务已加入队列`);
      }
    },
    onError: (err: any) => {
      toast.error(err.message || "匹配流水失败");
    },
  });

  const handleView = (group: any) => {
    const params = new URLSearchParams({ returnPage: String(page) });
    navigate(`/order-files/${group.primaryFileId}?${params.toString()}`);
  };
  const handleViewUnmatched = (group: any) => {
    const params = new URLSearchParams({
      billDate: String(group.billDate || ""),
      ruleId: String(group.ruleId || 0),
      detailPackageType: group.detailPackageType === "打包明细" ? "打包明细" : "T+1",
      matchStatus: "unmatched",
      returnPage: String(page),
    });
    navigate(`/order-files/${group.primaryFileId}?${params.toString()}`);
  };
  const handleViewPendingSplit = (group: any) => {
    const params = new URLSearchParams({
      billDate: String(group.billDate || ""),
      ruleId: String(group.ruleId || 0),
      detailPackageType: group.detailPackageType === "打包明细" ? "打包明细" : "T+1",
      matchStatus: "pending_split",
      returnPage: String(page),
    });
    navigate(`/order-files/${group.primaryFileId}?${params.toString()}`);
  };
  const handleViewUploadInfo = (group: any) => {
    setUploadInfoDialog({
      group,
      infos: getUploadFileInfos(group),
    });
  };
  const deleteGroupDetails = async (group: any, orderFileId?: number) => {
    const packageKey = getPackageKey(group);
    try {
      const session = await startDeletePackage.mutateAsync({
        billDate: group.billDate,
        ruleId: Number(group.ruleId || 0),
        detailPackageType: group.sourceType === "invoice_only"
          ? "不认账"
          : group.detailPackageType === "打包明细" ? "打包明细" : "T+1",
        sourceType: group.sourceType === "invoice_only" ? "invoice_only" : "recognition",
        orderFileId,
      });
      finalizedDeleteIdRef.current = "";
      const state = {
        key: packageKey,
        deleteId: session.deleteId,
        wholePackage: !orderFileId,
        startedAt: Date.now(),
      };
      persistDeletingPackage(state);
      setDeletingPackage(state);
    } catch {
      // Error UI is handled by the mutation callback.
    }
  };
  const handleDelete = (group: any) => {
    setDeleteScope("all");
    setDeleteStepIndex(0);
    setDeleteComplete(false);
    setDeleteError("");
    setDeleteDialogGroup(group);
  };
  const handleMatchPackageBankFlow = (group: any) => {
    matchPackageBankFlow.mutate({
      ruleId: Number(group.ruleId || 0),
      orderFileId: Number(group.fileCount || 0) === 1 ? Number(group.primaryFileId || 0) : undefined,
    });
  };
  const handleOpenMatchCandidates = (group: any) => {
    setSelectedMatchSolution("0");
    setMatchCandidateDialog(group);
  };
  const handleConfirmMultiDayMatch = () => {
    const solution = matchCandidatesQuery.data?.solutions[Number(selectedMatchSolution)];
    if (!matchCandidateDialog || !solution) return;
    confirmMultiDayMatch.mutate({
      groupId: Number(matchCandidateDialog.multiDayMatchGroupId),
      flowIds: solution.flowIds,
    });
  };
  const confirmScopedDelete = () => {
    if (!deleteDialogGroup) return;
    const orderFileId = deleteScope === "all" ? 0 : Number(deleteScope);
    setDeleteStepIndex(1);
    setDeleteComplete(false);
    setDeleteError("");
    void deleteGroupDetails(deleteDialogGroup, orderFileId > 0 ? orderFileId : undefined);
  };

  const handleSearch = () => {
    setPage(1);
    setSearchQuery(search);
  };

  const handleResetSearch = () => {
    setSearch("");
    setSearchQuery("");
    setPage(1);
  };

  const groups = (filesQuery.data?.items || []).filter((group: any) => !hiddenDeletedPackageKeys.includes(getPackageKey(group)));
  const totalPages = Math.ceil((filesQuery.data?.total || 0) / 20);
  const deleteStatus = deleteStatusQuery.data;
  const deleteRunning = Boolean(deletingPackage?.deleteId) && deleteStatus?.status !== "completed" && deleteStatus?.status !== "failed";
  const deletePending = startDeletePackage.isPending || deleteRunning;
  const deleteStep = Math.max(1, Number(deleteStatus?.step || deleteStepIndex || 1));
  const deleteTotalSteps = Number(deleteStatus?.totalSteps || 5);
  const deleteMessage = deleteStatus?.message || (startDeletePackage.isPending ? "正在启动删除任务" : "正在检查订单明细包");
  const statusMap: Record<string, { label: string; className: string }> = {
    processing: { label: "入库中", className: "bg-blue-100 text-blue-800" },
    unbound: { label: "待匹配流水", className: "bg-amber-100 text-amber-800" },
    completed: { label: "入库完成", className: "bg-green-100 text-green-800" },
    failed: { label: "失败", className: "bg-red-100 text-red-800" },
    abnormal: { label: "异常", className: "bg-orange-100 text-orange-800" },
  };

  useEffect(() => {
    if (filesQuery.isLoading || !filesQuery.data) return;
    const lastPage = Math.max(1, totalPages);
    if (page > lastPage) setPage(lastPage);
  }, [filesQuery.data, filesQuery.isLoading, page, totalPages]);

  useEffect(() => {
    if (!deletingPackageKey || filesQuery.isLoading) return;
    if (startDeletePackage.isPending || deleteStatusQuery.data?.status === "running") return;
    const packageStillVisible = (filesQuery.data?.items || []).some((group: any) => getPackageKey(group) === deletingPackageKey);
    if (!packageStillVisible) {
      clearPersistedDeletingPackage();
      setDeletingPackage(null);
    }
  }, [deleteStatusQuery.data?.status, deletingPackageKey, filesQuery.data?.items, filesQuery.isLoading, startDeletePackage.isPending]);

  useEffect(() => {
    if (hiddenDeletedPackageKeys.length === 0 || filesQuery.isLoading) return;
    const visibleKeys = new Set((filesQuery.data?.items || []).map((group: any) => getPackageKey(group)));
    const stillVisibleKeys = hiddenDeletedPackageKeys.filter((key) => visibleKeys.has(key));
    if (stillVisibleKeys.length === 0) {
      setHiddenDeletedPackageKeys([]);
      return;
    }
    const timer = window.setTimeout(() => {
      filesQuery.refetch();
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [filesQuery, filesQuery.data?.items, filesQuery.isLoading, hiddenDeletedPackageKeys]);

  useEffect(() => {
    const status = deleteStatusQuery.data?.status;
    const deleteId = deleteStatusQuery.data?.deleteId || "";
    if (!deleteId || finalizedDeleteIdRef.current === deleteId) return;

    if (status === "running") {
      setDeleteStepIndex(Number(deleteStatusQuery.data?.step || 1));
      setDeleteError("");
      return;
    }

    if (status === "completed") {
      finalizedDeleteIdRef.current = deleteId;
      setDeleteStepIndex(Number(deleteStatusQuery.data?.totalSteps || 5));
      setDeleteComplete(true);
      setDeleteError("");
      const completedPackageKey = deletingPackage?.key || deleteStatusQuery.data?.packageKey || "";
      if (completedPackageKey && deletingPackage?.wholePackage) {
        setHiddenDeletedPackageKeys((keys) => Array.from(new Set([...keys, completedPackageKey])));
      }
      void (async () => {
        await Promise.all([
          utils.orderFile.list.invalidate(),
          utils.task.list.invalidate(),
          utils.task.getById.invalidate(),
        ]);
        const refetchResult = await filesQuery.refetch();
        const nextGroups = refetchResult.data?.items || [];
        if (completedPackageKey && !nextGroups.some((group: any) => getPackageKey(group) === completedPackageKey)) {
          setHiddenDeletedPackageKeys((keys) => keys.filter((key) => key !== completedPackageKey));
        }
        toast.success(`已删除 ${deleteStatusQuery.data?.deletedCount || 0} 条订单明细`);
        clearPersistedDeletingPackage();
        window.setTimeout(() => {
          setDeletingPackage(null);
          setDeleteDialogGroup(null);
          setDeleteScope("all");
          setDeleteStepIndex(0);
          setDeleteComplete(false);
          setDeleteError("");
        }, 700);
      })();
      return;
    }

    if (status === "failed") {
      finalizedDeleteIdRef.current = deleteId;
      setDeleteStepIndex(0);
      setDeleteComplete(false);
      setDeleteError(deleteStatusQuery.data?.error || "删除失败");
      toast.error(deleteStatusQuery.data?.error || "删除失败");
      clearPersistedDeletingPackage();
      setDeletingPackage(null);
    }
  }, [
    deleteStatusQuery.data?.deleteId,
    deleteStatusQuery.data?.deletedCount,
    deleteStatusQuery.data?.error,
    deleteStatusQuery.data?.packageKey,
    deleteStatusQuery.data?.status,
    deleteStatusQuery.data?.step,
    deleteStatusQuery.data?.totalSteps,
    deletingPackage?.key,
    deletingPackage?.wholePackage,
    filesQuery,
    utils.orderFile.list,
    utils.task.getById,
    utils.task.list,
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">订单明细包</h1>
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <Input
          placeholder="搜索订单日期/匹配日期、规则、文件或上传账号"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-80"
        />
        <Button variant="outline" onClick={handleSearch}>
          <Search className="h-4 w-4 mr-1" />
          搜索
        </Button>
        <Button variant="ghost" onClick={handleResetSearch}>
          重置
        </Button>
      </div>

      {/* Order Files Table */}
      <Card>
        <CardContent className="p-0">
          <Table className="w-max min-w-full table-auto">
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">订单日期/匹配日期</TableHead>
                <TableHead className="w-28">明细包类型</TableHead>
                <TableHead>明细认账规则</TableHead>
                <TableHead className="w-64">详情</TableHead>
                <TableHead className="w-auto">上传信息</TableHead>
                <TableHead className="w-[230px] min-w-[230px] max-w-[230px]">状态</TableHead>
                <TableHead className="sticky right-0 z-30 w-[150px] min-w-[150px] max-w-[150px] bg-white shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filesQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">加载中...</TableCell>
                </TableRow>
              ) : groups.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-gray-400">暂无数据</TableCell>
                </TableRow>
              ) : (
                groups.map((group: any) => {
                  const status = getGroupStatus(group);
                  const isInvoiceOnly = group.sourceType === "invoice_only";
                  const packageKey = getPackageKey(group);
                  const deletingCurrentPackage = deletingPackageKey === packageKey;
                  const unmatchedCount = Number(group.unmatchedCount || 0);
                  const pendingSplitCount = Number(group.pendingSplitCount || 0);
                  const entryCount = Number(group.entryCount || 0);
                  const orderTotalAmount = Number(group.orderTotalAmount || 0);
                  const refundAmount = Number(group.refundAmount || 0);
                  const canMatchPackageBankFlow = !isInvoiceOnly && group.detailPackageType === "打包明细" && Number(group.unboundPackageCount || 0) > 0;
                  const multiDayMatchStatus = String(group.multiDayMatchStatus || "");
                  const isMultiDayUnmatched = status === "completed" && multiDayMatchStatus === "unmatched";
                  const isMultiDayPendingConfirmation = status === "completed" && multiDayMatchStatus === "pending_confirmation";
                  return (
                    <TableRow key={packageKey}>
                      <TableCell className="font-mono text-sm">{group.billDate}</TableCell>
                      <TableCell>
                        <Badge className={isInvoiceOnly ? "bg-amber-100 text-amber-800" : group.detailPackageType === "打包明细" ? "bg-purple-100 text-purple-800" : "bg-blue-100 text-blue-800"}>
                          {group.detailPackageType || "T+1"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        {group.ruleName || `规则#${group.ruleId || "-"}`}{isInvoiceOnly ? "（不认账）" : ""}
                      </TableCell>
                      <TableCell className="w-64 text-xs whitespace-nowrap">
                        <div>{entryCount.toLocaleString("zh-CN")} 条</div>
                        <div className="mt-1 text-blue-700">
                          {isInvoiceOnly ? "金额" : "收入"}：{orderTotalAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元
                          {!isInvoiceOnly && (
                            <><span className="mx-1 text-gray-300">/</span>退款：{refundAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元</>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-3"
                          onClick={() => handleViewUploadInfo(group)}
                        >
                          查看
                        </Button>
                      </TableCell>
                      <TableCell className="w-[230px] min-w-[230px] max-w-[230px]">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge className={statusMap[status]?.className || "bg-gray-100 text-gray-800"}>
                            {statusMap[status]?.label || status}
                          </Badge>
                          {isMultiDayUnmatched && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 gap-1 border-amber-200 px-2 text-xs text-amber-700"
                              onClick={() => handleMatchPackageBankFlow(group)}
                              disabled={matchPackageBankFlow.isPending || Boolean(deletingPackageKey)}
                              title="重新查找可匹配的银行流水"
                            >
                              {matchPackageBankFlow.isPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
                              流水未匹配
                            </Button>
                          )}
                          {isMultiDayPendingConfirmation && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 gap-1 border-blue-200 px-2 text-xs text-blue-700"
                              onClick={() => handleOpenMatchCandidates(group)}
                              title="选择一组银行流水组合"
                            >
                              <CircleHelp className="h-3.5 w-3.5" />
                              匹配待确认
                            </Button>
                          )}
                        </div>
                        {!isInvoiceOnly && (
                          <div className="text-xs text-gray-500 mt-1">
                            {unmatchedCount} 未匹配 / {pendingSplitCount} 待拆分
                          </div>
                        )}
                        {deletingCurrentPackage && (
                          <div className="mt-1 text-xs text-blue-600">删除处理中...</div>
                        )}
                      </TableCell>
                      <TableCell className="sticky right-0 z-20 w-[150px] min-w-[150px] max-w-[150px] bg-white shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]">
                        <div className="flex items-center gap-1">
                          {!isInvoiceOnly && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-blue-500 h-7 w-7 p-0"
                              onClick={() => handleView(group)}
                              title="查看订单明细"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          )}
                          {!isInvoiceOnly && unmatchedCount > 0 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-amber-600"
                              onClick={() => handleViewUnmatched(group)}
                              title="查看未匹配明细"
                            >
                              <ListFilter className="h-4 w-4" />
                            </Button>
                          )}
                          {!isInvoiceOnly && pendingSplitCount > 0 && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-purple-600"
                              onClick={() => handleViewPendingSplit(group)}
                              title="查看待拆分明细"
                            >
                              <ListChecks className="h-4 w-4" />
                            </Button>
                          )}
                          {canMatchPackageBankFlow && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-emerald-600"
                              onClick={() => handleMatchPackageBankFlow(group)}
                              disabled={matchPackageBankFlow.isPending || Boolean(deletingPackageKey)}
                              title="匹配流水认账"
                            >
                              {matchPackageBankFlow.isPending ? (
                                <LoaderCircle className="h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className={`h-7 w-7 p-0 ${canDeleteOrderDetailPackage ? "text-red-500 hover:text-red-700" : "text-gray-300"}`}
                            onClick={() => handleDelete(group)}
                            disabled={!canDeleteOrderDetailPackage || Boolean(deletingPackageKey)}
                            title={!canDeleteOrderDetailPackage ? "无删除权限" : deletingCurrentPackage ? "删除处理中" : "删除数据包"}
                          >
                            {deletingCurrentPackage ? (
                              <LoaderCircle className="h-4 w-4 animate-spin text-blue-600" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
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

      <Dialog open={Boolean(matchCandidateDialog)} onOpenChange={(open) => {
        if (!open && !confirmMultiDayMatch.isPending) {
          setMatchCandidateDialog(null);
          setSelectedMatchSolution("0");
        }
      }}>
        <DialogContent className="max-w-3xl" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>选择多日汇总匹配方案</DialogTitle>
          </DialogHeader>
          {matchCandidatesQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-gray-500">
              <LoaderCircle className="h-4 w-4 animate-spin" /> 正在重新校验候选流水
            </div>
          ) : matchCandidatesQuery.error ? (
            <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">{matchCandidatesQuery.error.message}</div>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="rounded-md bg-gray-50 p-3 text-gray-600">
                订单包净额：<span className="font-mono font-medium text-gray-900">{matchCandidatesQuery.data?.packageTotal || "0.00"}</span> 元；最多展示 3 组当前可用方案。
              </div>
              {(matchCandidatesQuery.data?.solutions.length || 0) > 0 ? (
                <RadioGroup value={selectedMatchSolution} onValueChange={setSelectedMatchSolution} className="max-h-[52vh] overflow-auto pr-1">
                  {matchCandidatesQuery.data?.solutions.map((solution, index) => (
                    <label key={solution.flowIds.join("-")} className="cursor-pointer rounded-md border p-4 hover:border-blue-300">
                      <div className="flex items-start gap-3">
                        <RadioGroupItem value={String(index)} className="mt-1" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2 font-medium text-gray-900">
                            <span>方案 {index + 1} · {solution.flowCount} 笔到账</span>
                            <span className="font-mono">{solution.totalAmount} 元</span>
                          </div>
                          <div className="mt-1 text-xs text-gray-500">{solution.startDate} 至 {solution.endDate}</div>
                          <div className="mt-3 space-y-2">
                            {solution.flows.map((flow) => (
                              <div key={flow.id} className="grid gap-1 rounded bg-gray-50 px-3 py-2 text-xs sm:grid-cols-[110px_1fr_110px]">
                                <span className="font-mono text-gray-600">{flow.billDate}</span>
                                <span className="truncate text-gray-600" title={`${flow.referenceNo} ${flow.counterpartyName || ""}`}>{flow.referenceNo || `流水#${flow.id}`} · {flow.counterpartyName || "-"}</span>
                                <span className="text-right font-mono text-gray-900">{flow.income} 元</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </label>
                  ))}
                </RadioGroup>
              ) : (
                <div className="rounded-md border p-6 text-center text-gray-500">候选流水已变化，当前没有金额一致的可用方案。</div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMatchCandidateDialog(null)} disabled={confirmMultiDayMatch.isPending}>取消</Button>
            <Button
              onClick={handleConfirmMultiDayMatch}
              disabled={confirmMultiDayMatch.isPending || !(matchCandidatesQuery.data?.solutions.length)}
            >
              {confirmMultiDayMatch.isPending ? "确认中..." : "确认并开始认账"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(uploadInfoDialog)} onOpenChange={() => {}}>
        <DialogContent
          className="max-w-2xl"
          showCloseButton={false}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>上传信息</DialogTitle>
          </DialogHeader>
          {uploadInfoDialog && (
            <div className="space-y-4 text-sm">
              <div className="grid gap-2 rounded-md bg-gray-50 p-3 text-gray-600 sm:grid-cols-3">
                <div>
                  <div className="text-xs text-gray-400">订单日期/匹配日期</div>
                  <div className="mt-1 font-mono text-gray-800">{uploadInfoDialog.group.billDate || "-"}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400">明细包类型</div>
                  <div className="mt-1 text-gray-800">{uploadInfoDialog.group.detailPackageType || "T+1"}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400">明细认账规则</div>
                  <div className="mt-1 truncate text-gray-800" title={uploadInfoDialog.group.ruleName || ""}>
                    {uploadInfoDialog.group.ruleName || `规则#${uploadInfoDialog.group.ruleId || "-"}`}
                    {uploadInfoDialog.group.sourceType === "invoice_only" ? "（不认账）" : ""}
                  </div>
                </div>
              </div>
              <div className="max-h-[50vh] space-y-2 overflow-auto pr-1">
                {uploadInfoDialog.infos.length > 0 ? (
                  uploadInfoDialog.infos.map((info, idx) => (
                    <div key={`${info.uploadInfo}-${info.fileName}-${idx}`} className="rounded-md border p-3">
                      <div className="text-xs text-gray-400">上传账号/时间</div>
                      <div className="mt-1 break-all text-gray-800">{info.uploadInfo || "-"}</div>
                      <div className="mt-3 text-xs text-gray-400">文件名</div>
                      <div className="mt-1 break-all text-gray-600">{info.fileName || "-"}</div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-md border p-4 text-center text-gray-400">暂无上传信息</div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadInfoDialog(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteDialogGroup)} onOpenChange={(open) => {
        if (!open && !deletePending) {
          setDeleteDialogGroup(null);
          setDeleteScope("all");
          setDeleteStepIndex(0);
          setDeleteComplete(false);
          setDeleteError("");
        }
      }}>
        <DialogContent className="max-w-xl" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>删除订单明细包</DialogTitle>
          </DialogHeader>
          {deleteDialogGroup && (
            <div className="space-y-4 text-sm">
              <div className="text-gray-600">
                {deleteDialogGroup.sourceType === "invoice_only"
                  ? "删除后不可恢复；已进入开票申请或已开票的明细不能删除。"
                  : getGroupFiles(deleteDialogGroup.fileOptions).length > 1
                  ? "该数据包来自多个文件。选择要删除的范围，系统会回滚实际受影响任务的认账结果；已有锁定记录时不能删除。"
                  : "该数据包来自一个文件。系统会回滚实际受影响任务的认账结果；已有锁定记录时不能删除。"}
              </div>
              <RadioGroup value={deleteScope} onValueChange={setDeleteScope}>
                <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
                  <RadioGroupItem value="all" className="mt-0.5" />
                  <span>
                    <span className="block font-medium text-gray-900">删除整个数据包</span>
                    <span className="mt-1 block text-xs text-gray-500">
                      删除 {deleteDialogGroup.billDate} / {deleteDialogGroup.detailPackageType || "T+1"} 下该规则的全部订单明细
                    </span>
                  </span>
                </label>
                {getGroupFiles(deleteDialogGroup.fileOptions).length > 1 && getGroupFiles(deleteDialogGroup.fileOptions).map((file) => (
                  <label key={file.id} className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
                    <RadioGroupItem value={String(file.id)} className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="block font-medium text-gray-900">仅删除来自该文件的明细</span>
                      <span className="mt-1 block break-all text-xs text-gray-500">{file.fileName}</span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
              {(deletePending || deleteStepIndex > 0 || deleteError) && (
                <div className={`rounded-md border p-3 ${deleteError ? "border-red-200 bg-red-50 text-red-700" : "border-blue-100 bg-blue-50 text-blue-700"}`}>
                  {deleteError ? (
                    <div>{deleteError}</div>
                  ) : (
                    <div className="flex items-center gap-2">
                      {!deleteComplete && <LoaderCircle className="h-4 w-4 animate-spin" />}
                      <span>
                        {deleteComplete
                          ? "删除完成，正在刷新列表"
                          : `${deleteStep}/${deleteTotalSteps} ${deleteMessage}`}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogGroup(null)} disabled={deletePending}>
              取消
            </Button>
            <Button variant="destructive" onClick={confirmScopedDelete} disabled={deletePending}>
              {deletePending ? "删除处理中..." : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious onClick={() => setPage((p) => Math.max(1, p - 1))} />
            </PaginationItem>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <PaginationItem key={p}>
                <PaginationLink isActive={p === page} onClick={() => setPage(p)}>
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext onClick={() => setPage((p) => Math.min(totalPages, p + 1))} />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}

    </div>
  );
}
