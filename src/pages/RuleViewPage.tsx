import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Calendar, Hash, Pencil, User } from "lucide-react";

function flattenProjectNodes(nodes: any[]): any[] {
  return nodes.flatMap((node) => [node, ...flattenProjectNodes(node.children || [])]);
}

function formatPlatformProjectName(value: string | null | undefined, tree: any[]) {
  if (!value) return "-";
  if (value.includes(" / ")) return value;
  const code = value.split("_")[0];
  const node = flattenProjectNodes(tree).find((item) => item.code === code);
  return node?.platformName ? `${node.platformName} / ${value}` : value;
}

function formatPercent(value: unknown) {
  const parsed = parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : "0";
}

function sortSplits(splits: any[] = []) {
  return splits.slice().sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0));
}

export default function RuleViewPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const ruleId = parseInt(id || "0", 10);
  const [keywordSearch, setKeywordSearch] = useState("");

  const ruleQuery = trpc.rule.getById.useQuery(
    { id: ruleId },
    { enabled: ruleId > 0 }
  );
  const projectTreeQuery = trpc.project.tree.useQuery();

  const rule = ruleQuery.data;
  const conditionRecognitionEnabled = rule?.conditionRecognitionEnabled !== false;
  const normalizedSearch = keywordSearch.trim().toLocaleLowerCase();
  const filteredItems = useMemo(() => {
    const items = rule?.items || [];
    if (rule?.conditionRecognitionEnabled === false) return items.slice(0, 1);
    if (!normalizedSearch) return items;
    return items.filter((item: any) => {
      const haystack = [
        item.keywordField,
        item.keywordMatchType || "等于",
        item.detailKeyword,
      ].join(" ").toLocaleLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [normalizedSearch, rule?.conditionRecognitionEnabled, rule?.items]);

  if (ruleQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" onClick={() => navigate("/rules")}>
          <ArrowLeft className="h-4 w-4 mr-1" />返回
        </Button>
        <div className="text-gray-500 py-8">加载中...</div>
      </div>
    );
  }

  if (!rule) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" onClick={() => navigate("/rules")}>
          <ArrowLeft className="h-4 w-4 mr-1" />返回
        </Button>
        <div className="text-red-500 py-8">规则不存在</div>
      </div>
    );
  }

  const excludeConditions = rule.excludeConditions.length > 0
    ? rule.excludeConditions
    : rule.excludeOrderField || rule.excludeOrderKeyword
      ? [{
        id: 0,
        fieldName: rule.excludeOrderField || "",
        matchType: "等于" as const,
        keyword: rule.excludeOrderKeyword || "",
        sortOrder: 0,
      }]
      : [];
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate("/rules")}>
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
              <User className="h-4 w-4 text-gray-400" />
              <span className="text-gray-500">创建人:</span>
              <span>{rule.creator?.name || "-"}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-gray-400" />
              <span className="text-gray-500">启用时间:</span>
              <span>{new Date(rule.enabledAt).toLocaleDateString()}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">日期字段:</span>
              <span className="font-medium">{rule.dateField || "-"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">收入字段:</span>
              <span className="font-medium">{rule.incomeField || "-"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">退款字段:</span>
              <span className="font-medium">{rule.refundAmountField || "-"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">订单号字段:</span>
              <span className="font-medium">{rule.orderNoField || "-"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">票据用其他单号1:</span>
              <span className="font-medium">{rule.invoiceOtherOrderNo1Field || "-"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">票据用其他单号2:</span>
              <span className="font-medium">{rule.invoiceOtherOrderNo2Field || "-"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">条件认账:</span>
              <span className="font-medium">{conditionRecognitionEnabled ? "开启" : "关闭"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">排除订单:</span>
              <span className="font-medium">{rule.excludeOrderEnabled ? "开启" : "关闭"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">退款订单:</span>
              <span className="font-medium">{rule.refundOrderEnabled ? "开启" : "关闭"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">明细分账:</span>
              <span className="font-medium">{rule.detailSplitEnabled ? "开启" : "关闭"}</span>
            </div>
            <div className="md:col-span-3">
              <span className="text-gray-500">规则名称:</span>
              <span className="font-medium ml-2">{rule.ruleName}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {rule.excludeOrderEnabled && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <h3 className="font-semibold text-sm text-gray-500 border-b pb-2">排除订单</h3>
            <div className="space-y-3 text-sm">
              {excludeConditions.map((condition, index) => (
                <div key={condition.id || index} className="grid grid-cols-1 gap-3 rounded-md border border-slate-200 bg-slate-50/60 p-3 md:grid-cols-3">
                  <div><span className="text-gray-500">条件:</span><span className="font-medium ml-2">{index + 1}</span></div>
                  <div><span className="text-gray-500">识别字段:</span><span className="font-medium ml-2">{condition.fieldName || "-"}</span></div>
                  <div><span className="text-gray-500">匹配:</span><span className="font-medium ml-2">{condition.matchType || "等于"}“{condition.keyword || "-"}”</span></div>
                </div>
              ))}
              {excludeConditions.length === 0 && (
                <div className="text-gray-400">未配置排除条件</div>
              )}
              </div>
          </CardContent>
        </Card>
      )}

      {rule.refundOrderEnabled && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <h3 className="font-semibold text-sm text-gray-500 border-b pb-2">退款订单</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-gray-500">判断字段:</span>
                <span className="font-medium">{rule.refundJudgeField || "-"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">退款订单字段值:</span>
                <span className="font-medium">{rule.refundJudgeValue || "-"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">收支方向字段值:</span>
                <span className="font-medium">{rule.refundDirectionJudgeValue || "-"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">退款金额字段:</span>
                <span className="font-medium">{rule.refundAmountField || "-"}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {rule.detailSplitEnabled && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <h3 className="font-semibold text-sm text-gray-500 border-b pb-2">明细分账</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-gray-500">明细分账判断字段:</span>
                <span className="font-medium">{rule.multiSplitKeywordField || "-"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">判断关键字:</span>
                <span className="font-medium">{rule.multiSplitKeyword || "-"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">明细匹配字段:</span>
                <span className="font-medium">{rule.multiSplitMatchField || "-"}</span>
              </div>
            </div>
            <h4 className="pt-2 text-xs font-semibold text-gray-500">分账包设置</h4>
            <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-4">
              <div><span className="text-gray-500">子订单号字段:</span><span className="font-medium ml-2">{rule.detailSplitOrderNoField || "-"}</span></div>
              <div><span className="text-gray-500">认账条件字段:</span><span className="font-medium ml-2">{rule.detailSplitRecognitionKeywordField || "-"}</span></div>
              <div><span className="text-gray-500">收入字段:</span><span className="font-medium ml-2">{rule.detailSplitIncomeField || "-"}</span></div>
              <div><span className="text-gray-500">明细匹配字段:</span><span className="font-medium ml-2">{rule.detailSplitMatchField || "-"}</span></div>
            </div>
          </CardContent>
        </Card>
      )}

      {conditionRecognitionEnabled ? (
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Input
            value={keywordSearch}
            onChange={(event) => setKeywordSearch(event.target.value)}
            placeholder="搜索关键字、关键字字段或匹配方式"
            className="w-full md:max-w-3xl"
          />
          <div className="shrink-0 text-sm text-gray-500">
            共 {rule.items?.length || 0} 个条件{normalizedSearch ? `，匹配 ${filteredItems.length} 个` : ""}
          </div>
        </div>
      ) : (
        <div className="text-sm text-gray-500">条件认账已关闭，订单包会按下方分账设置汇总入账。</div>
      )}

      {filteredItems.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-gray-400">没有匹配的认账条件</CardContent>
        </Card>
      ) : filteredItems.map((item: any) => {
        const originalIndex = rule.items?.findIndex((ruleItem: any) => ruleItem.id === item.id) ?? 0;
        return (
          <Card key={item.id}>
            <CardContent className="p-6 space-y-4">
              <div className="flex flex-col gap-3 border-b pb-3 md:flex-row md:items-center md:justify-between">
                <h3 className="font-semibold text-sm text-gray-700">
                  {conditionRecognitionEnabled
                    ? `条件 ${originalIndex + 1}：${item.keywordField} ${item.keywordMatchType || "等于"} "${item.detailKeyword}"`
                    : "整包分账设置"}
                </h3>
                {conditionRecognitionEnabled && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigate(`/rules/${ruleId}/items/${item.id}/edit`)}
                  >
                    <Pencil className="h-4 w-4 mr-1" />
                    编辑条件
                  </Button>
                )}
              </div>
              <div className="border rounded-md overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="w-10 text-center">#</TableHead>
                      <TableHead>分账比例%</TableHead>
                      <TableHead>捐赠来源</TableHead>
                      <TableHead>收入属性</TableHead>
                      <TableHead>部门</TableHead>
                      <TableHead>预算编码</TableHead>
                      <TableHead>NC项目名称</TableHead>
                      <TableHead>平台项目名称</TableHead>
                      <TableHead>平台项目详情</TableHead>
                      <TableHead>支出资金来源</TableHead>
                      <TableHead>管理费比例%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {item.splits && item.splits.length > 0 ? (
                      sortSplits(item.splits).map((split: any, sIdx: number) => (
                        <TableRow key={split.id || sIdx}>
                          <TableCell className="text-center text-sm text-gray-500">{sIdx + 1}</TableCell>
                          <TableCell className="font-medium">{formatPercent(split.splitRatio)}%</TableCell>
                          <TableCell>互联网募捐平台</TableCell>
                          <TableCell>{split.incomeAttr || "-"}</TableCell>
                          <TableCell>{split.incomeDept || "-"}</TableCell>
                          <TableCell className="font-mono text-xs">{split.budgetCode || "-"}</TableCell>
                          <TableCell>{split.incomeProject || "-"}</TableCell>
                          <TableCell>{formatPlatformProjectName(split.platformProjectName, projectTreeQuery.data || [])}</TableCell>
                          <TableCell>{split.platformProjectDetail || "-"}</TableCell>
                          <TableCell>{split.expenseFundSource || "-"}</TableCell>
                          <TableCell>{split.managementFeeRatio != null ? `${formatPercent(split.managementFeeRatio)}%` : "-"}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={11} className="text-center py-6 text-gray-400">
                          暂无分账设置
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
