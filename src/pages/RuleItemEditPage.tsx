import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import {
  BudgetCodeSelect,
  DeptTreeSelect,
  DonationActivitySelect,
  NCProjectSelect,
  PlatformProjectDetailSelect,
  PlatformProjectSelect,
} from "@/components/TreeSelects";

interface SplitForm {
  splitRatio: string;
  incomeType: string;
  incomeAttr: string;
  incomeDept: string;
  budgetCode: string;
  incomeProject: string;
  platformProjectName: string;
  platformProjectDetail: string;
  managementFeeRatio: string;
  expenseFundSource: string;
}

interface ConditionForm {
  keywordField: string;
  detailKeyword: string;
  keywordMatchType: "等于" | "包含";
  splits: SplitForm[];
}

type ConditionErrors = {
  fields?: string[];
  splitErrors?: Record<number, string[]>;
};

const incomeAttrOptions = ["非限定性收入", "限定性收入"];
const fixedDetailDonationSource = "互联网募捐平台";
const EMPTY_TREE: any[] = [];

function formatPercent(value: unknown) {
  const parsed = parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : "0";
}

function getProjectNameForFundSource(value: string) {
  const projectPart = value.includes(" / ") ? value.split(" / ").pop() || value : value;
  const parts = projectPart.split("_");
  return parts.length > 1 ? parts.slice(1).join("_") : projectPart;
}

function createEmptySplit(): SplitForm {
  return {
    splitRatio: "0",
    incomeType: "捐赠收入",
    incomeAttr: "",
    incomeDept: "",
    budgetCode: "",
    incomeProject: "",
    platformProjectName: "",
    platformProjectDetail: "",
    managementFeeRatio: "5",
    expenseFundSource: "",
  };
}

function toConditionForm(item: any): ConditionForm {
  const sortedSplits = item.splits?.slice().sort((a: any, b: any) => (a.sortOrder || 0) - (b.sortOrder || 0));
  return {
    keywordField: item.keywordField || "商品名称",
    detailKeyword: item.detailKeyword || "",
    keywordMatchType: item.keywordMatchType === "包含" ? "包含" : "等于",
    splits: sortedSplits?.length
      ? sortedSplits.map((split: any) => ({
          splitRatio: formatPercent(split.splitRatio || "100"),
          incomeType: "捐赠收入",
          incomeAttr: split.incomeAttr || "",
          incomeDept: split.incomeDept || "",
          budgetCode: split.budgetCode || "",
          incomeProject: split.incomeProject || "",
          platformProjectName: split.platformProjectName || "",
          platformProjectDetail: split.platformProjectDetail || "",
          managementFeeRatio: formatPercent(split.managementFeeRatio),
          expenseFundSource: split.expenseFundSource || "",
        }))
      : [{ ...createEmptySplit(), splitRatio: "100" }],
  };
}

type SplitSettingsSectionProps = {
  splits: SplitForm[];
  splitErrors?: Record<number, string[]>;
  ratioTotal: number;
  projectTree: any[];
  deptTree: any[];
  budgetCodeTree: any[];
  fundraisingPlatformTree: any[];
  donationActivityTree: any[];
  projectTreeLoading: boolean;
  budgetCodeTreeLoading: boolean;
  fundraisingPlatformTreeLoading: boolean;
  donationActivityTreeLoading: boolean;
  onAddSplit: () => void;
  onRemoveSplit: (splitIdx: number) => void;
  onUpdateSplit: (splitIdx: number, field: keyof SplitForm, value: string) => void;
  onBudgetCodeChange: (splitIdx: number, value: string, autoProject: string | null) => void;
  onNCProjectChange: (splitIdx: number, value: string) => void;
  onDonationActivityChange: (splitIdx: number, activityName: string) => void;
};

const SplitSettingsSection = memo(function SplitSettingsSection({
  splits,
  splitErrors,
  ratioTotal,
  projectTree,
  deptTree,
  budgetCodeTree,
  fundraisingPlatformTree,
  donationActivityTree,
  projectTreeLoading,
  budgetCodeTreeLoading,
  fundraisingPlatformTreeLoading,
  donationActivityTreeLoading,
  onAddSplit,
  onRemoveSplit,
  onUpdateSplit,
  onBudgetCodeChange,
  onNCProjectChange,
  onDonationActivityChange,
}: SplitSettingsSectionProps) {
  const hasSplitFieldError = (splitIdx: number, field: string) => splitErrors?.[splitIdx]?.includes(field);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-gray-700">分账设置</span>
          <span className="text-sm ml-3">
            比例总和:{" "}
            <span className={ratioTotal === 100 ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>
              {Math.round(ratioTotal)}%
            </span>
            {ratioTotal !== 100 && <span className="text-xs text-red-500 ml-2">（必须=100%）</span>}
          </span>
        </div>
      </div>

      {splits.map((split, sIdx) => (
        <Card key={sIdx} className="bg-gray-50/50">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500">分账 {sIdx + 1}</span>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-500 h-6 px-1"
                onClick={() => onRemoveSplit(sIdx)}
                disabled={splits.length <= 1}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
              <div className="space-y-1">
                <Label className="text-[11px]">分账比例 % <span className="text-red-500">*</span></Label>
                <Input
                  className={`h-9 text-sm ${hasSplitFieldError(sIdx, "splitRatio") ? "border-red-500" : ""}`}
                  value={split.splitRatio}
                  onChange={(event) => onUpdateSplit(sIdx, "splitRatio", event.target.value.replace(/\D/g, ""))}
                  placeholder="如：100"
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">捐赠来源</Label>
                <Input className="h-9 text-sm bg-gray-50 text-gray-600" value={fixedDetailDonationSource} readOnly />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">收入属性 <span className="text-red-500">*</span></Label>
                <Select value={split.incomeAttr} onValueChange={(value) => onUpdateSplit(sIdx, "incomeAttr", value)}>
                  <SelectTrigger className={`w-full h-9 text-sm ${hasSplitFieldError(sIdx, "incomeAttr") ? "border-red-500" : ""}`}>
                    <SelectValue placeholder="选择" />
                  </SelectTrigger>
                  <SelectContent>
                    {incomeAttrOptions.map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">收入部门 <span className="text-red-500">*</span></Label>
                <DeptTreeSelect
                  value={split.incomeDept}
                  tree={deptTree}
                  onChange={(value) => onUpdateSplit(sIdx, "incomeDept", value)}
                  placeholder="请选择部门"
                  hasError={hasSplitFieldError(sIdx, "incomeDept")}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">预算编码 <span className="text-red-500">*</span></Label>
                <BudgetCodeSelect
                  value={split.budgetCode}
                  tree={budgetCodeTree}
                  incomeDept={split.incomeDept}
                  onChange={(value, autoProject) => onBudgetCodeChange(sIdx, value, autoProject)}
                  placeholder="请选择预算编码"
                  disabled={budgetCodeTreeLoading}
                  hasError={hasSplitFieldError(sIdx, "budgetCode")}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">NC项目名称 <span className="text-red-500">*</span></Label>
                <NCProjectSelect
                  value={split.incomeProject}
                  tree={projectTree}
                  budgetCodeTree={budgetCodeTree}
                  budgetCodeValue={split.budgetCode}
                  onChange={(value) => onNCProjectChange(sIdx, value)}
                  placeholder="请选择NC项目名称"
                  disabled={projectTreeLoading}
                  hasError={hasSplitFieldError(sIdx, "incomeProject")}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">平台项目名称 <span className="text-red-500">*</span></Label>
                <PlatformProjectSelect
                  value={split.platformProjectName}
                  tree={projectTree}
                  budgetCodeTree={budgetCodeTree}
                  ncProjectValue={split.incomeProject}
                  budgetCodeValue={split.budgetCode}
                  onChange={(value) => onUpdateSplit(sIdx, "platformProjectName", value)}
                  placeholder="请选择平台项目名称"
                  disabled={projectTreeLoading}
                  hasError={hasSplitFieldError(sIdx, "platformProjectName")}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">平台项目详情 <span className="text-red-500">*</span></Label>
                <PlatformProjectDetailSelect
                  value={split.platformProjectDetail}
                  tree={fundraisingPlatformTree}
                  platformProjectValue={split.platformProjectName}
                  onChange={(value) => onUpdateSplit(sIdx, "platformProjectDetail", value)}
                  placeholder="请选择平台项目详情"
                  disabled={fundraisingPlatformTreeLoading}
                  hasError={hasSplitFieldError(sIdx, "platformProjectDetail")}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">支出资金来源（选择捐赠活动自动生成） <span className="text-red-500">*</span></Label>
                <DonationActivitySelect
                  value={split.expenseFundSource}
                  tree={donationActivityTree}
                  onChange={(activityName) => onDonationActivityChange(sIdx, activityName)}
                  placeholder="请选择捐赠活动"
                  disabled={donationActivityTreeLoading}
                  hasError={hasSplitFieldError(sIdx, "expenseFundSource")}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">管理费比例% <span className="text-red-500">*</span></Label>
                <Input
                  className={`h-9 text-sm ${hasSplitFieldError(sIdx, "managementFeeRatio") ? "border-red-500" : ""}`}
                  value={split.managementFeeRatio}
                  onChange={(event) => onUpdateSplit(sIdx, "managementFeeRatio", event.target.value.replace(/\D/g, ""))}
                  placeholder="9"
                  inputMode="numeric"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
      <div className="pt-1">
        <Button size="sm" variant="outline" className="w-full border-dashed" onClick={onAddSplit}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          添加分账
        </Button>
      </div>
    </div>
  );
});

export default function RuleItemEditPage() {
  const navigate = useNavigate();
  const { ruleId: ruleIdParam, itemId: itemIdParam } = useParams<{ ruleId: string; itemId: string }>();
  const ruleId = parseInt(ruleIdParam || "0", 10);
  const itemId = parseInt(itemIdParam || "0", 10);
  const utils = trpc.useUtils();

  const ruleQuery = trpc.rule.getById.useQuery(
    { id: ruleId },
    { enabled: ruleId > 0 }
  );
  const projectTreeQuery = trpc.project.tree.useQuery();
  const deptTreeQuery = trpc.department.tree.useQuery();
  const budgetCodeTreeQuery = trpc.budgetCode.tree.useQuery();
  const fundraisingPlatformTreeQuery = trpc.fundraisingPlatform.tree.useQuery();
  const donationActivityTreeQuery = trpc.donationActivity.tree.useQuery();

  const rule = ruleQuery.data;
  const targetItem = useMemo(
    () => rule?.items?.find((item: any) => Number(item.id) === itemId),
    [itemId, rule?.items],
  );
  const targetIndex = useMemo(
    () => rule?.items?.findIndex((item: any) => Number(item.id) === itemId) ?? -1,
    [itemId, rule?.items],
  );
  const [conditionDraft, setConditionDraft] = useState<ConditionForm | null>(null);
  const [conditionErrors, setConditionErrors] = useState<ConditionErrors>({});

  useEffect(() => {
    if (targetItem) setConditionDraft(toConditionForm(targetItem));
  }, [targetItem]);

  const updateItem = trpc.rule.updateItem.useMutation({
    onSuccess: async () => {
      toast.success("条件已更新");
      await utils.rule.getById.invalidate({ id: ruleId });
      await utils.rule.list.invalidate();
      navigate(`/rules/${ruleId}`);
    },
    onError: (err: any) => toast.error(err.message || "更新失败"),
  });

  const clearConditionFieldError = useCallback((field: string) => {
    setConditionErrors((prev) => {
      if (!prev.fields?.includes(field)) return prev;
      const fields = prev.fields.filter((item) => item !== field);
      return { ...prev, fields: fields.length > 0 ? fields : undefined };
    });
  }, []);

  const clearSplitFieldError = useCallback((splitIdx: number, field: string) => {
    setConditionErrors((prev) => {
      if (!prev.splitErrors?.[splitIdx]?.includes(field)) return prev;
      const splitErrors = { ...prev.splitErrors };
      splitErrors[splitIdx] = splitErrors[splitIdx].filter((item) => item !== field);
      if (splitErrors[splitIdx].length === 0) delete splitErrors[splitIdx];
      return { ...prev, splitErrors: Object.keys(splitErrors).length > 0 ? splitErrors : undefined };
    });
  }, []);

  const updateCondition = useCallback((field: keyof Omit<ConditionForm, "splits">, value: string) => {
    setConditionDraft((prev) => prev ? { ...prev, [field]: value } : prev);
    clearConditionFieldError(field);
  }, [clearConditionFieldError]);

  const updateSplit = useCallback((splitIdx: number, field: keyof SplitForm, value: string) => {
    setConditionDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        splits: prev.splits.map((split, idx) => {
          if (idx !== splitIdx) return split;
          const next = { ...split, [field]: value };
          if (field === "incomeDept") {
            next.budgetCode = "";
            next.incomeProject = "";
            next.platformProjectName = "";
            next.platformProjectDetail = "";
            next.expenseFundSource = "";
          }
          if (field === "incomeAttr" || field === "platformProjectName") next.expenseFundSource = "";
          if (field === "platformProjectName") next.platformProjectDetail = "";
          return next;
        }),
      };
    });
    clearSplitFieldError(splitIdx, field);
  }, [clearSplitFieldError]);

  const handleBudgetCodeChange = useCallback((splitIdx: number, value: string, autoProject: string | null) => {
    setConditionDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        splits: prev.splits.map((split, idx) => {
          if (idx !== splitIdx) return split;
          return {
            ...split,
            budgetCode: value,
            incomeProject: autoProject && /^PM/.test(autoProject) ? autoProject : split.incomeProject,
            platformProjectName: "",
            platformProjectDetail: "",
            expenseFundSource: "",
          };
        }),
      };
    });
    clearSplitFieldError(splitIdx, "budgetCode");
    clearSplitFieldError(splitIdx, "incomeProject");
    clearSplitFieldError(splitIdx, "platformProjectName");
    clearSplitFieldError(splitIdx, "platformProjectDetail");
    clearSplitFieldError(splitIdx, "expenseFundSource");
  }, [clearSplitFieldError]);

  const handleNCProjectChange = useCallback((splitIdx: number, value: string) => {
    setConditionDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        splits: prev.splits.map((split, idx) => idx === splitIdx
          ? { ...split, incomeProject: value, platformProjectName: "", platformProjectDetail: "" }
          : split),
      };
    });
    clearSplitFieldError(splitIdx, "incomeProject");
    clearSplitFieldError(splitIdx, "platformProjectName");
    clearSplitFieldError(splitIdx, "platformProjectDetail");
  }, [clearSplitFieldError]);

  const handleDonationActivityChange = useCallback((splitIdx: number, activityName: string) => {
    setConditionDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        splits: prev.splits.map((split, idx) => {
          if (idx !== splitIdx) return split;
          const prefix = split.incomeAttr === "限定性收入" ? "限定性" : "非限定性";
          const budgetName = split.budgetCode ? split.budgetCode.split("-").slice(1).join("-") || split.budgetCode : "";
          const projectName = split.platformProjectName ? getProjectNameForFundSource(split.platformProjectName) : "";
          return { ...split, expenseFundSource: [prefix, budgetName, projectName, activityName].filter(Boolean).join("_") };
        }),
      };
    });
    clearSplitFieldError(splitIdx, "expenseFundSource");
  }, [clearSplitFieldError]);

  const addSplit = useCallback(() => {
    setConditionDraft((prev) => prev ? { ...prev, splits: [...prev.splits, createEmptySplit()] } : prev);
  }, []);

  const removeSplit = useCallback((splitIdx: number) => {
    setConditionDraft((prev) => {
      if (!prev || prev.splits.length <= 1) return prev;
      return { ...prev, splits: prev.splits.filter((_, idx) => idx !== splitIdx) };
    });
  }, []);

  const ratioTotal = useMemo(
    () => (conditionDraft?.splits || []).reduce((sum, split) => sum + (parseInt(split.splitRatio || "0", 10) || 0), 0),
    [conditionDraft?.splits],
  );

  const hasConditionFieldError = (field: string) => conditionErrors.fields?.includes(field);
  const hasConditionError = () => Boolean(conditionErrors.fields?.length || Object.keys(conditionErrors.splitErrors || {}).length > 0);

  const handleSaveCondition = () => {
    if (!conditionDraft || !targetItem) return;
    const errors: ConditionErrors = {};
    const fields: string[] = [];
    if (!conditionDraft.keywordField.trim()) fields.push("keywordField");
    if (!conditionDraft.detailKeyword.trim()) fields.push("detailKeyword");
    if (fields.length > 0) errors.fields = fields;

    const splitErrors: Record<number, string[]> = {};
    conditionDraft.splits.forEach((split, idx) => {
      const current: string[] = [];
      if (!split.splitRatio.trim()) current.push("splitRatio");
      if (!split.incomeAttr) current.push("incomeAttr");
      if (!split.incomeDept) current.push("incomeDept");
      if (!split.budgetCode) current.push("budgetCode");
      if (!split.incomeProject) current.push("incomeProject");
      if (!split.platformProjectName) current.push("platformProjectName");
      if (!split.platformProjectDetail) current.push("platformProjectDetail");
      if (!split.managementFeeRatio.trim()) current.push("managementFeeRatio");
      if (!split.expenseFundSource) current.push("expenseFundSource");
      if (current.length > 0) splitErrors[idx] = current;
    });
    if (Object.keys(splitErrors).length > 0) errors.splitErrors = splitErrors;

    const ratio = ratioTotal;
    setConditionErrors(errors);
    if (fields.length > 0 || Object.keys(splitErrors).length > 0) {
      return toast.error("请检查标红的必填项");
    }
    if (ratio !== 100) return toast.error(`分账比例之和必须等于100%，当前为${ratio}%`);

    updateItem.mutate({
      ruleId,
      itemId,
      item: {
        keywordField: conditionDraft.keywordField,
        detailKeyword: conditionDraft.detailKeyword,
        keywordMatchType: conditionDraft.keywordMatchType,
        splits: conditionDraft.splits.map((split, idx) => ({
          splitRatio: formatPercent(split.splitRatio),
          incomeType: "捐赠收入" as any,
          incomeAttr: split.incomeAttr as any,
          incomeDept: split.incomeDept,
          budgetCode: split.budgetCode,
          incomeProject: split.incomeProject,
          platformProjectName: split.platformProjectName,
          platformProjectDetail: split.platformProjectDetail,
          managementFeeRatio: formatPercent(split.managementFeeRatio),
          expenseFundSource: split.expenseFundSource,
          sortOrder: idx,
        })),
      },
    });
  };

  if (ruleQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" onClick={() => navigate(`/rules/${ruleId}`)}>
          <ArrowLeft className="h-4 w-4 mr-1" />返回
        </Button>
        <div className="text-gray-500 py-8">加载中...</div>
      </div>
    );
  }

  if (!targetItem) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" onClick={() => navigate(`/rules/${ruleId}`)}>
          <ArrowLeft className="h-4 w-4 mr-1" />返回
        </Button>
        <div className="text-red-500 py-8">规则条件不存在</div>
      </div>
    );
  }

  if (!conditionDraft) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" onClick={() => navigate(`/rules/${ruleId}`)}>
          <ArrowLeft className="h-4 w-4 mr-1" />返回
        </Button>
        <div className="text-gray-500 py-8">加载中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate(`/rules/${ruleId}`)}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            返回
          </Button>
          <h1 className="text-xl font-semibold">编辑条件 {targetIndex + 1}</h1>
        </div>
        <Button onClick={handleSaveCondition} disabled={updateItem.isPending}>
          <Save className="h-4 w-4 mr-1" />
          {updateItem.isPending ? "保存中..." : "保存条件"}
        </Button>
      </div>

      <Card className={`bg-slate-50 ${hasConditionError() || ratioTotal !== 100 ? "border-red-300 shadow-sm shadow-red-100" : "border-slate-200"}`}>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm text-gray-700">
              条件 {targetIndex + 1}：{rule?.ruleName || "明细认账规则"}
            </h4>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">认账关键字字段 <span className="text-red-500">*</span></Label>
              <Input
                className={`h-8 text-sm ${hasConditionFieldError("keywordField") ? "border-red-500" : ""}`}
                value={conditionDraft.keywordField}
                onChange={(event) => updateCondition("keywordField", event.target.value)}
                placeholder="如：商品名称"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">匹配方式 <span className="text-red-500">*</span></Label>
              <select
                className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={conditionDraft.keywordMatchType}
                onChange={(event) => updateCondition("keywordMatchType", event.target.value as "等于" | "包含")}
              >
                <option value="等于">等于</option>
                <option value="包含">包含</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">关键字 <span className="text-red-500">*</span></Label>
              <Input
                className={`h-8 text-sm ${hasConditionFieldError("detailKeyword") ? "border-red-500" : ""}`}
                value={conditionDraft.detailKeyword}
                onChange={(event) => updateCondition("detailKeyword", event.target.value)}
                placeholder="如：梭梭"
              />
            </div>
          </div>

          <Separator />

          <SplitSettingsSection
            splits={conditionDraft.splits}
            splitErrors={conditionErrors.splitErrors}
            ratioTotal={ratioTotal}
            projectTree={projectTreeQuery.data || EMPTY_TREE}
            deptTree={deptTreeQuery.data || EMPTY_TREE}
            budgetCodeTree={budgetCodeTreeQuery.data || EMPTY_TREE}
            fundraisingPlatformTree={fundraisingPlatformTreeQuery.data || EMPTY_TREE}
            donationActivityTree={donationActivityTreeQuery.data || EMPTY_TREE}
            projectTreeLoading={projectTreeQuery.isLoading}
            budgetCodeTreeLoading={budgetCodeTreeQuery.isLoading}
            fundraisingPlatformTreeLoading={fundraisingPlatformTreeQuery.isLoading}
            donationActivityTreeLoading={donationActivityTreeQuery.isLoading}
            onAddSplit={addSplit}
            onRemoveSplit={removeSplit}
            onUpdateSplit={updateSplit}
            onBudgetCodeChange={handleBudgetCodeChange}
            onNCProjectChange={handleNCProjectChange}
            onDonationActivityChange={handleDonationActivityChange}
          />
        </CardContent>
      </Card>
    </div>
  );
}
