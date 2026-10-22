import { useNavigate, useParams } from "react-router";
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
import { ArrowLeft, Calendar, Hash } from "lucide-react";

function formatPercent(value: unknown) {
  return `${parseInt(String(value ?? "0"), 10) || 0}%`;
}

function formatSplitForm(split: any) {
  return split.splitForm === "认账时填写" ? "认账时填写" : `百分比 ${formatPercent(split.splitRatio)}`;
}

function formatManagementFee(split: any) {
  const type = split.managementFeeType === "金额" ? "金额" : "百分比";
  const value = split.managementFeeValue ?? split.managementFeeRatio;
  if (type === "金额") {
    return `金额 ${Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `百分比 ${formatPercent(value)}`;
}

export default function IncomeRuleViewPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const ruleId = parseInt(id || "0", 10);
  const ruleQuery = trpc.incomeRule.getById.useQuery({ id: ruleId }, { enabled: ruleId > 0 });
  const rule = ruleQuery.data;

  if (ruleQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" onClick={() => navigate("/income-recognition")}>
          <ArrowLeft className="h-4 w-4 mr-1" />返回
        </Button>
        <div className="text-gray-500 py-8">加载中...</div>
      </div>
    );
  }

  if (!rule) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" onClick={() => navigate("/income-recognition")}>
          <ArrowLeft className="h-4 w-4 mr-1" />返回
        </Button>
        <div className="text-red-500 py-8">规则不存在</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate("/income-recognition")}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            返回
          </Button>
          <h1 className="text-xl font-semibold">规则详情</h1>
        </div>
        <Badge className={rule.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}>
          {rule.isActive ? "启用" : "停用"}
        </Badge>
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          <h3 className="font-semibold text-sm text-gray-500 border-b pb-2">基本信息</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Hash className="h-4 w-4 text-gray-400" />
              <span className="text-gray-500">ID:</span>
              <span className="font-mono">{rule.id}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-gray-400" />
              <span className="text-gray-500">创建时间:</span>
              <span>{new Date(rule.createdAt).toLocaleDateString()}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-gray-400" />
              <span className="text-gray-500">修改时间:</span>
              <span>{new Date(rule.updatedAt).toLocaleDateString()}</span>
            </div>
            <div className="md:col-span-2">
              <span className="text-gray-500">规则名称:</span>
              <span className="font-medium ml-2">{rule.ruleName}</span>
            </div>
            <div>
              <span className="text-gray-500">认账类型:</span>
              <span className="font-medium ml-2">{rule.recognitionType === "银行直捐" ? "银行直捐" : "渠道捐赠"}</span>
            </div>
            <div>
              <span className="text-gray-500">匹配到账信息:</span>
              <span className="font-medium ml-2">{rule.matchedCounterpartyAlias || "未关联到账信息"}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6 space-y-4">
          <h3 className="font-semibold text-sm text-gray-700 border-b pb-2">分账设置</h3>
          <div className="border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead className="w-10 text-center">#</TableHead>
                  <TableHead>分账形式</TableHead>
                  <TableHead>收入类型</TableHead>
                  <TableHead>捐赠来源</TableHead>
                  <TableHead>收入属性</TableHead>
                  <TableHead>备注</TableHead>
                  <TableHead>部门</TableHead>
                  <TableHead>预算编码</TableHead>
                  <TableHead>NC项目名称</TableHead>
                  <TableHead>平台项目名称</TableHead>
                  <TableHead>平台项目详情</TableHead>
                  <TableHead>反馈类型</TableHead>
                  <TableHead>会员姓名</TableHead>
                  <TableHead>所属项目中心</TableHead>
                  <TableHead>地区</TableHead>
                  <TableHead>匿名</TableHead>
                  <TableHead>支出资金来源</TableHead>
                  <TableHead>管理费</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rule.splits?.length ? rule.splits.map((split: any, index: number) => (
                  <TableRow key={split.id || index}>
                    <TableCell className="text-center text-sm text-gray-500">{index + 1}</TableCell>
                    <TableCell className="font-medium">{formatSplitForm(split)}</TableCell>
                    <TableCell>{split.incomeType || "-"}</TableCell>
                    <TableCell>{split.donationSource || "-"}</TableCell>
                    <TableCell>{split.incomeAttr || "-"}</TableCell>
                    <TableCell>{split.remark || "-"}</TableCell>
                    <TableCell>{split.incomeDept || "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{split.budgetCode || "-"}</TableCell>
                    <TableCell>{split.incomeProject || "-"}</TableCell>
                    <TableCell>{split.platformProjectName || "-"}</TableCell>
                    <TableCell>{split.platformProjectDetail || "-"}</TableCell>
                    <TableCell>{split.feedbackType || "-"}</TableCell>
                    <TableCell>{split.memberName || "-"}</TableCell>
                    <TableCell>{split.projectCenter || "-"}</TableCell>
                    <TableCell>{split.region || "-"}</TableCell>
                    <TableCell>{split.isAnonymous ? "是" : "-"}</TableCell>
                    <TableCell>{split.expenseFundSource || "-"}</TableCell>
                    <TableCell>{formatManagementFee(split)}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={18} className="text-center py-6 text-gray-400">暂无分账设置</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
