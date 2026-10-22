import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Plus, Eye, Upload, Trash2, Play, ArchiveX, FileCheck2, LoaderCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getDefaultRolePermissions } from "@contracts/permissions";
import { getRecognitionStatusMeta } from "@/lib/recognitionStatus";
import { extractGuangfaBankAccountNo } from "@/lib/bankAccountParser";
import { hasChinaBankHeaders, mapChinaBankRows } from "@/lib/chinaBankParser";
import { resolveGuangfaSignedAmount } from "@/lib/guangfaBankParser";

const ORDER_UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;
const ORDER_UPLOAD_RETRY_LIMIT = 3;
const UPLOAD_CHUNK_PROGRESS_MAX = 92;
const UPLOAD_MERGE_PROGRESS = 96;
const BACKGROUND_UPLOAD_POLL_INTERVAL = 2000;
const START_RECOGNITION_STEPS = [
  "正在筛选待认账流水",
  "正在处理到账认账",
  "正在提交明细认账队列",
  "正在刷新认账状态",
];

type IgnoredBankFlow = {
  date: string;
  referenceNo: string;
  amount: string;
};

type BankName = "广发银行" | "工商银行" | "中国银行";

type StartRecognitionDialogState = {
  taskId: number;
  billDate: string;
  step: number;
  status: "running" | "success" | "error";
  result?: {
    message?: string;
    incomeTaskCount?: number;
    incomeMatchedCount?: number;
    detailTaskCount?: number;
    skippedTaskCount?: number;
  };
  error?: string;
};

type BackgroundOrderUpload = {
  uploadId: string;
  fileName: string;
  ruleType?: "recognition" | "invoice_only";
  status: "processing" | "failed";
  processingProgress: number;
  parseProgress: number;
  importProgress: number;
  processedRows: number;
  processingPhase: string;
  failedReason?: string;
  createdAt: string;
};

function getBackgroundOrderUploadStorageKey(userId: number) {
  return `finance-recon:order-background-uploads:${userId}`;
}

function readStoredBackgroundOrderUploads(storageKey: string): BackgroundOrderUpload[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => Boolean(item && typeof item.uploadId === "string" && typeof item.fileName === "string"))
      .map((item) => {
        const legacyProgress = Math.max(0, Math.min(100, Number(item.processingProgress || 0)));
        const phase = String(item.processingPhase || "");
        return {
          ...item,
          ruleType: item.ruleType === "invoice_only" ? "invoice_only" as const : "recognition" as const,
          status: item.status === "failed" ? "failed" as const : "processing" as const,
          processingProgress: legacyProgress,
          parseProgress: Math.max(0, Math.min(100, Number(
            item.parseProgress ?? (phase.includes("入库") ? 100 : legacyProgress),
          ))),
          importProgress: Math.max(0, Math.min(100, Number(
            item.importProgress ?? (phase.includes("入库") ? legacyProgress : 0),
          ))),
          processedRows: Math.max(0, Number(item.processedRows || 0)),
          processingPhase: phase || "等待服务器处理",
          createdAt: String(item.createdAt || new Date().toISOString()),
        };
      });
  } catch {
    return [];
  }
}

function normalizeDateInputValue(value: string) {
  const parts = String(value || "").trim().replace(/\//g, "-").split("-");
  if (parts.length !== 3) return "";
  const [year, month, day] = parts;
  if (!year || !month || !day) return "";
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function createUploadCancelledError() {
  return new DOMException("上传已取消", "AbortError");
}

function isUploadCancelled(err: unknown, signal?: AbortSignal) {
  const error = err as { name?: string; message?: string };
  return Boolean(signal?.aborted || error?.name === "AbortError" || error?.message === "上传已取消");
}

async function uploadOrderChunkWithRetry(uploadId: string, index: number, chunk: Blob, signal: AbortSignal) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= ORDER_UPLOAD_RETRY_LIMIT; attempt += 1) {
    if (signal.aborted) throw createUploadCancelledError();
    try {
      const response = await fetch(`/api/order-files/upload-chunk?uploadId=${encodeURIComponent(uploadId)}&index=${index}`, {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/octet-stream" },
        body: chunk,
        signal,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "分片上传失败");
      return result;
    } catch (err) {
      if (isUploadCancelled(err, signal)) throw err;
      lastError = err;
      if (attempt < ORDER_UPLOAD_RETRY_LIMIT) {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            window.clearTimeout(timer);
            reject(createUploadCancelledError());
          };
          const timer = window.setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          }, attempt * 800);
          signal.addEventListener("abort", onAbort, { once: true });
        });
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("分片上传失败");
}

function getChunkUploadProgress(uploadedCount: number, totalChunks: number) {
  if (totalChunks <= 0) return 0;
  return Math.min(UPLOAD_CHUNK_PROGRESS_MAX, Math.round((uploadedCount / totalChunks) * UPLOAD_CHUNK_PROGRESS_MAX));
}

export default function RecognitionPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialPage = Math.max(1, Number(searchParams.get("page") || 1) || 1);
  const [page, setPage] = useState(initialPage);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [bankUploadOpen, setBankUploadOpen] = useState(false);
  const [orderUploadOpen, setOrderUploadOpen] = useState(false);
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [bankUploadErrorMessage, setBankUploadErrorMessage] = useState("");
  const [bankUploadSubmitting, setBankUploadSubmitting] = useState(false);
  const [bankUploadPhase, setBankUploadPhase] = useState("");
  const [bankParserReady, setBankParserReady] = useState(false);
  const [bankParserLoading, setBankParserLoading] = useState(false);
  const [orderFile, setOrderFile] = useState<File | null>(null);
  const [bankUploadResult, setBankUploadResult] = useState<{
    insertedFlows: number;
    duplicateExistingFlows: number;
    ignoredFlows: IgnoredBankFlow[];
    ambiguousFlows: Array<{ date: string; referenceNo: string; aliases: string[] }>;
    incomeMatchedCount: number;
    incomePendingAmountCount: number;
    incomeNoRuleCount: number;
    incomeSkippedCount: number;
    incomeRecognitionFailedCount: number;
  } | null>(null);
  const [orderUploadErrorOpen, setOrderUploadErrorOpen] = useState(false);
  const [orderUploadErrorMessage, setOrderUploadErrorMessage] = useState("");
  const [orderFileInputKey, setOrderFileInputKey] = useState(0);
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [orderMatchDate, setOrderMatchDate] = useState("");
  const [orderUploading, setOrderUploading] = useState(false);
  const [orderUploadProgress, setOrderUploadProgress] = useState(0);
  const [orderUploadPhase, setOrderUploadPhase] = useState("");
  const [backgroundOrderUploads, setBackgroundOrderUploads] = useState<BackgroundOrderUpload[]>([]);
  const [deletingTask, setDeletingTask] = useState<{ id: number; billDate: string; deleteId?: string } | null>(null);
  const [recognitionDialog, setRecognitionDialog] = useState<StartRecognitionDialogState | null>(null);
  const [optimisticProcessingTaskIds, setOptimisticProcessingTaskIds] = useState<Set<number>>(new Set());
  const orderUploadAbortRef = useRef<AbortController | null>(null);
  const backgroundOrderUploadsRef = useRef<BackgroundOrderUpload[]>([]);
  const finalizedDeleteIdRef = useRef("");
  const navigate = useNavigate();
  const permissionsQuery = trpc.permission.current.useQuery(undefined, { enabled: Boolean(user) });
  const rolePermissions = permissionsQuery.data?.permissions || getDefaultRolePermissions(user?.role || "");
  const canDelete = Boolean(rolePermissions.recognition_task_delete);
  const canCreateVouchers = Boolean(rolePermissions.voucher_create);
  const deletingInProgress = Boolean(deletingTask);
  const backgroundOrderUploadStorageKey = user?.id
    ? getBackgroundOrderUploadStorageKey(Number(user.id))
    : "";
  const persistBackgroundOrderUploads = useCallback((uploads: BackgroundOrderUpload[]) => {
    backgroundOrderUploadsRef.current = uploads;
    setBackgroundOrderUploads(uploads);
    if (backgroundOrderUploadStorageKey) {
      window.localStorage.setItem(backgroundOrderUploadStorageKey, JSON.stringify(uploads));
    }
  }, [backgroundOrderUploadStorageKey]);

  const updatePage = (nextPage: number) => {
    const normalizedPage = Math.max(1, nextPage);
    setPage(normalizedPage);
    setSearchParams((params) => {
      const nextParams = new URLSearchParams(params);
      if (normalizedPage > 1) {
        nextParams.set("page", String(normalizedPage));
      } else {
        nextParams.delete("page");
      }
      return nextParams;
    }, { replace: true });
  };

  const utils = trpc.useUtils();
  const tasksQuery = trpc.task.list.useQuery(
    { status: statusFilter || undefined, page, pageSize: 10 },
    {
      refetchInterval: (query) => query.state.data?.items.some((item: any) => item.status === "processing") ? 5000 : false,
    },
  );
  const uploadRuleOptionsQuery = trpc.orderFile.uploadRuleOptions.useQuery(undefined, {
    enabled: orderUploadOpen,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (!backgroundOrderUploadStorageKey) {
      backgroundOrderUploadsRef.current = [];
      setBackgroundOrderUploads([]);
      return;
    }

    const storedUploads = readStoredBackgroundOrderUploads(backgroundOrderUploadStorageKey);
    backgroundOrderUploadsRef.current = storedUploads;
    setBackgroundOrderUploads(storedUploads);
    let disposed = false;
    let timer = 0;

    const pollBackgroundUploads = async () => {
      const currentUploads = backgroundOrderUploadsRef.current;
      const nextUploads: BackgroundOrderUpload[] = [];
      let shouldRefreshLists = false;

      for (const upload of currentUploads) {
        if (upload.status === "failed") {
          nextUploads.push(upload);
          continue;
        }
        try {
          const response = await fetch(`/api/order-files/upload-session/${encodeURIComponent(upload.uploadId)}`, {
            credentials: "include",
          });
          const statusResult = await response.json().catch(() => ({}));
          if (!response.ok) {
            const failedReason = statusResult.error || "查询后台入库状态失败";
            nextUploads.push({
              ...upload,
              status: "failed",
              processingPhase: "状态查询失败",
              failedReason,
            });
            toast.error(`${upload.fileName}：${failedReason}`);
            shouldRefreshLists = true;
            continue;
          }

          if (statusResult.status === "completed") {
            const result = statusResult.result || {};
            const isInvoiceOnly = (statusResult.ruleType || upload.ruleType) === "invoice_only";
            toast.success(isInvoiceOnly
              ? `${upload.fileName} 后台入库完成：不认账明细 ${result.count || 0} 条`
                + (Number(result.skippedCount || 0) > 0 ? `，跳过 ${result.skippedCount} 条` : "")
              : `${upload.fileName} 后台入库完成：入库 ${result.count || 0} 条，已匹配 ${result.matchedCount || 0} 条`
                + (Number(result.skippedCount || 0) > 0 ? `，跳过 ${result.skippedCount} 条` : ""));
            shouldRefreshLists = true;
            continue;
          }
          if (statusResult.status === "failed") {
            const failedReason = statusResult.failedReason || "订单明细后台入库失败";
            nextUploads.push({
              ...upload,
              status: "failed",
              processingPhase: "处理失败",
              failedReason,
            });
            toast.error(`${upload.fileName}：${failedReason}`);
            shouldRefreshLists = true;
            continue;
          }

          const processingProgress = Math.max(0, Math.min(100, Number(statusResult.processingProgress || 0)));
          const processingPhase = statusResult.processingPhase || "等待服务器处理";
          nextUploads.push({
            ...upload,
            status: "processing",
            processingProgress,
            parseProgress: Math.max(0, Math.min(100, Number(
              statusResult.parseProgress ?? (String(processingPhase).includes("入库") ? 100 : processingProgress),
            ))),
            importProgress: Math.max(0, Math.min(100, Number(
              statusResult.importProgress ?? (String(processingPhase).includes("入库") ? processingProgress : 0),
            ))),
            processedRows: Math.max(0, Number(statusResult.processedRows || 0)),
            processingPhase,
          });
        } catch {
          nextUploads.push(upload);
        }
      }

      if (disposed) return;
      const polledUploadIds = new Set(currentUploads.map((upload) => upload.uploadId));
      const uploadsAddedDuringPoll = backgroundOrderUploadsRef.current
        .filter((upload) => !polledUploadIds.has(upload.uploadId));
      const uploadsToPersist = [...nextUploads, ...uploadsAddedDuringPoll];
      persistBackgroundOrderUploads(uploadsToPersist);
      if (shouldRefreshLists) {
        await Promise.all([
          utils.task.list.invalidate(),
          utils.task.getById.invalidate(),
          utils.task.getFlows.invalidate(),
          utils.orderFile.list.invalidate(),
        ]);
      }
      if (!disposed) {
        timer = window.setTimeout(
          pollBackgroundUploads,
          uploadsToPersist.some((upload) => upload.status === "processing")
            ? BACKGROUND_UPLOAD_POLL_INTERVAL
            : 5000,
        );
      }
    };

    void pollBackgroundUploads();
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [backgroundOrderUploadStorageKey, persistBackgroundOrderUploads, utils]);

  const uploadFlows = trpc.task.uploadBankFlowsAndCreateTasks.useMutation({
    onSuccess: (result) => {
      utils.task.list.invalidate();
      utils.counterparty.stats.invalidate();
      utils.counterparty.listUnrecorded.invalidate();
      setBankUploadOpen(false);
      setBankFile(null);
      setBankUploadErrorMessage("");
      setBankUploadPhase("");
      setBankUploadResult({
        insertedFlows: Number(result.insertedFlows || 0),
        duplicateExistingFlows: Number(result.duplicateExistingFlows || 0),
        ignoredFlows: Array.isArray(result.ignoredFlows) ? result.ignoredFlows : [],
        ambiguousFlows: Array.isArray(result.ambiguousFlows) ? result.ambiguousFlows : [],
        incomeMatchedCount: Number(result.incomeMatchedCount || 0),
        incomePendingAmountCount: Number(result.incomePendingAmountCount || 0),
        incomeNoRuleCount: Number(result.incomeNoRuleCount || 0),
        incomeSkippedCount: Number(result.incomeSkippedCount || 0),
        incomeRecognitionFailedCount: Number(result.incomeRecognitionFailedCount || 0),
      });
    },
  });
  const bankUploadInProgress = bankUploadSubmitting || uploadFlows.isPending;

  useEffect(() => {
    if (!bankUploadOpen) return;
    let active = true;
    setBankParserLoading(true);
    setBankUploadErrorMessage("");
    setBankUploadPhase("正在加载解析组件");
    preloadBankXlsxParser()
      .then(() => {
        if (!active) return;
        setBankParserReady(true);
        setBankParserLoading(false);
        setBankUploadPhase("");
      })
      .catch((error: any) => {
        if (!active) return;
        setBankParserLoading(false);
        setBankParserReady(false);
        setBankUploadPhase("");
        setBankUploadErrorMessage(error?.message || "解析组件加载失败，请刷新页面后重试。");
      });
    return () => {
      active = false;
    };
  }, [bankUploadOpen]);
  const startDeleteTask = trpc.task.startDeleteTask.useMutation({
    onError: (err: any) => toast.error(err.message || "删除失败"),
  });
  const deleteStatusQuery = trpc.task.getDeleteTaskStatus.useQuery(
    { deleteId: deletingTask?.deleteId || "" },
    {
      enabled: Boolean(deletingTask?.deleteId),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "completed" || status === "failed" ? false : 1000;
      },
    },
  );
  const startRecognition = trpc.task.startRecognition.useMutation();
  const batchCreateVouchers = trpc.voucherSummary.createBatchByTask.useMutation({
    onSuccess: async (result) => {
      toast.success(`批量制单完成：已生成 ${result.createdVoucherCount} 张凭证，覆盖 ${result.createdFlowCount} 条到账`);
      if (result.needsManualProcessingCount > 0) {
        const reasonParts = [
          result.skippedTemplateSelectionCount > 0
            ? `${result.skippedTemplateSelectionCount} 条存在多套模板`
            : "",
          result.skippedManualVoucherCount > 0
            ? `${result.skippedManualVoucherCount} 条需填写凭证ID`
            : "",
          result.failedCount > 0
            ? `${result.failedCount} 条生成失败`
            : "",
        ].filter(Boolean);
        toast.warning(
          `有 ${result.needsManualProcessingCount} 条到账未制单，需要人工处理`
          + (reasonParts.length > 0 ? `（${reasonParts.join("，")}）` : ""),
          { duration: 8000 },
        );
      }
      if (result.failures.length > 0) {
        const firstFailure = result.failures[0];
        toast.error(`部分流水制单失败：流水 ${firstFailure.flowId}，${firstFailure.message}`);
      }
      await Promise.all([
        utils.task.list.invalidate(),
        utils.task.getFlows.invalidate(),
        utils.voucherSummary.list.invalidate(),
        utils.voucherSummary.previewByFlow.invalidate(),
        utils.result.list.invalidate(),
        utils.result.dayGroups.invalidate(),
      ]);
    },
    onError: (err: any) => toast.error(err.message || "批量制单失败"),
  });
  const selectedRuleType = selectedRuleId.startsWith("invoice_only:") ? "invoice_only" : "recognition";
  const selectedRuleNumericId = Number(selectedRuleId.split(":")[1] || 0);
  const recognitionRuleOptions = uploadRuleOptionsQuery.data?.recognitionRules || [];
  const invoiceOnlyRuleOptions = uploadRuleOptionsQuery.data?.invoiceOnlyRules || [];
  const selectedRecognitionRule = recognitionRuleOptions.find((rule) => (
    Number(rule.id) === selectedRuleNumericId
  ));
  const selectedRuleIsInvoiceOnly = selectedRuleType === "invoice_only";
  const selectedRuleIsPackageDetail = !selectedRuleIsInvoiceOnly
    && selectedRecognitionRule?.detailPackageType === "打包明细";
  const selectedRuleIsMultiDayDetail = !selectedRuleIsInvoiceOnly
    && selectedRecognitionRule?.detailMatchingMode === "多日汇总匹配";

  const handleBatchCreateVouchers = (task: any) => {
    if (!confirm(
      `确认对 ${task.billDate} 已认账未制单的银行流水批量生成凭证？`
      + "\n存在多套模板或需要填写文本凭证ID的到账将跳过，完成后会提示需要人工处理的到账数量。",
    )) return;
    batchCreateVouchers.mutate({ taskId: Number(task.id) });
  };

  const handleBankUploadOpenChange = (open: boolean) => {
    if (!open && bankUploadInProgress) return;
    setBankUploadOpen(open);
    if (!open) {
      setBankParserLoading(false);
      setBankUploadPhase("");
      setBankUploadErrorMessage("");
    }
  };

  const handleUploadBank = async () => {
    if (!bankFile || bankUploadInProgress) return;
    const fileName = bankFile.name.toLowerCase();
    setBankUploadErrorMessage("");
    setBankUploadSubmitting(true);
    setBankUploadPhase(fileName.endsWith(".xlsx") && !bankParserReady ? "正在加载解析组件" : "正在解析文件");
    try {
      if (fileName.endsWith(".xlsx") && !bankParserReady) {
        await preloadBankXlsxParser();
        setBankParserReady(true);
        setBankUploadPhase("正在解析文件");
      }
      const flows = await parseBankFile(bankFile);
      if (flows.length === 0) {
        setBankUploadPhase("");
        setBankUploadErrorMessage("未识别到有效银行到账流水，请检查文件格式。");
        return;
      }
      setBankUploadPhase("正在创建认账任务");
      await uploadFlows.mutateAsync({ flows });
    } catch (error: any) {
      setBankUploadPhase("");
      setBankUploadErrorMessage(error?.message || "银行到账文件解析或上传失败，请检查文件格式后重试。");
    } finally {
      setBankUploadSubmitting(false);
    }
  };

  const handleUploadOrder = async () => {
    if (!orderFile || !selectedRuleId || !selectedRuleNumericId) return;
    const currentMatchDate = selectedRuleIsPackageDetail && !selectedRuleIsMultiDayDetail
      ? normalizeDateInputValue(orderMatchDate || "")
      : "";
    setOrderUploading(true);
    setOrderUploadProgress(0);
    setOrderUploadPhase("准备上传");
    const abortController = new AbortController();
    orderUploadAbortRef.current = abortController;
    const { signal } = abortController;
    try {
      const initResponse = await fetch("/api/order-files/upload-session", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify({
          ruleType: selectedRuleType,
          ruleId: selectedRuleNumericId,
          fileName: orderFile.name,
          fileSize: orderFile.size,
          lastModified: orderFile.lastModified,
          chunkSize: ORDER_UPLOAD_CHUNK_SIZE,
          matchDate: currentMatchDate || undefined,
        }),
      });
      let session = await initResponse.json().catch(() => ({}));
      if (!initResponse.ok) throw new Error(session.error || "创建上传任务失败");

      const uploaded = new Set<number>((session.uploadedChunks || []).map(Number));
      const totalChunks = Number(session.totalChunks || Math.ceil(orderFile.size / ORDER_UPLOAD_CHUNK_SIZE));
      for (let index = 0; index < totalChunks; index += 1) {
        if (!uploaded.has(index)) {
          const start = index * ORDER_UPLOAD_CHUNK_SIZE;
          const end = Math.min(orderFile.size, start + ORDER_UPLOAD_CHUNK_SIZE);
          setOrderUploadPhase(`上传分片 ${index + 1}/${totalChunks}`);
          session = await uploadOrderChunkWithRetry(session.uploadId, index, orderFile.slice(start, end), signal);
          uploaded.add(index);
        }
        const uploadedCount = uploaded.has(index)
          ? uploaded.size
          : Math.max(Number(session.uploadedChunks?.length || 0), index + 1);
        setOrderUploadProgress(getChunkUploadProgress(uploadedCount, totalChunks));
      }

      setOrderUploadPhase("正在提交后台任务");
      setOrderUploadProgress(UPLOAD_MERGE_PROGRESS);
      const completeParams = new URLSearchParams({ uploadId: session.uploadId });
      if (currentMatchDate) completeParams.set("matchDate", currentMatchDate);
      const completeResponse = await fetch(`/api/order-files/upload-complete?${completeParams.toString()}`, {
        method: "POST",
        credentials: "include",
        signal,
      });
      session = await completeResponse.json().catch(() => ({}));
      if (!completeResponse.ok) throw new Error(session.error || "文件合并失败");

      setOrderUploadProgress(100);
      setOrderUploadPhase("已转入后台处理");
      const completedResult = session.status === "completed" ? session.result : null;
      if (completedResult) {
        toast.success(selectedRuleIsInvoiceOnly
          ? `不认账订单明细上传成功：入库 ${completedResult.count || 0} 条`
            + (Number(completedResult.skippedCount || 0) > 0 ? `，跳过 ${completedResult.skippedCount} 条` : "")
          : `订单明细上传成功：入库 ${completedResult.count || 0} 条，已匹配 ${completedResult.matchedCount || 0} 条`
            + (Number(completedResult.skippedCount || 0) > 0 ? `，跳过 ${completedResult.skippedCount} 条` : ""));
        await Promise.all([
          utils.task.list.invalidate(),
          utils.task.getById.invalidate(),
          utils.task.getFlows.invalidate(),
          utils.orderFile.list.invalidate(),
        ]);
      } else {
        const backgroundUpload: BackgroundOrderUpload = {
          uploadId: String(session.uploadId),
          fileName: orderFile.name,
          ruleType: selectedRuleType,
          status: "processing",
          processingProgress: Math.max(0, Number(session.processingProgress || 0)),
          parseProgress: Math.max(0, Number(session.parseProgress || 0)),
          importProgress: Math.max(0, Number(session.importProgress || 0)),
          processedRows: Math.max(0, Number(session.processedRows || 0)),
          processingPhase: session.processingPhase || "等待服务器排队",
          createdAt: session.createdAt || new Date().toISOString(),
        };
        persistBackgroundOrderUploads([
          ...backgroundOrderUploadsRef.current.filter((upload) => upload.uploadId !== backgroundUpload.uploadId),
          backgroundUpload,
        ]);
        toast.success(selectedRuleIsInvoiceOnly
          ? "文件上传完成，正在后台写入不认账订单明细"
          : "文件上传完成，正在后台入库并匹配认账规则");
      }
      setOrderUploadOpen(false);
      setOrderFile(null);
      setSelectedRuleId("");
      setOrderMatchDate("");
      setOrderFileInputKey((key) => key + 1);
    } catch (err: any) {
      await Promise.all([
        utils.task.list.invalidate(),
        utils.task.getById.invalidate(),
        utils.task.getFlows.invalidate(),
        utils.orderFile.list.invalidate(),
      ]);
      if (isUploadCancelled(err, signal)) {
        toast.info("已取消上传");
        return;
      }
      const message = err?.message || "";
      if (
        message.includes("上传的订单明细有无订单号条目") ||
        message.includes("未找到订单号") ||
        message.includes("无法解析账单日期") ||
        message.includes("未找到收入金额") ||
        message.includes("发现已认账订单") ||
        message.includes("明细识别失败") ||
        message.includes("无法从订单明细中解析出有效日期")
      ) {
        setOrderUploadOpen(false);
        setOrderFile(null);
        setOrderMatchDate("");
        setOrderFileInputKey((key) => key + 1);
        setOrderUploadErrorMessage(message.includes("无法从订单明细中解析出有效日期") ? "明细识别失败，请检查文件" : message);
        setOrderUploadErrorOpen(true);
      } else {
        toast.error(message || "上传失败，请检查数据格式");
      }
    } finally {
      if (orderUploadAbortRef.current === abortController) {
        orderUploadAbortRef.current = null;
      }
      setOrderUploading(false);
      setOrderUploadPhase("");
    }
  };

  const handleCancelOrderUpload = () => {
    if (!orderUploading) return;
    setOrderUploadPhase("正在取消上传");
    orderUploadAbortRef.current?.abort();
  };

  const handleDismissBackgroundOrderUpload = (uploadId: string) => {
    persistBackgroundOrderUploads(
      backgroundOrderUploadsRef.current.filter((upload) => upload.uploadId !== uploadId),
    );
  };

  const handleViewTask = (taskId: number) => {
    const params = new URLSearchParams();
    if (page > 1) params.set("fromPage", String(page));
    navigate(`/tasks/${taskId}${params.toString() ? `?${params.toString()}` : ""}`);
  };

  useEffect(() => {
    const status = deleteStatusQuery.data?.status;
    const deleteId = deleteStatusQuery.data?.deleteId || "";
    if (!deleteId || finalizedDeleteIdRef.current === deleteId) return;

    if (status === "completed") {
      finalizedDeleteIdRef.current = deleteId;
      void (async () => {
        await utils.task.list.invalidate();
        const deletedTaskId = Number(deletingTask?.id || 0);
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const refreshed = await tasksQuery.refetch();
          const stillVisible = Boolean(refreshed.data?.items.some((item: any) => Number(item.id) === deletedTaskId));
          if (!stillVisible) break;
          await new Promise((resolve) => window.setTimeout(resolve, 500));
        }
        toast.success("日期汇总已删除");
        setDeletingTask(null);
      })();
    }

    if (status === "failed") {
      finalizedDeleteIdRef.current = deleteId;
      toast.error(deleteStatusQuery.data?.error || "删除失败");
    }
  }, [deleteStatusQuery.data?.deleteId, deleteStatusQuery.data?.error, deleteStatusQuery.data?.status, deletingTask?.id, tasksQuery, utils.task.list]);

  const handleDeleteTask = async (task: any) => {
    if (deletingTask) return;
    const taskId = Number(task.id);
    if (!confirm("确定删除该日期汇总下的所有认账任务？此操作将删除关联的所有银行流水、订单明细和入账结果。")) return;
    setDeletingTask({ id: taskId, billDate: task.billDate || "-" });
    try {
      const session = await startDeleteTask.mutateAsync({ taskId });
      finalizedDeleteIdRef.current = "";
      setDeletingTask({ id: taskId, billDate: session.billDate || task.billDate || "-", deleteId: session.deleteId });
    } catch {
      setDeletingTask(null);
    }
  };

  const closeRecognitionDialog = async () => {
    if (recognitionDialog?.status === "running") return;
    setRecognitionDialog(null);
    await utils.task.list.invalidate();
  };

  const handleStartRecognition = async (task: any) => {
    const taskId = Number(task.id);
    if (!taskId || recognitionDialog?.status === "running") return;
    const billDate = String(task.billDate || "-");
    const stepTimers: number[] = [];

    setRecognitionDialog({ taskId, billDate, step: 1, status: "running" });
    setOptimisticProcessingTaskIds((current) => new Set(current).add(taskId));
    stepTimers.push(window.setTimeout(() => {
      setRecognitionDialog((current) =>
        current?.taskId === taskId && current.status === "running"
          ? { ...current, step: Math.max(current.step, 2) }
          : current,
      );
    }, 300));
    stepTimers.push(window.setTimeout(() => {
      setRecognitionDialog((current) =>
        current?.taskId === taskId && current.status === "running"
          ? { ...current, step: Math.max(current.step, 3) }
          : current,
      );
    }, 800));

    try {
      const result = await startRecognition.mutateAsync({ taskId });
      stepTimers.forEach((timer) => window.clearTimeout(timer));
      setRecognitionDialog((current) =>
        current?.taskId === taskId ? { ...current, step: 4, status: "running" } : current,
      );
      await Promise.all([
        utils.task.list.invalidate(),
        utils.task.getById.invalidate(),
        utils.task.getFlows.invalidate(),
      ]);
      setRecognitionDialog((current) =>
        current?.taskId === taskId ? { ...current, step: 4, status: "success", result } : current,
      );
    } catch (err: any) {
      stepTimers.forEach((timer) => window.clearTimeout(timer));
      await Promise.all([
        utils.task.list.invalidate(),
        utils.task.getById.invalidate(),
        utils.task.getFlows.invalidate(),
      ]).catch(() => undefined);
      setRecognitionDialog((current) =>
        current?.taskId === taskId
          ? { ...current, status: "error", error: err?.message || "执行失败" }
          : current,
      );
    } finally {
      setOptimisticProcessingTaskIds((current) => {
        const next = new Set(current);
        next.delete(taskId);
        return next;
      });
    }
  };

  const tasks = tasksQuery.data?.items || [];
  const totalPages = Math.ceil((tasksQuery.data?.total || 0) / 10);
  const deleteStatus = deleteStatusQuery.data;
  const deleteStep = Math.max(1, Number(deleteStatus?.step || (startDeleteTask.isPending ? 1 : 0)));
  const deleteTotalSteps = Number(deleteStatus?.totalSteps || 5);
  const deleteProgress = Math.min(100, Math.round((deleteStep / deleteTotalSteps) * 100));
  const deleteFailed = deleteStatus?.status === "failed";
  const deleteCompleted = deleteStatus?.status === "completed";
  const deleteMessage = deleteStatus?.message || "正在启动删除任务";
  const recognitionRunning = recognitionDialog?.status === "running";
  const recognitionStep = Math.max(1, Math.min(START_RECOGNITION_STEPS.length, recognitionDialog?.step || 1));
  const recognitionStepMessage = START_RECOGNITION_STEPS[recognitionStep - 1] || START_RECOGNITION_STEPS[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">认账及分账</h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800"
            onClick={() => navigate("/ignored-order-details")}
          >
            <ArchiveX className="h-4 w-4 mr-1" />
            人工处理订单
          </Button>
          <Dialog
            open={orderUploadOpen}
            onOpenChange={(open) => {
              if (!open && orderUploading) return;
              setOrderUploadOpen(open);
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline" disabled={deletingInProgress}>
                <Upload className="h-4 w-4 mr-1" />
                上传订单明细
              </Button>
            </DialogTrigger>
            <DialogContent
              className="max-w-lg"
              onInteractOutside={(event) => {
                if (orderUploading) event.preventDefault();
              }}
              onEscapeKeyDown={(event) => {
                if (orderUploading) event.preventDefault();
              }}
            >
              <DialogHeader>
                <DialogTitle>上传订单明细</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>订单明细文件（CSV / XLSX）<span className="text-red-500">*</span></Label>
                  <Input
                    key={orderFileInputKey}
                    type="file"
                    accept=".csv,.xlsx"
                    onChange={(e) => setOrderFile(e.target.files?.[0] || null)}
                  />
                  <p className="text-xs text-gray-400">
                    大文件会自动分片上传，失败后可补传已缺失分片。文件上传完成后弹窗会自动关闭，入库、匹配认账规则和执行认账将在后台继续。
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>订单明细规则 <span className="text-red-500">*</span></Label>
                  <Select
                    value={selectedRuleId}
                    onValueChange={setSelectedRuleId}
                    onOpenChange={(open) => {
                      if (open && uploadRuleOptionsQuery.isError) {
                        uploadRuleOptionsQuery.refetch();
                      }
                    }}
                    disabled={orderUploading}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={uploadRuleOptionsQuery.isLoading
                          ? "正在加载规则"
                          : uploadRuleOptionsQuery.isError
                          ? "规则加载失败"
                          : "选择订单明细规则"}
                      />
                    </SelectTrigger>
                    <SelectContent
                      position="popper"
                      align="start"
                      className="w-[var(--radix-select-trigger-width)] max-w-[var(--radix-select-trigger-width)] overflow-hidden [&_[data-radix-select-viewport]]:h-auto [&_[data-radix-select-viewport]]:max-h-[320px]"
                    >
                      {uploadRuleOptionsQuery.isLoading ? (
                        <SelectItem value="__loading" disabled>正在加载规则</SelectItem>
                      ) : uploadRuleOptionsQuery.isError ? (
                        <SelectItem value="__error" disabled>规则加载失败，重新打开下拉重试</SelectItem>
                      ) : recognitionRuleOptions.length === 0 && invoiceOnlyRuleOptions.length === 0 ? (
                        <SelectItem value="__empty" disabled>暂无可用的订单明细规则</SelectItem>
                      ) : (
                        <>
                          {recognitionRuleOptions.length > 0 && (
                            <SelectGroup>
                              <SelectLabel>明细认账</SelectLabel>
                              {recognitionRuleOptions.map((rule) => (
                                <SelectItem key={`recognition:${rule.id}`} value={`recognition:${rule.id}`}>
                                  <span className="block truncate">
                                    {formatDetailRuleName(rule)} ({rule.itemCount} 个条件)
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          )}
                          {invoiceOnlyRuleOptions.length > 0 && (
                            <SelectGroup>
                              <SelectLabel>不认账明细</SelectLabel>
                              {invoiceOnlyRuleOptions.map((rule) => (
                                <SelectItem key={`invoice_only:${rule.id}`} value={`invoice_only:${rule.id}`}>
                                  <span className="block truncate">{rule.ruleName}（不认账）</span>
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          )}
                        </>
                      )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-400">
                    {selectedRuleIsInvoiceOnly
                      ? "上传后只保存供开票使用的订单事实，不查找银行到账，不执行认账或明细分账。"
                      : selectedRuleIsMultiDayDetail
                      ? "订单包入库后自动查找唯一等额单笔流水或跨日流水组合；多解时需在订单明细包中确认。"
                      : selectedRuleIsPackageDetail
                      ? "不填到账日期时自动匹配符合到账信息的最早未认账银行流水；填写后只在指定日期找到账。"
                      : "订单明细利用规则中的匹配到账信息查找认账用银行流水，并按设置进行认账"}
                  </p>
                </div>
                {selectedRuleIsPackageDetail && !selectedRuleIsMultiDayDetail && (
                  <div className="space-y-2">
                    <Label>到账日期</Label>
                    <Input
                      type="date"
                      value={orderMatchDate}
                      onChange={(event) => setOrderMatchDate(event.target.value)}
                    />
                    <p className="text-xs text-gray-400">
                      选填；不填写时系统自动查找最早可匹配到账。
                    </p>
                  </div>
                )}
                {orderUploading && (
                  <div className="space-y-2">
                    <Progress value={orderUploadProgress} />
                    <p className="text-xs text-gray-500">
                      {orderUploadPhase || "上传中"}，{orderUploadProgress}%
                    </p>
                  </div>
                )}
              </div>
              <DialogFooter>
                {orderUploading ? (
                  <Button
                    variant="outline"
                    disabled={orderUploadProgress >= UPLOAD_MERGE_PROGRESS}
                    onClick={handleCancelOrderUpload}
                  >
                    取消上传
                  </Button>
                ) : (
                  <DialogClose asChild>
                    <Button variant="outline">取消</Button>
                  </DialogClose>
                )}
                <Button
                  onClick={handleUploadOrder}
                  disabled={!orderFile || !selectedRuleId || orderUploading}
                >
                  {orderUploading ? "上传中..." : "上传并后台处理"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={bankUploadOpen} onOpenChange={handleBankUploadOpenChange}>
            <DialogTrigger asChild>
              <Button disabled={deletingInProgress}>
                <Plus className="h-4 w-4 mr-1" />
                添加银行到账
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>添加银行到账</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>银行流水文件（CSV / XLS / XLSX）<span className="text-red-500">*</span></Label>
                  <Input
                    type="file"
                    accept=".csv,.xls,.xlsx"
                    disabled={bankParserLoading || bankUploadInProgress}
                    onChange={(e) => {
                      setBankFile(e.target.files?.[0] || null);
                      setBankUploadErrorMessage("");
                      if (!bankUploadInProgress) {
                        setBankUploadPhase("");
                      }
                    }}
                  />
                  <p className="text-xs text-gray-400">
                    支持广发银行、工商银行和中国银行到账文件。广发银行的“支出”按负数导入“收入”列；系统按表头自动识别银行格式，并按每条有效银行流水生成认账任务。
                  </p>
                  {(bankUploadPhase || bankParserLoading || bankUploadInProgress) && (
                    <div className="flex items-center gap-2 rounded-md border bg-gray-50 px-3 py-2 text-sm text-gray-600">
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      <span>{bankUploadPhase || "处理中"}</span>
                    </div>
                  )}
                  {bankUploadErrorMessage && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {bankUploadErrorMessage}
                    </div>
                  )}
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" disabled={bankUploadInProgress}>取消</Button>
                </DialogClose>
                <Button onClick={handleUploadBank} disabled={!bankFile || bankUploadInProgress}>
                  {bankUploadInProgress ? "上传中..." : "上传并生成任务"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {backgroundOrderUploads.filter((upload) => upload.status === "failed").map((upload) => (
        <Card key={upload.uploadId} className="border-red-200 bg-red-50">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge className="bg-red-100 text-red-800">后台入库失败</Badge>
                  <span className="truncate text-sm text-gray-600" title={upload.fileName}>{upload.fileName}</span>
                </div>
                <p className="text-sm text-red-700">{upload.failedReason || "订单明细后台入库失败，请重新上传"}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => handleDismissBackgroundOrderUpload(upload.uploadId)}
              >
                关闭
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Select value={statusFilter || "__all"} onValueChange={(v) => setStatusFilter(v === "__all" ? "" : v)}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">全部状态</SelectItem>
              <SelectItem value="pending_recognition">待认账</SelectItem>
              <SelectItem value="processing">认账执行中</SelectItem>
              <SelectItem value="large_variance">差异大</SelectItem>
              <SelectItem value="partial_matched">部分认账</SelectItem>
              <SelectItem value="completed">已完成认账</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => setStatusFilter("")}>重置</Button>
        </div>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          {backgroundOrderUploads.filter((upload) => upload.status === "processing").map((upload) => (
            <Badge key={upload.uploadId} className="max-w-full gap-1 bg-blue-100 text-blue-800 hover:bg-blue-100">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              <span className="max-w-56 truncate" title={upload.fileName}>{upload.fileName}</span>
              <span className="shrink-0">，入库中 {upload.processedRows.toLocaleString("zh-CN")} 行</span>
            </Badge>
          ))}
        </div>
      </div>

      {/* Task Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>账单日期</TableHead>
                <TableHead>银行流水收入</TableHead>
                <TableHead>订单明细条数</TableHead>
                <TableHead>已认账</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasksQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">加载中...</TableCell>
                </TableRow>
              ) : tasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-gray-400">暂无数据</TableCell>
                </TableRow>
              ) : (
                tasks.map((task: any) => {
                  const taskId = Number(task.id);
                  const displayStatusKey = optimisticProcessingTaskIds.has(taskId) ? "processing" : task.status;
                  const status = getRecognitionStatusMeta(displayStatusKey);
                  const StatusIcon = status.icon;
                  return (
                    <TableRow key={task.id}>
                      <TableCell>{task.billDate}</TableCell>
                      <TableCell>
                        <span className="font-medium text-blue-700">
                          {Number(task.bankFlowIncomeTotal || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                        </span>
                        <span className="text-xs text-gray-500 ml-1">({task.bankFlowCount || 0} 条)</span>
                      </TableCell>
                      <TableCell>
                        <span className={task.billDetailCount > 0 ? "text-green-700" : "text-gray-400"}>
                          {task.billDetailCount || 0} 条
                        </span>
                        {task.billDetailCount > 0 && (
                          <span className="text-xs text-gray-500 ml-1">
                            / {Number(task.billDetailTotal || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })} 元
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="font-medium text-green-700">
                          {Number(task.recognizedAmount || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge className={status.color}>
                          <StatusIcon className="h-3 w-3 mr-1" />
                          {status.label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="text-blue-600 hover:text-blue-800 px-1" onClick={() => handleViewTask(task.id)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-green-600 hover:text-green-800 px-1"
                            title="开始认账"
                            onClick={() => handleStartRecognition(task)}
                            disabled={deletingInProgress || recognitionRunning || startRecognition.isPending || displayStatusKey === "processing"}
                          >
                            <Play className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className={`px-1 ${canCreateVouchers ? "text-emerald-600 hover:text-emerald-800" : "text-gray-300"}`}
                            title={canCreateVouchers ? "批量制单" : "无制单权限"}
                            aria-label="批量制单"
                            disabled={!canCreateVouchers || deletingInProgress || batchCreateVouchers.isPending || displayStatusKey === "processing"}
                            onClick={() => handleBatchCreateVouchers(task)}
                          >
                            {batchCreateVouchers.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className={`px-1 ${canDelete ? "text-red-500 hover:text-red-700" : "text-gray-300"}`}
                            title={!canDelete ? "无删除权限" : deletingTask?.id === task.id ? "删除中" : "删除"}
                            disabled={!canDelete || deletingInProgress}
                            onClick={() => handleDeleteTask(task)}
                          >
                            <Trash2 className="h-4 w-4" />
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

      <Dialog
        open={Boolean(deletingTask)}
        onOpenChange={(open) => {
          if (!open && deleteFailed) {
            setDeletingTask(null);
          }
        }}
      >
        <DialogContent
          className="max-w-md"
          showCloseButton={false}
          onInteractOutside={(event) => {
            if (!deleteFailed) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (!deleteFailed) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>删除日期汇总</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-gray-600">
              正在删除 {deletingTask?.billDate || "-"} 的日期汇总，删除完成前请勿进行其他操作。
            </div>
            <div className={`rounded-md border p-3 text-sm ${deleteFailed ? "border-red-200 bg-red-50 text-red-700" : "border-blue-100 bg-blue-50 text-blue-700"}`}>
              {deleteFailed ? (
                <div>{deleteStatus?.error || "删除失败"}</div>
              ) : (
                <div className="flex items-center gap-2">
                  {!deleteCompleted && <LoaderCircle className="h-4 w-4 animate-spin" />}
                  <span>{deleteStep}/{deleteTotalSteps} {deleteMessage}</span>
                </div>
              )}
            </div>
            {!deleteFailed && <Progress value={deleteProgress} />}
          </div>
          {deleteFailed && (
            <DialogFooter>
              <Button onClick={() => setDeletingTask(null)}>我知道了</Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(recognitionDialog)}
        onOpenChange={(open) => {
          if (!open && !recognitionRunning) {
            void closeRecognitionDialog();
          }
        }}
      >
        <DialogContent
          className="max-w-md"
          showCloseButton={false}
          onInteractOutside={(event) => {
            if (recognitionRunning) event.preventDefault();
          }}
          onEscapeKeyDown={(event) => {
            if (recognitionRunning) event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>开始认账</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-gray-600">
              正在处理 {recognitionDialog?.billDate || "-"} 的认账任务。
            </div>
            <div className={`rounded-md border p-3 text-sm ${recognitionDialog?.status === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-blue-100 bg-blue-50 text-blue-700"}`}>
              {recognitionDialog?.status === "error" ? (
                <div>{recognitionDialog.error || "执行失败"}</div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    {recognitionRunning && <LoaderCircle className="h-4 w-4 animate-spin" />}
                    <span>
                      {recognitionDialog?.status === "success"
                        ? "认账判断完成，正在刷新列表"
                        : `${recognitionStep}/${START_RECOGNITION_STEPS.length} ${recognitionStepMessage}`}
                    </span>
                  </div>
                  {recognitionDialog?.status === "success" && recognitionDialog.result && (
                    <div className="space-y-1 text-blue-800">
                      {Number(recognitionDialog.result.incomeTaskCount || 0) === 0
                        && Number(recognitionDialog.result.detailTaskCount || 0) === 0
                        && Number(recognitionDialog.result.skippedTaskCount || 0) === 0 ? (
                        <div>没有需要认账的任务</div>
                      ) : (
                        <>
                          <div>到账认账：{Number(recognitionDialog.result.incomeTaskCount || 0)} 个任务，匹配 {Number(recognitionDialog.result.incomeMatchedCount || 0)} 条流水</div>
                          <div>明细认账：{Number(recognitionDialog.result.detailTaskCount || 0)} 个任务已加入队列</div>
                          <div>跳过：{Number(recognitionDialog.result.skippedTaskCount || 0)} 个无需处理任务</div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          {!recognitionRunning && (
            <DialogFooter>
              <Button onClick={() => void closeRecognitionDialog()}>确认</Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious onClick={() => updatePage(Math.max(1, page - 1))} />
            </PaginationItem>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <PaginationItem key={p}>
                <PaginationLink isActive={p === page} onClick={() => updatePage(p)}>
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext onClick={() => updatePage(Math.min(totalPages, page + 1))} />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}

      <Dialog open={!!bankUploadResult} onOpenChange={(open) => !open && setBankUploadResult(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>提示</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-gray-700 py-2">
            <div>
              银行到账上传成功：上传了 {bankUploadResult?.insertedFlows || 0} 条有效流水。
            </div>
            {Number(bankUploadResult?.incomeMatchedCount || 0) > 0 && (
              <div className="text-emerald-700">
                到账认账已完成 {bankUploadResult?.incomeMatchedCount || 0} 条流水。
              </div>
            )}
            {Number(bankUploadResult?.incomePendingAmountCount || 0) > 0 && (
              <div className="text-blue-700">
                其中 {bankUploadResult?.incomePendingAmountCount || 0} 条流水需要填写认账金额。
              </div>
            )}
            {Number(bankUploadResult?.incomeNoRuleCount || 0) > 0 && (
              <div className="text-amber-700">
                其中 {bankUploadResult?.incomeNoRuleCount || 0} 条流水没有启用的到账认账规则，已保留为未认账。
              </div>
            )}
            {Number(bankUploadResult?.incomeRecognitionFailedCount || 0) > 0 && (
              <div className="text-red-700">
                有 {bankUploadResult?.incomeRecognitionFailedCount || 0} 条流水未完成自动认账，请在日期任务中重新开始认账。
              </div>
            )}
            {Number(bankUploadResult?.incomeSkippedCount || 0) > 0 && (
              <div className="text-gray-500">
                有 {bankUploadResult?.incomeSkippedCount || 0} 条流水因状态已经变化或已有结果而跳过重复处理。
              </div>
            )}
            {Number(bankUploadResult?.duplicateExistingFlows || 0) > 0 && (
              <>
                <div className="text-amber-700">
                  其中 {bankUploadResult?.duplicateExistingFlows || 0} 条流水已上传过，已自动忽略。
                </div>
                {(bankUploadResult?.ignoredFlows.length || 0) > 0 && (
                  <div className="rounded-md border border-amber-200 overflow-hidden">
                    <div className="bg-amber-50 px-3 py-2 font-medium text-amber-800">忽略流水明细</div>
                    <div className="max-h-72 overflow-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>日期</TableHead>
                            <TableHead>流水号</TableHead>
                            <TableHead className="text-right">金额</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {bankUploadResult?.ignoredFlows.map((flow, index) => (
                            <TableRow key={`${flow.referenceNo}-${index}`}>
                              <TableCell className="whitespace-nowrap">{flow.date || "-"}</TableCell>
                              <TableCell className="font-mono text-xs break-all">{flow.referenceNo || "-"}</TableCell>
                              <TableCell className="text-right whitespace-nowrap">
                                {Number(flow.amount || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </>
            )}
            {(bankUploadResult?.ambiguousFlows.length || 0) > 0 && (
              <div className="rounded-md border border-orange-200 overflow-hidden">
                <div className="bg-orange-50 px-3 py-2 font-medium text-orange-800">
                  以下流水同时命中多个同等精度的到账信息，已保留为未认账
                </div>
                <div className="max-h-72 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>日期</TableHead>
                        <TableHead>流水号</TableHead>
                        <TableHead>命中的到账信息</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bankUploadResult?.ambiguousFlows.map((flow, index) => (
                        <TableRow key={`${flow.referenceNo}-ambiguous-${index}`}>
                          <TableCell className="whitespace-nowrap">{flow.date || "-"}</TableCell>
                          <TableCell className="font-mono text-xs break-all">{flow.referenceNo || "-"}</TableCell>
                          <TableCell>{flow.aliases.join("、") || "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setBankUploadResult(null)}>我知道了</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={orderUploadErrorOpen} onOpenChange={setOrderUploadErrorOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>提示</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-gray-700 py-2">
            {orderUploadErrorMessage}
          </div>
          <DialogFooter>
            <Button onClick={() => setOrderUploadErrorOpen(false)}>我知道了</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

import Papa from "papaparse";

type ExcelJSModule = typeof import("exceljs");

let bankXlsxParserPromise: Promise<ExcelJSModule> | null = null;

function preloadBankXlsxParser(): Promise<ExcelJSModule> {
  if (!bankXlsxParserPromise) {
    bankXlsxParserPromise = import("exceljs").catch((error) => {
      bankXlsxParserPromise = null;
      throw error;
    });
  }
  return bankXlsxParserPromise;
}

function normalizeDate(dateStr: string): string {
  if (!dateStr) return "";
  try {
    let d: Date | null = null;
    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(dateStr)) {
      const [y, m, day] = dateStr.split(/[-/]/);
      d = new Date(Number(y), Number(m) - 1, Number(day));
    } else if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(dateStr)) {
      const [y, m, day] = dateStr.split("/");
      d = new Date(Number(y), Number(m) - 1, Number(day));
    } else if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(dateStr)) {
      const [m, day, y] = dateStr.split("/");
      d = new Date(Number(y), Number(m) - 1, Number(day));
    } else if (/\d{4}年\d{1,2}月\d{1,2}日/.test(dateStr)) {
      const parts = dateStr.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
      if (parts) d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
    }
    if (!d || isNaN(d.getTime())) return dateStr;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  } catch {
    return dateStr;
  }
}

async function parseBankFile(file: File): Promise<any[]> {
  const fileName = file.name.toLowerCase();
  if (fileName.endsWith(".xls")) {
    const parsed = parseLegacyExcelRows(await file.arrayBuffer());
    return mapBankRows(parsed.rows, parsed.bankName, parsed.bankAccountNo);
  }
  if (fileName.endsWith(".xlsx")) {
    return parseXlsxBankRows(file);
  }
  return parseBankCSV(file);
}

async function parseBankCSV(file: File): Promise<any[]> {
  const text = await file.text();
  const result = Papa.parse(text, { header: true, skipEmptyLines: true });
  const rows = result.data as Record<string, string>[];
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const bankName = detectBankByHeaders(headers);
  if (!bankName) throw new Error("未识别到支持的银行流水表头，请检查文件格式");
  return mapBankRows(rows, bankName);
}

async function parseXlsxBankRows(file: File): Promise<any[]> {
  const ExcelJS = await preloadBankXlsxParser();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];
  const metadataRows: string[][] = [];

  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const maxColumn = Math.max(row.cellCount, row.actualCellCount, worksheet.columnCount);
    const headers = Array.from({ length: maxColumn }, (_, index) => cleanCell(row.getCell(index + 1).text || row.getCell(index + 1).value || ""));
    const bankName = detectBankByHeaders(headers);
    if (!bankName) {
      metadataRows.push(headers);
      continue;
    }

    const rows: Record<string, any>[] = [];
    for (let dataRowNumber = rowNumber + 1; dataRowNumber <= worksheet.rowCount; dataRowNumber += 1) {
      const dataRow = worksheet.getRow(dataRowNumber);
      const item: Record<string, any> = {};
      headers.forEach((header, index) => {
        if (header) item[header] = cleanCell(dataRow.getCell(index + 1).text || dataRow.getCell(index + 1).value || "");
      });
      if (Object.values(item).some((value) => cleanCell(value) !== "")) rows.push(item);
    }
    const bankAccountNo = bankName === "广发银行" ? extractGuangfaBankAccountNo(metadataRows) : "";
    return mapBankRows(rows, bankName, bankAccountNo);
  }

  throw new Error("未识别到支持的银行流水表头，请检查文件格式");
}

function normalizeBankHeader(value: unknown) {
  return cleanCell(value).replace(/\s+/g, "");
}

function detectBankByHeaders(headers: string[] = []): BankName | null {
  if (hasChinaBankHeaders(headers)) return "中国银行";
  const normalized = headers.map(normalizeBankHeader);
  const hasHeaders = (required: string[]) => required.every((header) => normalized.includes(header));
  if (hasHeaders(["流水号", "交易时间", "收入"])) return "广发银行";
  if (hasHeaders(["交易时间", "转入金额", "对方单位", "对方账号"])) return "工商银行";
  return null;
}

function mapBankRows(rows: Record<string, any>[], bankName: BankName, bankAccountNo = ""): any[] {
  if (bankName === "工商银行") return mapIcbcBankRows(rows);
  if (bankName === "中国银行") return mapChinaBankRows(rows);
  return mapGuangfaBankRows(rows, bankAccountNo);
}

function mapGuangfaBankRows(rows: Record<string, any>[], bankAccountNo = ""): any[] {
  return rows
    .map((row) => ({
      bankName: "广发银行" as const,
      ...(bankAccountNo ? { bankAccountNo } : {}),
      referenceNo: cleanCell(row["流水号"] || row["referenceNo"] || ""),
      transactionTime: normalizeDate(cleanCell(row["交易时间"] || row["transactionTime"] || row["日期"] || "")),
      income: resolveGuangfaSignedAmount(
        row["收入"] ?? row["income"] ?? row["金额"] ?? "0",
        row["支出"] ?? row["expense"] ?? "0",
      ),
      counterpartyAccount: cleanCell(row["对方账号"] || row["counterpartyAccount"] || ""),
      counterpartyName: cleanCell(row["对方户名"] || row["counterpartyName"] || row["对方名称"] || ""),
      counterpartyBank: cleanCell(row["对方开户行"] || row["counterpartyBank"] || row["开户行"] || ""),
      branch: cleanCell(row["交易行所"] || row["branch"] || row["交易网点"] || ""),
      summary: cleanCell(row["摘要"] || row["summary"] || ""),
      purpose: cleanCell(row["备注"])
        || cleanCell(row["用途"])
        || cleanCell(row["purpose"]),
      postScript: cleanCell(row["附言"] || row["postScript"] || ""),
    }))
    .filter((r) => (r.referenceNo || r.transactionTime || r.counterpartyName) && Number(r.income) !== 0);
}

function mapIcbcBankRows(rows: Record<string, any>[]): any[] {
  return rows
    .map((row) => {
      const transactionTime = normalizeDate(cleanCell(row["交易时间"] || ""));
      return {
        bankName: "工商银行" as const,
        referenceNo: buildIcbcReferenceNo(transactionTime),
        transactionTime,
        income: normalizeAmount(row["转入金额"] || "0"),
        counterpartyAccount: cleanCell(row["对方账号"] || ""),
        counterpartyName: cleanCell(row["对方单位"] || ""),
        counterpartyBank: cleanCell(row["对方行名"] || ""),
        branch: cleanCell(row["对方行号"] || ""),
        summary: cleanCell(row["摘要"] || ""),
        purpose: cleanCell(row["用途"] || ""),
        postScript: cleanCell(row["附言"] || ""),
      };
    })
    .filter((r) => (r.referenceNo || r.transactionTime || r.counterpartyName) && Number(r.income) > 0);
}

function buildIcbcReferenceNo(transactionTime: string) {
  return cleanCell(transactionTime).replace(/\D/g, "").slice(0, 14);
}

function cleanCell(value: unknown): string {
  return String(value ?? "").replace(/^\uFEFF/, "").trim();
}

function normalizeAmount(value: unknown): string {
  const cleaned = cleanCell(value).replace(/,/g, "");
  if (!cleaned || cleaned === "-") return "0";
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? String(amount) : "0";
}

export function parseLegacyExcelRows(arrayBuffer: ArrayBuffer): {
  rows: Record<string, any>[];
  bankAccountNo: string;
  bankName: BankName;
} {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  if (readU32(view, 0) !== 0xe011cfd0) {
    throw new Error("暂不支持该 XLS 文件格式");
  }

  const workbook = readOleWorkbook(bytes, view);
  const { sheets, sharedStrings } = readWorkbookGlobals(workbook);
  const firstSheet = sheets[0];
  if (!firstSheet) throw new Error("未找到 XLS 工作表");

  const matrix = readWorksheet(workbook, firstSheet.offset, sharedStrings);
  const headerIndex = matrix.findIndex((row) => Boolean(detectBankByHeaders(row)));
  if (headerIndex < 0) {
    throw new Error("未识别到银行流水表头，请检查文件格式");
  }

  const headers = matrix[headerIndex].map(cleanCell);
  const bankName = detectBankByHeaders(headers);
  if (!bankName) throw new Error("未识别到支持的银行流水表头，请检查文件格式");
  const rows = matrix.slice(headerIndex + 1).map((row) => {
    const item: Record<string, any> = {};
    headers.forEach((header, index) => {
      if (header) item[header] = row[index] ?? "";
    });
    return item;
  }).filter((row) => Object.values(row).some((value) => cleanCell(value) !== ""));
  return {
    rows,
    bankAccountNo: bankName === "广发银行"
      ? extractGuangfaBankAccountNo(matrix.slice(0, headerIndex))
      : "",
    bankName,
  };
}

function readOleWorkbook(bytes: Uint8Array, view: DataView): Uint8Array {
  const sectorSize = 1 << readU16(view, 30);
  const miniSectorSize = 1 << readU16(view, 32);
  const firstDirSector = readU32(view, 48);
  const miniCutoff = readU32(view, 56);
  const firstMiniFatSector = readU32(view, 60);
  const fatSectorCount = readU32(view, 44);
  const difat: number[] = [];
  for (let i = 0; i < 109 && difat.length < fatSectorCount; i++) {
    const sector = readU32(view, 76 + i * 4);
    if (sector !== 0xffffffff) difat.push(sector);
  }

  const fat: number[] = [];
  for (const sector of difat) {
    const offset = 512 + sector * sectorSize;
    for (let i = 0; i < sectorSize / 4; i++) {
      fat.push(readU32(view, offset + i * 4));
    }
  }

  const readSector = (sector: number) => bytes.slice(512 + sector * sectorSize, 512 + (sector + 1) * sectorSize);
  const readChain = (start: number) => {
    const chunks: Uint8Array[] = [];
    const seen = new Set<number>();
    let sector = start;
    while (sector !== 0xfffffffe && sector !== 0xffffffff && !seen.has(sector)) {
      seen.add(sector);
      chunks.push(readSector(sector));
      sector = fat[sector];
    }
    return concatBytes(chunks);
  };

  const directory = readChain(firstDirSector);
  const dirView = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const entries: Array<{ name: string; type: number; start: number; size: number }> = [];
  for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
    const nameLength = readU16(dirView, offset + 64);
    if (nameLength < 2) continue;
    entries.push({
      name: decodeUtf16(directory.slice(offset, offset + nameLength - 2)),
      type: directory[offset + 66],
      start: readU32(dirView, offset + 116),
      size: Number(dirView.getBigUint64(offset + 120, true)),
    });
  }

  const root = entries.find((entry) => entry.type === 5);
  const workbook = entries.find((entry) => entry.name === "Workbook" || entry.name === "Book");
  if (!workbook) throw new Error("未找到 XLS 工作簿内容");
  if (workbook.size >= miniCutoff) return readChain(workbook.start).slice(0, workbook.size);

  const miniStream = root ? readChain(root.start) : new Uint8Array();
  const miniFatStream = readChain(firstMiniFatSector);
  const miniFatView = new DataView(miniFatStream.buffer, miniFatStream.byteOffset, miniFatStream.byteLength);
  const miniFat: number[] = [];
  for (let offset = 0; offset + 4 <= miniFatStream.length; offset += 4) miniFat.push(readU32(miniFatView, offset));

  const chunks: Uint8Array[] = [];
  const seen = new Set<number>();
  let sector = workbook.start;
  while (sector !== 0xfffffffe && sector !== 0xffffffff && !seen.has(sector)) {
    seen.add(sector);
    chunks.push(miniStream.slice(sector * miniSectorSize, sector * miniSectorSize + miniSectorSize));
    sector = miniFat[sector];
  }
  return concatBytes(chunks).slice(0, workbook.size);
}

function readWorkbookGlobals(workbook: Uint8Array) {
  const view = new DataView(workbook.buffer, workbook.byteOffset, workbook.byteLength);
  const sheets: Array<{ name: string; offset: number }> = [];
  let sharedStringRecords: Uint8Array[] = [];
  for (let offset = 0; offset + 4 <= workbook.length;) {
    const id = readU16(view, offset);
    const length = readU16(view, offset + 2);
    const data = workbook.slice(offset + 4, offset + 4 + length);
    if (id === 0x0085) {
      const sheetOffset = readU32(new DataView(data.buffer, data.byteOffset, data.byteLength), 0);
      const nameLength = data[6];
      const isUtf16 = Boolean(data[7] & 1);
      const nameBytes = data.slice(8, 8 + nameLength * (isUtf16 ? 2 : 1));
      sheets.push({ offset: sheetOffset, name: isUtf16 ? decodeUtf16(nameBytes) : decodeLatin1(nameBytes) });
    } else if (id === 0x00fc) {
      sharedStringRecords = [data];
    } else if (id === 0x003c && sharedStringRecords.length > 0) {
      sharedStringRecords.push(data);
    }
    offset += 4 + length;
  }

  return { sheets, sharedStrings: parseSharedStrings(sharedStringRecords) };
}

function readWorksheet(workbook: Uint8Array, sheetOffset: number, sharedStrings: string[]) {
  const view = new DataView(workbook.buffer, workbook.byteOffset, workbook.byteLength);
  const rows: any[][] = [];
  const setCell = (row: number, col: number, value: any) => {
    rows[row] ||= [];
    rows[row][col] = value;
  };

  for (let offset = sheetOffset; offset + 4 <= workbook.length;) {
    const id = readU16(view, offset);
    const length = readU16(view, offset + 2);
    const data = workbook.slice(offset + 4, offset + 4 + length);
    const dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (id === 0x000a) break;
    if (id === 0x00fd) {
      setCell(readU16(dataView, 0), readU16(dataView, 2), sharedStrings[readU32(dataView, 6)] ?? "");
    } else if (id === 0x0203) {
      setCell(readU16(dataView, 0), readU16(dataView, 2), dataView.getFloat64(6, true));
    } else if (id === 0x027e) {
      setCell(readU16(dataView, 0), readU16(dataView, 2), readRkNumber(readU32(dataView, 6)));
    } else if (id === 0x00bd) {
      const row = readU16(dataView, 0);
      const firstCol = readU16(dataView, 2);
      const lastCol = readU16(dataView, 4);
      let pos = 6;
      for (let col = firstCol; col <= lastCol; col++) {
        pos += 2;
        setCell(row, col, readRkNumber(readU32(dataView, pos)));
        pos += 4;
      }
    } else if (id === 0x0204) {
      setCell(readU16(dataView, 0), readU16(dataView, 2), readBiffString(data.slice(6)).text);
    }
    offset += 4 + length;
  }
  return rows.map((row) => row.map((value) => cleanCell(value)));
}

function parseSharedStrings(records: Uint8Array[]) {
  if (records.length === 0) return [];
  const reader = new BiffSegmentReader(records);
  reader.u32();
  const uniqueCount = reader.u32();
  const strings: string[] = [];
  for (let i = 0; i < uniqueCount; i++) strings.push(reader.string());
  return strings;
}

class BiffSegmentReader {
  private segments: Uint8Array[];
  private segmentIndex = 0;
  private offset = 0;

  constructor(segments: Uint8Array[]) {
    this.segments = segments;
  }

  private remaining() {
    return (this.segments[this.segmentIndex]?.length ?? 0) - this.offset;
  }

  private nextSegment() {
    this.segmentIndex += 1;
    this.offset = 0;
  }

  byte() {
    while (this.remaining() <= 0) this.nextSegment();
    return this.segments[this.segmentIndex][this.offset++];
  }

  u16() {
    return this.byte() | (this.byte() << 8);
  }

  u32() {
    return this.u16() | (this.u16() << 16);
  }

  string() {
    const length = this.u16();
    let flags = this.byte();
    let isUtf16 = Boolean(flags & 1);
    const hasRichText = Boolean(flags & 8);
    const hasExtended = Boolean(flags & 4);
    const richRuns = hasRichText ? this.u16() : 0;
    const extendedLength = hasExtended ? this.u32() : 0;
    const codes: number[] = [];
    for (let i = 0; i < length; i++) {
      if (this.remaining() <= 0) {
        this.nextSegment();
        flags = this.byte();
        isUtf16 = Boolean(flags & 1);
      }
      codes.push(isUtf16 ? this.byte() | (this.byte() << 8) : this.byte());
    }
    for (let i = 0; i < richRuns * 4 + extendedLength; i++) this.byte();
    return String.fromCharCode(...codes);
  }
}

function readBiffString(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const length = readU16(view, 0);
  const isUtf16 = Boolean(data[2] & 1);
  const start = 3;
  const end = start + length * (isUtf16 ? 2 : 1);
  return { text: isUtf16 ? decodeUtf16(data.slice(start, end)) : decodeLatin1(data.slice(start, end)) };
}

function readRkNumber(raw: number) {
  let value: number;
  if (raw & 2) {
    value = raw >> 2;
  } else {
    const bytes = new ArrayBuffer(8);
    const view = new DataView(bytes);
    view.setUint32(4, raw & 0xfffffffc, true);
    value = view.getFloat64(0, true);
  }
  return raw & 1 ? value / 100 : value;
}

function readU16(view: DataView, offset: number) {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number) {
  return view.getUint32(offset, true);
}

function concatBytes(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function decodeUtf16(bytes: Uint8Array) {
  return new TextDecoder("utf-16le").decode(bytes).replace(/\0/g, "");
}

function decodeLatin1(bytes: Uint8Array) {
  return new TextDecoder("latin1").decode(bytes).replace(/\0/g, "");
}
function formatDetailRuleName(rule: any) {
  return rule.detailPackageType ? `${rule.ruleName}（${rule.detailPackageType}）` : rule.ruleName;
}
