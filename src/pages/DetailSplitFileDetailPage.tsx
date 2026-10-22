import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";

export default function DetailSplitFileDetailPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const params = useParams();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const routeId = Number(params.id || 0);
  const matchStatus = searchParams.get("matchStatus") || "";
  const detailsQuery = trpc.detailSplitFile.getDetails.useQuery({
    id: routeId,
    matchStatus: ["matched", "unmatched", "recognized", "unrecognized"].includes(matchStatus) ? matchStatus as any : undefined,
    page,
    pageSize: 100,
  });
  const items = detailsQuery.data?.items || [];
  const totalPages = Math.ceil((detailsQuery.data?.total || 0) / 100);
  const fields = detailsQuery.data?.fields;

  const formatBillDate = (value: unknown) => {
    const text = String(value || "").trim();
    return !text || text === "1970-01-01" ? "-" : text;
  };

  const renderFieldHeader = (fieldName: string | null | undefined, label: string) => (
    <div className="leading-tight">
      <div>{fieldName || "-"}</div>
      <div className="mt-1 text-xs font-normal text-gray-500">（{label}）</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate("/detail-split-files")}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            返回
          </Button>
          <h1 className="text-xl font-semibold">明细分账上传批次 #{routeId}</h1>
        </div>
        <Select
          value={matchStatus || "__all"}
          onValueChange={(value) => {
            const params = new URLSearchParams(searchParams);
            if (value === "__all") params.delete("matchStatus");
            else params.set("matchStatus", value);
            setSearchParams(params);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">全部状态</SelectItem>
            <SelectItem value="unmatched">未匹配</SelectItem>
            <SelectItem value="matched">待认账</SelectItem>
            <SelectItem value="recognized">已认账</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>分账明细号</TableHead>
                <TableHead>订单日期</TableHead>
                <TableHead title={fields?.orderNoField || ""}>{renderFieldHeader(fields?.orderNoField, "子订单号字段")}</TableHead>
                <TableHead title={fields?.matchField || ""}>{renderFieldHeader(fields?.matchField, "明细匹配字段")}</TableHead>
                <TableHead title={fields?.recognitionKeywordField || ""}>{renderFieldHeader(fields?.recognitionKeywordField, "认账条件字段")}</TableHead>
                <TableHead title={fields?.incomeField || ""}>{renderFieldHeader(fields?.incomeField, "收入字段")}</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detailsQuery.isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8">加载中...</TableCell></TableRow>
              ) : items.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-gray-400">暂无数据</TableCell></TableRow>
              ) : (
                items.map((item: any) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono">{item.id}</TableCell>
                    <TableCell className="font-mono text-xs">{item.billNo || "-"}</TableCell>
                    <TableCell>{formatBillDate(item.billDate)}</TableCell>
                    <TableCell>
                      <div className="max-w-[260px] truncate font-mono text-xs" title={item.orderNoValue || ""}>{item.orderNoValue || "-"}</div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[360px] truncate" title={item.splitMatchValue || ""}>{item.splitMatchValue || "-"}</div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[520px] truncate" title={item.recognitionKeywordValue || ""}>{item.recognitionKeywordValue || "-"}</div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[220px] truncate" title={item.incomeValue || ""}>{item.incomeValue || "-"}</div>
                    </TableCell>
                    <TableCell>
                      <Badge className={item.matchResultId ? "bg-blue-100 text-blue-800" : item.matchStatus === "matched" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}>
                        {item.matchResultId ? "已认账" : item.matchStatus === "matched" ? "待认账" : "未匹配"}
                      </Badge>
                      {item.archived && <Badge variant="outline" className="ml-1 text-gray-500">已归档</Badge>}
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
