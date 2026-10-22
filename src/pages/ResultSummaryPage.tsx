import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DeptTreeSelect } from "@/components/TreeSelects";
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
import { BarChart3, Search, X } from "lucide-react";

type SummaryDimension = "budgetCode" | "expenseFundSource";

function formatAmount(value: number | string | null | undefined) {
  return Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function ResultSummaryPage() {
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 8 }, (_, index) => String(currentYear - index));
  const [year, setYear] = useState(String(currentYear));
  const [incomeDept, setIncomeDept] = useState("");
  const [dimension, setDimension] = useState<SummaryDimension>("budgetCode");
  const [appliedFilter, setAppliedFilter] = useState<{
    year: string;
    incomeDept: string;
    dimension: SummaryDimension;
  } | null>(null);

  const departmentsQuery = trpc.department.tree.useQuery(undefined, { staleTime: 5 * 60_000 });
  const summaryQuery = trpc.result.summary.useQuery({
    year: appliedFilter?.year || year,
    incomeDept: appliedFilter?.incomeDept || undefined,
    dimension: appliedFilter?.dimension || dimension,
  }, {
    enabled: !!appliedFilter,
    staleTime: 60_000,
  });

  const dimensionLabel = (appliedFilter?.dimension || dimension) === "budgetCode" ? "预算编码" : "支出资金来源";
  const total = summaryQuery.data?.total;
  const items = summaryQuery.data?.items || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">入账汇总</h1>
          <p className="mt-1 text-sm text-gray-500">按年份、部门和汇总口径查看入账金额、项目资金与管理费</p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-4 md:grid-cols-[repeat(3,minmax(0,1fr))_auto] md:items-end">
            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-700">年份</div>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((item) => (
                    <SelectItem key={item} value={item}>{item}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-700">部门</div>
              <div className="relative [&>div>button>span:first-child]:mr-8 [&>div>button>span:first-child]:flex-1">
                <DeptTreeSelect
                  value={incomeDept}
                  tree={departmentsQuery.data || []}
                  onChange={setIncomeDept}
                  placeholder={departmentsQuery.isLoading ? "部门加载中..." : "全部部门"}
                />
                {incomeDept && (
                  <button
                    type="button"
                    title="清空部门"
                    aria-label="清空部门"
                    className="absolute right-8 top-1/2 z-10 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      setIncomeDept("");
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-700">汇总口径</div>
              <Select value={dimension} onValueChange={(value) => setDimension(value as SummaryDimension)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="budgetCode">预算编码</SelectItem>
                  <SelectItem value="expenseFundSource">支出资金来源</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              className="h-9 gap-2"
              onClick={() => {
                setAppliedFilter({ year, incomeDept, dimension });
              }}
            >
              <Search className="h-4 w-4" />
              查询
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-gray-500">入账金额合计</p>
            <p className="mt-2 text-2xl font-semibold text-blue-700">¥{formatAmount(total?.totalAmount)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-gray-500">项目资金合计</p>
            <p className="mt-2 text-2xl font-semibold text-emerald-700">¥{formatAmount(total?.projectFundAmount)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-gray-500">管理费合计</p>
            <p className="mt-2 text-2xl font-semibold text-slate-800">¥{formatAmount(total?.managementFeeAmount)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <p className="text-sm text-gray-500">入账记录数</p>
            <p className="mt-2 text-2xl font-semibold text-slate-800">{Number(total?.resultCount || 0).toLocaleString("zh-CN")}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <BarChart3 className="h-4 w-4 text-blue-600" />
              汇总列表
            </h2>
            <div className="text-sm text-gray-500">共 {items.length} 条</div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{dimensionLabel}</TableHead>
                <TableHead className="w-[140px] text-right">入账记录数</TableHead>
                <TableHead className="w-[180px] text-right">入账金额</TableHead>
                <TableHead className="w-[180px] text-right">项目资金</TableHead>
                <TableHead className="w-[180px] text-right">管理费</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!appliedFilter ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-gray-400">请选择条件后查询</TableCell>
                </TableRow>
              ) : summaryQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-gray-500">加载中...</TableCell>
                </TableRow>
              ) : summaryQuery.isError ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-red-500">汇总加载失败，请确认数据库迁移已执行</TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-gray-400">暂无汇总数据</TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow key={item.dimensionValue}>
                    <TableCell className="font-medium">{item.dimensionValue}</TableCell>
                    <TableCell className="text-right">{item.resultCount.toLocaleString("zh-CN")}</TableCell>
                    <TableCell className="text-right font-medium text-blue-700">¥{formatAmount(item.totalAmount)}</TableCell>
                    <TableCell className="text-right font-medium text-emerald-700">¥{formatAmount(item.projectFundAmount)}</TableCell>
                    <TableCell className="text-right font-medium">¥{formatAmount(item.managementFeeAmount)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
