import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Eye, ListFilter, LoaderCircle, Play, Search, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import Papa from "papaparse";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/hooks/useAuth";

const statusMap: Record<string, { label: string; className: string }> = {
  processing: { label: "入库中", className: "bg-blue-100 text-blue-800" },
  failed: { label: "失败", className: "bg-red-100 text-red-800" },
};

function getBusinessStatus(item: any) {
  if (item.uploadStatus === "processing") return statusMap.processing;
  if (item.uploadStatus === "failed") return statusMap.failed;
  if (item.recognitionPhase === "failed") return { label: "认账失败", className: "bg-red-100 text-red-800" };
  const entryCount = Number(item.entryCount || 0);
  const duplicateCount = Number(item.duplicateCount || 0);
  const recognizedCount = Number(item.recognizedCount || 0);
  const pendingRecognitionCount = Number(item.pendingRecognitionCount || 0);
  if (entryCount > 0 && recognizedCount >= entryCount) return { label: "已认账", className: "bg-blue-100 text-blue-800" };
  if (recognizedCount > 0) return { label: "部分认账", className: "bg-green-100 text-green-800" };
  if (pendingRecognitionCount > 0) return { label: "待认账", className: "bg-emerald-100 text-emerald-800" };
  if (entryCount === 0 && duplicateCount > 0) return { label: "全部重复", className: "bg-gray-100 text-gray-700" };
  return { label: "未匹配", className: "bg-yellow-100 text-yellow-800" };
}

function isRecognitionActive(item: any) {
  return item.recognitionPhase === "finding_tasks" || item.recognitionPhase === "recognizing";
}

function getDetailSplitCounts(item: any) {
  return {
    unmatchedCount: Number(item.unmatchedCount || 0),
    pendingRecognitionCount: Number(item.pendingRecognitionCount || 0),
    recognizedCount: Number(item.recognizedCount || 0),
  };
}

const DETAIL_SPLIT_UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;
const DETAIL_SPLIT_ORDER_STATUS_FIELD = "订单状态";
const UPLOAD_CHUNK_PROGRESS_MAX = 70;
const UPLOAD_MERGE_PROGRESS = 75;
const BACKGROUND_UPLOAD_POLL_INTERVAL = 2000;

type BackgroundDetailSplitUpload = {
  uploadId: string;
  fileName: string;
  status: "processing" | "failed";
  processingPhase: string;
  failedReason?: string;
  createdAt: string;
};

function getBackgroundDetailSplitUploadStorageKey(userId: number) {
  return `finance-recon:detail-split-background-uploads:${userId}`;
}

function readStoredBackgroundDetailSplitUploads(storageKey: string): BackgroundDetailSplitUpload[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => Boolean(item && typeof item.uploadId === "string" && typeof item.fileName === "string"))
      .map((item) => ({
        uploadId: String(item.uploadId),
        fileName: String(item.fileName),
        status: item.status === "failed" ? "failed" as const : "processing" as const,
        processingPhase: String(item.processingPhase || "等待服务器处理"),
        failedReason: item.failedReason ? String(item.failedReason) : undefined,
        createdAt: String(item.createdAt || new Date().toISOString()),
      }));
  } catch {
    return [];
  }
}

type ExcelJSModule = typeof import("exceljs");

let detailSplitXlsxParserPromise: Promise<ExcelJSModule> | null = null;

function preloadDetailSplitXlsxParser(): Promise<ExcelJSModule> {
  if (!detailSplitXlsxParserPromise) {
    detailSplitXlsxParserPromise = import("exceljs").catch((error) => {
      detailSplitXlsxParserPromise = null;
      throw error;
    });
  }
  return detailSplitXlsxParserPromise;
}

function createUploadCancelledError() {
  return new DOMException("上传已取消", "AbortError");
}

function isUploadCancelled(err: unknown, signal?: AbortSignal) {
  const error = err as { name?: string; message?: string };
  return Boolean(signal?.aborted || error?.name === "AbortError" || error?.message === "上传已取消");
}

function getChunkUploadProgress(uploadedCount: number, totalChunks: number) {
  if (totalChunks <= 0) return 0;
  return Math.min(UPLOAD_CHUNK_PROGRESS_MAX, Math.round((uploadedCount / totalChunks) * UPLOAD_CHUNK_PROGRESS_MAX));
}

function cleanCell(value: unknown): string {
  return String(value ?? "").replace(/^\uFEFF/, "").trim();
}

function normalizeHeaderName(value: unknown) {
  return cleanCell(value).replace(/\s+/g, "");
}

function hasHeader(headers: string[], field: string) {
  const target = normalizeHeaderName(field);
  return headers.some((header) => normalizeHeaderName(header) === target);
}

async function readDetailSplitFileHeaders(file: File): Promise<string[]> {
  if (/\.xlsx$/i.test(file.name)) {
    const ExcelJS = await preloadDetailSplitXlsxParser();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const worksheet = workbook.worksheets[0];
    if (!worksheet) return [];
    for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const maxColumn = Math.max(row.cellCount, row.actualCellCount);
      const headers = Array.from({ length: maxColumn }, (_, index) => cleanCell(row.getCell(index + 1).text || row.getCell(index + 1).value || ""));
      if (headers.some(Boolean)) return headers;
    }
    return [];
  }

  const buffer = await file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder("gb18030").decode(buffer);
  }
  const parsed = Papa.parse<string[]>(text, { header: false, preview: 20, skipEmptyLines: true });
  const rows = (parsed.data || []) as unknown[][];
  const headerRow = rows.find((row) => row.map(cleanCell).some(Boolean));
  return headerRow ? headerRow.map(cleanCell) : [];
}

async function validateDetailSplitFileHeaders(file: File, requiredFields: string[]) {
  const headers = await readDetailSplitFileHeaders(file);
  const missing = requiredFields.filter((field) => !hasHeader(headers, field));
  return { ok: missing.length === 0, missing };
}

function formatDetailRuleName(rule: any) {
  return rule.detailPackageType ? `${rule.ruleName} / ${rule.detailPackageType}` : rule.ruleName;
}

export default function DetailSplitFilesPage() {
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detailSplitFile, setDetailSplitFile] = useState<File | null>(null);
  const [selectedSplitRuleId, setSelectedSplitRuleId] = useState("");
  const [detailSplitUploading, setDetailSplitUploading] = useState(false);
  const [detailSplitUploadProgress, setDetailSplitUploadProgress] = useState(0);
  const [detailSplitUploadPhase, setDetailSplitUploadPhase] = useState("");
  const [detailSplitUploadErrorMessage, setDetailSplitUploadErrorMessage] = useState("");
  const [detailSplitParserReady, setDetailSplitParserReady] = useState(false);
  const [detailSplitParserLoading, setDetailSplitParserLoading] = useState(false);
  const [backgroundUploads, setBackgroundUploads] = useState<BackgroundDetailSplitUpload[]>([]);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const uploadSubmittingRef = useRef(false);
  const recognitionWasRunningRef = useRef(false);
  const backgroundUploadsRef = useRef<BackgroundDetailSplitUpload[]>([]);
  const navigate = useNavigate();
  const canDelete = hasPermission("detail_split_delete");
  const utils = trpc.useUtils();
  const backgroundUploadStorageKey = user?.id
    ? getBackgroundDetailSplitUploadStorageKey(Number(user.id))
    : "";
  const persistBackgroundUploads = useCallback((uploads: BackgroundDetailSplitUpload[]) => {
    backgroundUploadsRef.current = uploads;
    setBackgroundUploads(uploads);
    if (backgroundUploadStorageKey) {
      window.localStorage.setItem(backgroundUploadStorageKey, JSON.stringify(uploads));
    }
  }, [backgroundUploadStorageKey]);
  const filesQuery = trpc.detailSplitFile.list.useQuery(
    { search: searchQuery || undefined, page, pageSize: 20 },
    { refetchInterval: (query) => query.state.data?.items.some((item: any) => isRecognitionActive(item)) ? 2000 : false },
  );
  const rulesQuery = trpc.rule.list.useQuery({ activeOnly: true, pageSize: 100 });
  const selectedSplitRule = rulesQuery.data?.items.find((rule: any) => String(rule.id) === selectedSplitRuleId);
  const selectedRuleFields = selectedSplitRule ? {
    recognitionKeywordField: String(selectedSplitRule.detailSplitRecognitionKeywordField || "").trim(),
    incomeField: String(selectedSplitRule.detailSplitIncomeField || "").trim(),
    matchField: String(selectedSplitRule.detailSplitMatchField || "").trim(),
    orderNoField: String(selectedSplitRule.detailSplitOrderNoField || "").trim(),
  } : null;
  const deletePackage = trpc.detailSplitFile.deletePackage.useMutation({
    onSuccess: async (result) => {
      await Promise.all([
        utils.detailSplitFile.list.invalidate(),
        utils.orderFile.list.invalidate(),
        utils.task.list.invalidate(),
        utils.task.getById.invalidate(),
      ]);
      await Promise.all([
        utils.detailSplitFile.list.refetch(),
        utils.orderFile.list.refetch(),
        utils.task.list.refetch(),
      ]);
      toast.success(`已删除 ${result.deletedCount || 0} 条明细分账`);
    },
    onError: (err: any) => toast.error(err.message || "删除失败"),
  });
  const startPackageRecognition = trpc.detailSplitFile.startPackageRecognition.useMutation({
    onSuccess: async (data) => {
      await Promise.all([
        utils.detailSplitFile.list.invalidate(),
        utils.orderFile.list.invalidate(),
        utils.task.list.invalidate(),
        utils.task.getById.invalidate(),
      ]);
      await Promise.all([
        utils.detailSplitFile.list.refetch(),
        utils.orderFile.list.refetch(),
        utils.task.list.refetch(),
      ]);
      toast.info(data.message || "已开始查找分账任务");
    },
    onError: (err: any) => {
      toast.error(err.message || "拆分认账失败");
    },
  });

  const totalPages = Math.ceil((filesQuery.data?.total || 0) / 20);
  const items = useMemo(() => filesQuery.data?.items || [], [filesQuery.data?.items]);
  const recognitionRunning = items.some((item: any) => isRecognitionActive(item));
  const recognitionBusy = startPackageRecognition.isPending || recognitionRunning;
  const deletingPackageId = deletePackage.isPending ? Number(deletePackage.variables?.id || 0) : 0;

  const refreshRecognitionRelatedQueries = useCallback(async () => {
    await Promise.all([
      utils.detailSplitFile.list.invalidate(),
      utils.orderFile.list.invalidate(),
      utils.task.list.invalidate(),
      utils.task.getById.invalidate(),
    ]);
    await Promise.all([
      utils.detailSplitFile.list.refetch(),
      utils.orderFile.list.refetch(),
      utils.task.list.refetch(),
    ]);
  }, [utils]);

  useEffect(() => {
    if (!backgroundUploadStorageKey) {
      backgroundUploadsRef.current = [];
      setBackgroundUploads([]);
      return;
    }

    const storedUploads = readStoredBackgroundDetailSplitUploads(backgroundUploadStorageKey);
    backgroundUploadsRef.current = storedUploads;
    setBackgroundUploads(storedUploads);
    let disposed = false;
    let timer = 0;

    const pollBackgroundUploads = async () => {
      const currentUploads = backgroundUploadsRef.current;
      const nextUploads: BackgroundDetailSplitUpload[] = [];
      let shouldRefreshLists = false;

      for (const upload of currentUploads) {
        if (upload.status === "failed") {
          nextUploads.push(upload);
          continue;
        }
        try {
          const response = await fetch(`/api/detail-split-files/upload-session/${encodeURIComponent(upload.uploadId)}`, {
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
            continue;
          }

          if (statusResult.status === "completed") {
            const result = statusResult.result || {};
            toast.success(
              `${upload.fileName} 后台入库完成：入库 ${result.count || 0} 条，已匹配 ${result.matchedCount || 0} 条`
              + (Number(result.skippedCount || 0) > 0 ? `，跳过非交易成功 ${result.skippedCount} 条` : "")
              + (Number(result.duplicateCount || 0) > 0 ? `，丢弃重复子订单 ${result.duplicateCount} 条` : "")
              + "，已提交自动拆分认账",
            );
            shouldRefreshLists = true;
            continue;
          }
          if (statusResult.status === "failed") {
            const failedReason = statusResult.failedReason || "明细分账后台入库失败";
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

          nextUploads.push({
            ...upload,
            status: "processing",
            processingPhase: statusResult.processingPhase || "等待服务器处理",
          });
        } catch {
          nextUploads.push(upload);
        }
      }

      if (disposed) return;
      const polledUploadIds = new Set(currentUploads.map((upload) => upload.uploadId));
      const uploadsAddedDuringPoll = backgroundUploadsRef.current
        .filter((upload) => !polledUploadIds.has(upload.uploadId));
      const uploadsToPersist = [...nextUploads, ...uploadsAddedDuringPoll];
      persistBackgroundUploads(uploadsToPersist);
      if (shouldRefreshLists) await refreshRecognitionRelatedQueries();
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
  }, [backgroundUploadStorageKey, persistBackgroundUploads, refreshRecognitionRelatedQueries]);

  useEffect(() => {
    if (recognitionWasRunningRef.current && !recognitionRunning) void refreshRecognitionRelatedQueries();
    recognitionWasRunningRef.current = recognitionRunning;
  }, [recognitionRunning, refreshRecognitionRelatedQueries]);

  useEffect(() => {
    if (!uploadOpen) return;
    let active = true;
    setDetailSplitParserLoading(true);
    setDetailSplitUploadErrorMessage("");
    setDetailSplitUploadPhase("正在加载解析组件");
    preloadDetailSplitXlsxParser()
      .then(() => {
        if (!active) return;
        setDetailSplitParserReady(true);
        setDetailSplitParserLoading(false);
        setDetailSplitUploadPhase("");
      })
      .catch((error: any) => {
        if (!active) return;
        setDetailSplitParserLoading(false);
        setDetailSplitParserReady(false);
        setDetailSplitUploadPhase("");
        setDetailSplitUploadErrorMessage(error?.message || "解析组件加载失败，请刷新页面后重试。");
      });
    return () => {
      active = false;
    };
  }, [uploadOpen]);

  const handleUploadOpenChange = (open: boolean) => {
    if (!open && detailSplitUploading) return;
    setUploadOpen(open);
    if (!open) {
      setDetailSplitParserLoading(false);
      setDetailSplitUploadPhase("");
      setDetailSplitUploadErrorMessage("");
    }
  };

  const handleDelete = (item: any) => {
    if (!confirm(`确定删除明细分账上传批次 #${item.id}？此操作会回滚该批次产生的认账结果。`)) return;
    deletePackage.mutate({ id: Number(item.id) });
  };

  const handleUploadDetailSplit = async () => {
    if (!detailSplitFile || !selectedSplitRuleId || detailSplitUploading || uploadSubmittingRef.current) return;
    const matchField = selectedRuleFields?.matchField || "";
    const incomeField = selectedRuleFields?.incomeField || "";
    const recognitionKeywordField = selectedRuleFields?.recognitionKeywordField || "";
    const orderNoField = selectedRuleFields?.orderNoField || "";
    if (!recognitionKeywordField || !incomeField || !matchField || !orderNoField) {
      return toast.error("所选明细认账规则未完整配置分账包设置");
    }

    uploadSubmittingRef.current = true;
    setDetailSplitUploadErrorMessage("");
    setDetailSplitUploading(true);
    setDetailSplitUploadProgress(0);
    setDetailSplitUploadPhase(/\.xlsx$/i.test(detailSplitFile.name) && !detailSplitParserReady ? "正在加载解析组件" : "正在校验文件");
    const abortController = new AbortController();
    uploadAbortRef.current = abortController;
    const { signal } = abortController;
    try {
      if (/\.xlsx$/i.test(detailSplitFile.name) && !detailSplitParserReady) {
        setDetailSplitParserLoading(true);
        await preloadDetailSplitXlsxParser();
        setDetailSplitParserReady(true);
        setDetailSplitParserLoading(false);
      }
      if (signal.aborted) throw createUploadCancelledError();
      setDetailSplitUploadPhase("正在校验文件");
      const headerCheck = await validateDetailSplitFileHeaders(detailSplitFile, [
        matchField,
        incomeField,
        recognitionKeywordField,
        orderNoField,
        DETAIL_SPLIT_ORDER_STATUS_FIELD,
      ]);
      if (signal.aborted) throw createUploadCancelledError();
      if (!headerCheck.ok) {
        setDetailSplitUploadErrorMessage(`明细分账文件缺少列：${headerCheck.missing.join("、")}`);
        return;
      }

      setDetailSplitUploadPhase("准备上传");
      const initResponse = await fetch("/api/detail-split-files/upload-session", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify({
          ruleId: Number(selectedSplitRuleId),
          fileName: detailSplitFile.name,
          fileSize: detailSplitFile.size,
          lastModified: detailSplitFile.lastModified,
          chunkSize: DETAIL_SPLIT_UPLOAD_CHUNK_SIZE,
        }),
      });
      let session = await initResponse.json().catch(() => ({}));
      if (!initResponse.ok) throw new Error(session.error || "创建上传任务失败");

      const uploaded = new Set<number>((session.uploadedChunks || []).map(Number));
      const totalChunks = Number(session.totalChunks || Math.ceil(detailSplitFile.size / DETAIL_SPLIT_UPLOAD_CHUNK_SIZE));
      for (let index = 0; index < totalChunks; index += 1) {
        if (!uploaded.has(index)) {
          const start = index * DETAIL_SPLIT_UPLOAD_CHUNK_SIZE;
          const end = Math.min(detailSplitFile.size, start + DETAIL_SPLIT_UPLOAD_CHUNK_SIZE);
          setDetailSplitUploadPhase(`上传分片 ${index + 1}/${totalChunks}`);
          const response = await fetch(`/api/detail-split-files/upload-chunk?uploadId=${encodeURIComponent(session.uploadId)}&index=${index}`, {
            method: "PUT",
            credentials: "include",
            headers: { "content-type": "application/octet-stream" },
            body: detailSplitFile.slice(start, end),
            signal,
          });
          session = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(session.error || "分片上传失败");
          uploaded.add(index);
        }
        setDetailSplitUploadProgress(getChunkUploadProgress(uploaded.size, totalChunks));
      }

      setDetailSplitUploadPhase("合并文件并开始处理");
      setDetailSplitUploadProgress(UPLOAD_MERGE_PROGRESS);
      const completeResponse = await fetch(`/api/detail-split-files/upload-complete?uploadId=${encodeURIComponent(session.uploadId)}`, {
        method: "POST",
        credentials: "include",
        signal,
      });
      session = await completeResponse.json().catch(() => ({}));
      if (!completeResponse.ok) throw new Error(session.error || "文件合并失败");

      setDetailSplitUploadProgress(100);
      setDetailSplitUploadPhase("已转入后台处理");
      setUploadOpen(false);
      setDetailSplitFile(null);
      setSelectedSplitRuleId("");
      if (session.status === "completed" && session.result) {
        const result = session.result;
        toast.success(
          `明细分账上传成功：入库 ${result.count || 0} 条，已匹配 ${result.matchedCount || 0} 条`
          + (Number(result.skippedCount || 0) > 0 ? `，跳过非交易成功 ${result.skippedCount} 条` : "")
          + (Number(result.duplicateCount || 0) > 0 ? `，丢弃重复子订单 ${result.duplicateCount} 条` : "")
          + "，已提交自动拆分认账",
        );
        await refreshRecognitionRelatedQueries();
      } else {
        const backgroundUpload: BackgroundDetailSplitUpload = {
          uploadId: String(session.uploadId),
          fileName: detailSplitFile.name,
          status: "processing",
          processingPhase: session.processingPhase || "等待服务器排队",
          createdAt: session.createdAt || new Date().toISOString(),
        };
        persistBackgroundUploads([
          ...backgroundUploadsRef.current.filter((upload) => upload.uploadId !== backgroundUpload.uploadId),
          backgroundUpload,
        ]);
        toast.success("文件上传完成，正在后台匹配、入库并自动提交拆分认账");
      }
    } catch (err: any) {
      await utils.detailSplitFile.list.invalidate();
      if (isUploadCancelled(err, signal)) {
        toast.info("已取消上传");
        return;
      }
      setDetailSplitUploadErrorMessage(err?.message || "上传失败，请检查数据格式");
    } finally {
      if (uploadAbortRef.current === abortController) uploadAbortRef.current = null;
      uploadSubmittingRef.current = false;
      setDetailSplitParserLoading(false);
      setDetailSplitUploading(false);
      setDetailSplitUploadPhase("");
    }
  };

  const handleCancelUpload = () => {
    if (!detailSplitUploading) return;
    setDetailSplitUploadPhase("正在取消上传");
    uploadAbortRef.current?.abort();
  };

  const handleStartPackageRecognition = (item: any) => {
    startPackageRecognition.mutate({ detailSplitFileId: Number(item.id) });
  };

  const handleDismissBackgroundUpload = (uploadId: string) => {
    persistBackgroundUploads(
      backgroundUploadsRef.current.filter((upload) => upload.uploadId !== uploadId),
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">明细分账</h1>
        <Dialog
          open={uploadOpen}
          onOpenChange={handleUploadOpenChange}
        >
          <DialogTrigger asChild>
            <Button variant="outline" disabled={recognitionBusy}>
              <Upload className="h-4 w-4 mr-1" />
              上传明细分账
            </Button>
          </DialogTrigger>
          <DialogContent
            className="max-w-lg"
            onInteractOutside={(event) => {
              if (detailSplitUploading) event.preventDefault();
            }}
            onEscapeKeyDown={(event) => {
              if (detailSplitUploading) event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>上传明细分账</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label>明细分账文件（CSV / XLSX）<span className="text-red-500">*</span></Label>
                <Input
                  type="file"
                  accept=".csv,.xlsx"
                  disabled={detailSplitParserLoading || detailSplitUploading}
                  onChange={(event) => {
                    setDetailSplitFile(event.target.files?.[0] || null);
                    setDetailSplitUploadErrorMessage("");
                    if (!detailSplitUploading) setDetailSplitUploadPhase("");
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>明细认账规则 <span className="text-red-500">*</span></Label>
                <Select value={selectedSplitRuleId} onValueChange={setSelectedSplitRuleId} disabled={detailSplitParserLoading || detailSplitUploading}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择明细认账规则" />
                  </SelectTrigger>
                  <SelectContent>
                    {rulesQuery.data?.items.map((rule: any) => (
                      <SelectItem key={rule.id} value={rule.id.toString()}>
                        {formatDetailRuleName(rule)} ({rule.items?.length || 0} 个条件)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedSplitRule && (
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-gray-600 space-y-2">
                    <div className="font-medium text-gray-700">分账包设置</div>
                    <div className="grid grid-cols-1 gap-1">
                      <div>认账条件字段：{selectedRuleFields?.recognitionKeywordField || "-"}</div>
                      <div>收入字段：{selectedRuleFields?.incomeField || "-"}</div>
                      <div>明细匹配字段：{selectedRuleFields?.matchField || "-"}</div>
                      <div>子订单号字段：{selectedRuleFields?.orderNoField || "-"}（按规则永久滤重）</div>
                      <div>订单状态字段：{DETAIL_SPLIT_ORDER_STATUS_FIELD}（仅处理“交易成功”）</div>
                    </div>
                    <p className="text-gray-400">
                      系统会按规则中的分账包设置校验文件表头，并使用“匹配方式为等于”的关键字做预匹配。
                    </p>
                  </div>
                )}
              </div>
              {(detailSplitUploadPhase || detailSplitParserLoading || detailSplitUploading) && (
                <div className="flex items-center gap-2 rounded-md border bg-gray-50 px-3 py-2 text-sm text-gray-600">
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  <span>{detailSplitUploadPhase || "处理中"}</span>
                </div>
              )}
              {detailSplitUploading && detailSplitUploadProgress > 0 && (
                <div className="space-y-2">
                  <Progress value={detailSplitUploadProgress} />
                  <p className="text-xs text-gray-500">上传进度，{detailSplitUploadProgress}%</p>
                </div>
              )}
              {detailSplitUploadErrorMessage && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {detailSplitUploadErrorMessage}
                </div>
              )}
            </div>
            <DialogFooter>
              {detailSplitUploading ? (
                <Button variant="outline" onClick={handleCancelUpload}>取消上传</Button>
              ) : (
                <DialogClose asChild>
                  <Button variant="outline">取消</Button>
                </DialogClose>
              )}
              <Button
                onClick={handleUploadDetailSplit}
                disabled={!detailSplitFile || !selectedSplitRuleId || !selectedRuleFields?.recognitionKeywordField || !selectedRuleFields?.incomeField || !selectedRuleFields?.matchField || !selectedRuleFields?.orderNoField || detailSplitParserLoading || detailSplitUploading}
              >
                {detailSplitUploading ? "上传中..." : "上传并执行"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {backgroundUploads.filter((upload) => upload.status === "failed").map((upload) => (
        <Card key={upload.uploadId} className="border-red-200 bg-red-50">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge className="bg-red-100 text-red-800">后台入库失败</Badge>
                  <span className="truncate text-sm text-gray-600" title={upload.fileName}>{upload.fileName}</span>
                </div>
                <p className="text-sm text-red-700">{upload.failedReason || "明细分账后台入库失败，请重新上传"}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => handleDismissBackgroundUpload(upload.uploadId)}>
                关闭
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Input
            placeholder="搜索规则、文件或上传账号"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-80"
          />
          <Button variant="outline" disabled={recognitionBusy} onClick={() => setSearchQuery(search)}>
            <Search className="h-4 w-4 mr-1" />
            搜索
          </Button>
          <Button variant="ghost" disabled={recognitionBusy} onClick={() => { setSearch(""); setSearchQuery(""); }}>
            重置
          </Button>
        </div>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          {backgroundUploads.filter((upload) => upload.status === "processing").map((upload) => (
            <Badge key={upload.uploadId} className="max-w-full gap-1 bg-blue-100 text-blue-800 hover:bg-blue-100">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              <span className="max-w-56 truncate" title={upload.fileName}>{upload.fileName}</span>
              <span className="shrink-0">，{upload.processingPhase}</span>
            </Badge>
          ))}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">上传日期</TableHead>
                <TableHead className="w-24">条目数</TableHead>
                <TableHead>上传信息</TableHead>
                <TableHead className="w-64">状态</TableHead>
                <TableHead className="w-36">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filesQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">加载中...</TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-gray-400">暂无数据</TableCell>
                </TableRow>
              ) : (
                items.map((item: any) => {
                  const status = getBusinessStatus(item);
                  const counts = getDetailSplitCounts(item);
                  const hasRecognizableEntries = counts.unmatchedCount > 0 || counts.pendingRecognitionCount > 0;
                  const isCurrentRecognition = isRecognitionActive(item);
                  const deletingCurrentPackage = deletingPackageId === Number(item.id);
                  const recognitionTaskTotal = Math.max(0, Number(item.recognitionTaskTotal || 0));
                  const recognitionTaskCompleted = Math.max(0, Number(item.recognitionTaskCompleted || 0));
                  const recognitionTaskCurrent = recognitionTaskTotal > 0
                    ? Math.min(recognitionTaskTotal, recognitionTaskCompleted + 1)
                    : 0;
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-sm">{item.uploadDate}</TableCell>
                      <TableCell>
                        <div>{Number(item.entryCount || 0).toLocaleString("zh-CN")} 条</div>
                        {Number(item.duplicateCount || 0) > 0 && (
                          <div className="text-xs text-gray-500">重复丢弃 {Number(item.duplicateCount).toLocaleString("zh-CN")} 条</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[360px] space-y-1">
                          <div className="truncate text-sm" title={item.fileName}>{item.fileName}</div>
                          <div className="truncate text-xs text-gray-500" title={item.ruleName || ""}>{item.ruleName || "-"}</div>
                          <div className="truncate text-xs text-gray-500" title={item.uploadInfo}>{item.uploadInfo}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {isCurrentRecognition ? (
                          <div className="whitespace-nowrap text-xs font-medium text-indigo-700">
                            {item.recognitionPhase === "finding_tasks"
                              ? "1/2 查找分账任务"
                              : `2/2 明细分账认账中（${recognitionTaskCurrent}/${recognitionTaskTotal}）`}
                          </div>
                        ) : (
                          <>
                            <Badge className={status.className}>{status.label}</Badge>
                            <div className="mt-1 text-xs text-gray-500">
                              {counts.unmatchedCount} 未匹配 / {counts.pendingRecognitionCount} 待认账 / {counts.recognizedCount} 已认账
                            </div>
                            {deletingCurrentPackage && <div className="mt-1 text-xs font-medium text-blue-600">删除中</div>}
                            {item.failedReason && <div className="mt-1 text-xs text-red-500">{item.failedReason}</div>}
                            {item.recognitionFailedReason && <div className="mt-1 text-xs text-red-500">{item.recognitionFailedReason}</div>}
                          </>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-green-600"
                            title="开始拆分认账"
                            disabled={recognitionBusy || deletePackage.isPending || item.uploadStatus !== "completed" || !hasRecognizableEntries}
                            onClick={() => handleStartPackageRecognition(item)}
                          >
                            {isCurrentRecognition ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-blue-600" title="查看" disabled={recognitionBusy || deletePackage.isPending} onClick={() => navigate(`/detail-split-files/${item.id}`)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          {counts.unmatchedCount > 0 && (
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-amber-600" title="查看未匹配明细" disabled={recognitionBusy || deletePackage.isPending} onClick={() => navigate(`/detail-split-files/${item.id}?matchStatus=unmatched`)}>
                              <ListFilter className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className={`h-7 w-7 p-0 ${canDelete ? "text-red-500 hover:text-red-700" : "text-gray-300"}`}
                            title={canDelete ? "删除" : "无删除权限"}
                            disabled={!canDelete || recognitionBusy || deletePackage.isPending}
                            onClick={() => handleDelete(item)}
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

      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem><PaginationPrevious onClick={() => setPage((value) => Math.max(1, value - 1))} /></PaginationItem>
            {Array.from({ length: totalPages }, (_, index) => index + 1).map((value) => (
              <PaginationItem key={value}>
                <PaginationLink isActive={value === page} onClick={() => setPage(value)}>{value}</PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem><PaginationNext onClick={() => setPage((value) => Math.min(totalPages, value + 1))} /></PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
