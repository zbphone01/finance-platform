import { useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FileText } from "lucide-react";

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

export default function OrderFileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const orderFileId = parseInt(id || "0");
  const [page, setPage] = useState(1);
  const packageBillDate = searchParams.get("billDate")?.trim();
  const packageRuleId = Number(searchParams.get("ruleId") || 0);
  const packageDetailType = searchParams.get("detailPackageType") === "打包明细" ? "打包明细" : "T+1";
  const matchStatusParam = searchParams.get("matchStatus");
  const returnPageParam = Number(searchParams.get("returnPage"));
  const returnPage = Number.isInteger(returnPageParam) && returnPageParam > 0 ? returnPageParam : 1;
  const statusFilter = matchStatusParam === "matched"
    || matchStatusParam === "unmatched"
    || matchStatusParam === "pending_split"
    || matchStatusParam === "unmatched_with_pending_split"
    ? matchStatusParam
    : undefined;
  const urlPackageScope = packageBillDate && packageRuleId > 0
    ? { billDate: packageBillDate, ruleId: packageRuleId, detailPackageType: packageDetailType as "T+1" | "打包明细" }
    : undefined;

  const fileQuery = trpc.orderFile.getById.useQuery(
    { id: orderFileId },
    { enabled: orderFileId > 0 }
  );
  const file = fileQuery.data;
  const filePackageScope = !urlPackageScope
    && file?.detailPackageType === "打包明细"
    && file.uploadDate
    && Number(file.ruleId || 0) > 0
    ? { billDate: file.uploadDate, ruleId: Number(file.ruleId), detailPackageType: "打包明细" as const }
    : undefined;
  const packageScope = urlPackageScope || filePackageScope;
  const detailsQuery = trpc.orderFile.getDetails.useQuery(
    { orderFileId, packageScope, matchStatus: statusFilter, page, pageSize: 100 },
    { enabled: orderFileId > 0 && (!fileQuery.isLoading || Boolean(urlPackageScope)) }
  );

  const rawColumns = file?.rawColumns;
  const headers = rawColumns ? rawColumns.split(",") : [];
  const showRawColumns = headers.length > 0;
  const summary = packageScope ? detailsQuery.data?.summary : undefined;
  const displayEntryCount = Number(summary?.entryCount ?? file?.entryCount ?? 0);
  const displayMatchedCount = Number(summary?.matchedCount ?? file?.matchedCount ?? 0);
  const displayUnmatchedCount = Number(summary?.unmatchedCount ?? file?.unmatchedCount ?? 0);
  const pendingSplitCount = Number(summary?.pendingSplitCount ?? (file as any)?.pendingSplitCount ?? 0);
  const displayOrderTotalAmount = Number(summary?.orderTotalAmount ?? (file as any)?.orderTotalAmount ?? 0);
  const displayRefundAmount = Number(summary?.refundAmount ?? (file as any)?.refundAmount ?? 0);

  const statusMap: Record<string, { label: string; className: string }> = {
    matched: { label: "已匹配", className: "bg-green-100 text-green-800" },
    unmatched: { label: "未匹配", className: "bg-yellow-100 text-yellow-800" },
    pending_split: { label: "待拆分", className: "bg-purple-100 text-purple-800" },
    split_done: { label: "已拆分", className: "bg-sky-100 text-sky-800" },
    ignored: { label: "已忽略", className: "bg-gray-100 text-gray-700" },
    unmatched_with_pending_split: { label: "未匹配", className: "bg-yellow-100 text-yellow-800" },
  };
  const uploadStatusMap: Record<string, { label: string; className: string }> = {
    processing: { label: "入库中", className: "bg-blue-100 text-blue-800" },
    completed: { label: "已完成", className: "bg-green-100 text-green-800" },
    failed: { label: "失败", className: "bg-red-100 text-red-800" },
    abnormal: { label: "异常", className: "bg-orange-100 text-orange-800" },
  };

  if (fileQuery.isLoading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  if (!file) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="text-gray-500">订单文件不存在或已被删除</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(returnPage > 1 ? `/order-files?page=${returnPage}` : "/order-files")}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          返回
        </Button>
        <h1 className="text-xl font-semibold">订单明细内容</h1>
      </div>

      {/* File Info Card */}
      <Card>
        <CardContent className="p-4">
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-10 gap-y-3">
              <div className="whitespace-nowrap text-gray-500">
                条目数: <span className="font-medium text-gray-700">{displayEntryCount} 条</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-gray-500">
                <span className="whitespace-nowrap">匹配: <span className="font-medium text-green-700">{displayMatchedCount}</span></span>
                <span className="whitespace-nowrap">未匹配: <span className="font-medium text-amber-700">{displayUnmatchedCount}</span></span>
                <span className="whitespace-nowrap">待拆分: <span className="font-medium text-purple-700">{pendingSplitCount}</span></span>
              </div>
              <div className="whitespace-nowrap text-gray-500">
                收入金额: <span className="font-medium text-blue-700">
                  {displayOrderTotalAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="whitespace-nowrap text-gray-500">
                退款金额: <span className="font-medium text-red-700">
                  {displayRefundAmount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="whitespace-nowrap text-gray-500">
                上传状态: <Badge className={uploadStatusMap[file.uploadStatus]?.className || "bg-gray-100 text-gray-800"}>
                  {uploadStatusMap[file.uploadStatus]?.label || file.uploadStatus || "已完成"}
                </Badge>
              </div>
            </div>
            <div className="flex items-center gap-2 min-w-0 text-gray-500">
              <FileText className="h-4 w-4 text-blue-600 shrink-0" />
              <span className="shrink-0">文件名称:</span>
              <span className="font-medium text-gray-800 truncate" title={file.fileName}>{file.fileName}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Details Table */}
      <Card>
        <CardContent className="p-0">
          <div className="text-sm text-gray-500 p-4 pb-0">
            共 {detailsQuery.data?.total || 0} 条明细
            {packageScope && (
              <span className="ml-2 text-amber-600">
                {statusFilter ? "仅显示" : "显示"} {packageScope.billDate} / {packageScope.detailPackageType} 数据包
                {statusFilter ? `${statusMap[statusFilter]?.label || ""}明细` : "明细"}
              </span>
            )}
            {showRawColumns && (
              <span className="ml-2 text-blue-500">（原始列：{headers.join("、")}）</span>
            )}
          </div>
          <div className="overflow-auto">
            <Table className="w-max min-w-full table-auto text-xs [&_td]:px-1 [&_td]:py-1 [&_th]:h-8 [&_th]:px-1">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">ID</TableHead>
                  {showRawColumns ? (
                    headers.map((h: string) => <TableHead key={h}>{h}</TableHead>)
                  ) : (
                    <>
                      <TableHead>时间</TableHead>
                      <TableHead>订单金额</TableHead>
                      <TableHead>备注</TableHead>
                    </>
                  )}
                  <TableHead className="w-24">匹配状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detailsQuery.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={showRawColumns ? headers.length + 2 : 5} className="text-center py-8">
                      加载中...
                    </TableCell>
                  </TableRow>
                ) : detailsQuery.data?.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={showRawColumns ? headers.length + 2 : 5} className="text-center py-8 text-gray-400">
                      暂无数据
                    </TableCell>
                  </TableRow>
                ) : (
                  detailsQuery.data?.items.map((d: any) => {
                    const raw = d.rawData || {};
                    return (
                      <TableRow key={d.id}>
                        <TableCell className="font-mono">{d.id}</TableCell>
                        {showRawColumns ? (
                          headers.map((h: string) => (
                            <TableCell key={h}>
                              {formatRawCell(h, raw[h])}
                            </TableCell>
                          ))
                        ) : (
                          <>
                            <TableCell>{d.billDate}</TableCell>
                            <TableCell className={Number(d.totalAmount) < 0 ? "text-red-600" : "text-blue-700"}>
                              {Number(d.totalAmount).toLocaleString("zh-CN", { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell>{d.description || "-"}</TableCell>
                          </>
                        )}
                        <TableCell>
                          {(() => {
                            const displayStatus = d.operationStatus === "split_replaced"
                              || (
                                d.operationStatus === "ignored"
                                && String(d.ignoreReason || "").startsWith("已按明细分账拆分认账")
                              )
                              ? "split_done"
                              : d.matchStatus;
                            const s = statusMap[displayStatus] || statusMap.unmatched;
                            return <Badge className={s.className}>{s.label}</Badge>;
                          })()}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          {detailsQuery.data && detailsQuery.data.total > 100 && (
            <div className="flex justify-center p-4 gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                上一页
              </Button>
              <span className="text-sm text-gray-500 self-center">第 {page} 页</span>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={page * 100 >= (detailsQuery.data?.total || 0)}>
                下一页
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
