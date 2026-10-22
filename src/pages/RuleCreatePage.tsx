import { memo, useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Plus, Trash2, ArrowLeft, Save } from "lucide-react";
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

function formatManagementFeeRatio(value: unknown) {
  const parsed = parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : "0";
}

function formatSplitRatio(value: unknown) {
  const parsed = parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : "0";
}

function getProjectNameForFundSource(value: string) {
  const projectPart = value.includes(" / ") ? value.split(" / ").pop() || value : value;
  const parts = projectPart.split("_");
  return parts.length > 1 ? parts.slice(1).join("_") : projectPart;
}

function getNormalizedKeyword(value: string) {
  return value.trim().toLocaleLowerCase();
}

interface ConditionForm {
  id?: number;
  keywordField: string;
  detailKeyword: string;
  keywordMatchType: "等于" | "包含";
  splits: SplitForm[];
  isSaved?: boolean;
}

interface ExcludeConditionForm {
  field: string;
  matchType: "等于" | "包含";
  keyword: string;
}

interface RuleDraft {
  ruleName: string;
  matchedCounterpartyAlias: string;
  dateField: string;
  incomeField: string;
  orderNoField: string;
  invoiceOtherOrderNo1Field: string;
  invoiceOtherOrderNo2Field: string;
  conditionRecognitionEnabled: boolean;
  excludeOrderEnabled: boolean;
  excludeConditions?: ExcludeConditionForm[];
  excludeOrderField: string;
  excludeOrderKeyword: string;
  refundOrderEnabled: boolean;
  refundJudgeField: string;
  refundJudgeValue: string;
  refundDirectionJudgeValue: string;
  refundAmountField: string;
  detailSplitEnabled: boolean;
  multiSplitKeywordField: string;
  multiSplitKeyword: string;
  multiSplitMatchField: string;
  detailSplitRecognitionKeywordField: string;
  detailSplitIncomeField: string;
  detailSplitMatchField: string;
  detailSplitOrderNoField: string;
  enabledAt: string;
  conditions: ConditionForm[];
  updatedAt: number;
}

const incomeAttrOptions = ["非限定性收入", "限定性收入"];
const fixedDetailDonationSource = "互联网募捐平台";
const emptyTree: any[] = [];
const defaultDetailSplitRecognitionKeywordField = "商品标题";
const defaultDetailSplitIncomeField = "买家实付金额";
const defaultDetailSplitMatchField = "主订单编号";
const defaultDetailSplitOrderNoField = "子订单编号";

function getExcludeConditionForms(source?: {
  excludeConditions?: Array<{
    field?: string | null;
    fieldName?: string | null;
    matchType?: string | null;
    keyword?: string | null;
  }> | null;
  excludeOrderField?: string | null;
  excludeOrderKeyword?: string | null;
} | null): ExcludeConditionForm[] {
  const configured = (source?.excludeConditions || []).map((condition) => ({
    field: condition.field || condition.fieldName || "",
    matchType: condition.matchType === "包含" ? "包含" as const : "等于" as const,
    keyword: condition.keyword || "",
  }));
  if (configured.length > 0) return configured;
  return [{
    field: source?.excludeOrderField || "",
    matchType: "等于",
    keyword: source?.excludeOrderKeyword || "",
  }];
}

function normalizeRefundJudgeValue(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^[`'"]+/, "")
    .replace(/[`'"]+$/, "")
    .trim();
}

function getCondRatio(cond: ConditionForm) {
  return cond.splits.reduce((sum, s) => sum + (parseInt(s.splitRatio || "0", 10) || 0), 0);
}

const defaultConditions: ConditionForm[] = [
  {
    keywordField: "商品名称",
    detailKeyword: "",
    keywordMatchType: "等于",
    isSaved: false,
    splits: [
      {
        splitRatio: "100",
        incomeType: "捐赠收入",
        incomeAttr: "",
        incomeDept: "",
        budgetCode: "",
        incomeProject: "",
        platformProjectName: "",
        platformProjectDetail: "",
        managementFeeRatio: "5",
        expenseFundSource: "",
      },
    ],
  },
];

function cloneDefaultConditions() {
  return defaultConditions.map((cond) => ({
    ...cond,
    splits: cond.splits.map((split) => ({ ...split })),
  }));
}

type ConditionError = { fields?: string[]; splitErrors?: Record<number, string[]> };

interface RuleSplitCardProps {
  cIdx: number;
  sIdx: number;
  split: SplitForm;
  splitCount: number;
  splitErrors?: string[];
  deptTree: any[];
  budgetCodeTree: any[];
  budgetCodeLoading: boolean;
  projectTree: any[];
  projectLoading: boolean;
  fundraisingPlatformTree: any[];
  fundraisingPlatformLoading: boolean;
  donationActivityTree: any[];
  donationActivityLoading: boolean;
  onRemoveSplit: (condIdx: number, splitIdx: number) => void;
  onUpdateSplit: (condIdx: number, splitIdx: number, field: keyof SplitForm, value: string) => void;
  onBudgetCodeChange: (condIdx: number, splitIdx: number, val: string, autoProject: string | null) => void;
  onNCProjectChange: (condIdx: number, splitIdx: number, value: string) => void;
  onDonationActivityChange: (condIdx: number, splitIdx: number, activityName: string) => void;
}

const RuleSplitCard = memo(function RuleSplitCard({
  cIdx,
  sIdx,
  split,
  splitCount,
  splitErrors,
  deptTree,
  budgetCodeTree,
  budgetCodeLoading,
  projectTree,
  projectLoading,
  fundraisingPlatformTree,
  fundraisingPlatformLoading,
  donationActivityTree,
  donationActivityLoading,
  onRemoveSplit,
  onUpdateSplit,
  onBudgetCodeChange,
  onNCProjectChange,
  onDonationActivityChange,
}: RuleSplitCardProps) {
  const hasError = (field: string) => splitErrors?.includes(field);

  return (
    <Card className="bg-gray-50/50">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-500">分账 {sIdx + 1}</span>
          <Button
            size="sm"
            variant="ghost"
            className="text-red-500 h-6 px-1"
            onClick={() => onRemoveSplit(cIdx, sIdx)}
            disabled={splitCount <= 1}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
          <div className="space-y-1">
            <Label className="text-[11px]">分账比例 % <span className="text-red-500">*</span></Label>
            <Input
              className={`h-9 text-sm ${hasError("splitRatio") ? "border-red-500" : ""}`}
              value={split.splitRatio}
              onChange={(e) => onUpdateSplit(cIdx, sIdx, "splitRatio", e.target.value.replace(/\D/g, ""))}
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
            <Select value={split.incomeAttr} onValueChange={(v) => onUpdateSplit(cIdx, sIdx, "incomeAttr", v)}>
              <SelectTrigger className={`w-full h-9 text-sm ${hasError("incomeAttr") ? "border-red-500" : ""}`}>
                <SelectValue placeholder="选择" />
              </SelectTrigger>
              <SelectContent>
                {incomeAttrOptions.map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">收入部门 <span className="text-red-500">*</span></Label>
            <DeptTreeSelect
              value={split.incomeDept}
              tree={deptTree}
              onChange={(val) => onUpdateSplit(cIdx, sIdx, "incomeDept", val)}
              placeholder="请选择部门"
              hasError={hasError("incomeDept")}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">预算编码 <span className="text-red-500">*</span></Label>
            <BudgetCodeSelect
              value={split.budgetCode}
              tree={budgetCodeTree}
              incomeDept={split.incomeDept}
              onChange={(val, autoProject) => onBudgetCodeChange(cIdx, sIdx, val, autoProject)}
              placeholder="请选择预算编码"
              disabled={budgetCodeLoading}
              hasError={hasError("budgetCode")}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">NC项目名称 <span className="text-red-500">*</span></Label>
            <NCProjectSelect
              value={split.incomeProject}
              tree={projectTree}
              budgetCodeTree={budgetCodeTree}
              budgetCodeValue={split.budgetCode}
              onChange={(val) => onNCProjectChange(cIdx, sIdx, val)}
              placeholder="请选择NC项目名称"
              disabled={projectLoading}
              hasError={hasError("incomeProject")}
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
              onChange={(val) => onUpdateSplit(cIdx, sIdx, "platformProjectName", val)}
              placeholder="请选择平台项目名称"
              disabled={projectLoading}
              hasError={hasError("platformProjectName")}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">平台项目详情 <span className="text-red-500">*</span></Label>
            <PlatformProjectDetailSelect
              value={split.platformProjectDetail}
              tree={fundraisingPlatformTree}
              platformProjectValue={split.platformProjectName}
              onChange={(val) => onUpdateSplit(cIdx, sIdx, "platformProjectDetail", val)}
              placeholder="请选择平台项目详情"
              disabled={fundraisingPlatformLoading}
              hasError={hasError("platformProjectDetail")}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">支出资金来源（选择捐赠活动自动生成） <span className="text-red-500">*</span></Label>
            <DonationActivitySelect
              value={split.expenseFundSource}
              tree={donationActivityTree}
              onChange={(activityName) => onDonationActivityChange(cIdx, sIdx, activityName)}
              placeholder="请选择捐赠活动"
              disabled={donationActivityLoading}
              hasError={hasError("expenseFundSource")}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">管理费比例% <span className="text-red-500">*</span></Label>
            <Input
              className={`h-9 text-sm ${hasError("managementFeeRatio") ? "border-red-500" : ""}`}
              value={split.managementFeeRatio}
              onChange={(e) => onUpdateSplit(cIdx, sIdx, "managementFeeRatio", e.target.value.replace(/\D/g, ""))}
              placeholder="9"
              inputMode="numeric"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

interface RuleConditionCardProps {
  cIdx: number;
  cond: ConditionForm;
  conditionCount: number;
  conditionRecognitionEnabled: boolean;
  conditionError?: ConditionError;
  deptTree: any[];
  budgetCodeTree: any[];
  budgetCodeLoading: boolean;
  projectTree: any[];
  projectLoading: boolean;
  fundraisingPlatformTree: any[];
  fundraisingPlatformLoading: boolean;
  donationActivityTree: any[];
  donationActivityLoading: boolean;
  onRemoveCondition: (idx: number) => void;
  onUpdateCondition: (idx: number, field: keyof Omit<ConditionForm, "splits">, value: string) => void;
  onAddSplit: (condIdx: number) => void;
  onRemoveSplit: (condIdx: number, splitIdx: number) => void;
  onUpdateSplit: (condIdx: number, splitIdx: number, field: keyof SplitForm, value: string) => void;
  onBudgetCodeChange: (condIdx: number, splitIdx: number, val: string, autoProject: string | null) => void;
  onNCProjectChange: (condIdx: number, splitIdx: number, value: string) => void;
  onDonationActivityChange: (condIdx: number, splitIdx: number, activityName: string) => void;
}

const RuleConditionCard = memo(function RuleConditionCard({
  cIdx,
  cond,
  conditionCount,
  conditionRecognitionEnabled,
  conditionError,
  deptTree,
  budgetCodeTree,
  budgetCodeLoading,
  projectTree,
  projectLoading,
  fundraisingPlatformTree,
  fundraisingPlatformLoading,
  donationActivityTree,
  donationActivityLoading,
  onRemoveCondition,
  onUpdateCondition,
  onAddSplit,
  onRemoveSplit,
  onUpdateSplit,
  onBudgetCodeChange,
  onNCProjectChange,
  onDonationActivityChange,
}: RuleConditionCardProps) {
  const ratio = getCondRatio(cond);
  const ratioValid = Math.abs(ratio - 100) < 0.01;
  const hasCondError = Boolean(conditionError && Object.keys(conditionError).length > 0);
  const hasFieldError = (field: string) => conditionError?.fields?.includes(field);

  return (
    <Card className={`bg-slate-50 ${hasCondError || !ratioValid ? "border-red-300 shadow-sm shadow-red-100" : "border-slate-200"}`}>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-sm text-gray-700">
            {conditionRecognitionEnabled
              ? `条件 ${cIdx + 1}${cond.isSaved === false ? "（未保存）" : ""}`
              : "整包分账设置"}
          </h4>
          {conditionRecognitionEnabled && (
            <Button
              size="sm"
              variant="ghost"
              className="text-red-500 h-7 px-2"
              onClick={() => onRemoveCondition(cIdx)}
              disabled={conditionCount <= 1}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              删除条件
            </Button>
          )}
        </div>

        {conditionRecognitionEnabled && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">认账关键字字段 <span className="text-red-500">*</span></Label>
              <Input
                className={`h-8 text-sm ${hasFieldError("keywordField") ? "border-red-500" : ""}`}
                value={cond.keywordField}
                onChange={(e) => onUpdateCondition(cIdx, "keywordField", e.target.value)}
                placeholder="如：商品名称"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">匹配方式 <span className="text-red-500">*</span></Label>
              <select
                className="h-8 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={cond.keywordMatchType || "等于"}
                onChange={(e) => onUpdateCondition(cIdx, "keywordMatchType", e.target.value as "等于" | "包含")}
              >
                <option value="等于">等于</option>
                <option value="包含">包含</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">关键字 <span className="text-red-500">*</span></Label>
              <Input
                className={`h-8 text-sm ${hasFieldError("detailKeyword") ? "border-red-500" : ""}`}
                value={cond.detailKeyword}
                onChange={(e) => onUpdateCondition(cIdx, "detailKeyword", e.target.value)}
                placeholder="如：梭梭"
              />
            </div>
          </div>
        )}

        <Separator />

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-gray-700">分账设置</span>
              <span className="text-sm ml-3">
                比例总和:{" "}
                <span className={ratioValid ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>
                  {Math.round(ratio)}%
                </span>
                {!ratioValid && <span className="text-xs text-red-500 ml-2">（必须=100%）</span>}
              </span>
            </div>
          </div>

          {cond.splits.map((split, sIdx) => (
            <RuleSplitCard
              key={sIdx}
              cIdx={cIdx}
              sIdx={sIdx}
              split={split}
              splitCount={cond.splits.length}
              splitErrors={conditionError?.splitErrors?.[sIdx]}
              deptTree={deptTree}
              budgetCodeTree={budgetCodeTree}
              budgetCodeLoading={budgetCodeLoading}
              projectTree={projectTree}
              projectLoading={projectLoading}
              fundraisingPlatformTree={fundraisingPlatformTree}
              fundraisingPlatformLoading={fundraisingPlatformLoading}
              donationActivityTree={donationActivityTree}
              donationActivityLoading={donationActivityLoading}
              onRemoveSplit={onRemoveSplit}
              onUpdateSplit={onUpdateSplit}
              onBudgetCodeChange={onBudgetCodeChange}
              onNCProjectChange={onNCProjectChange}
              onDonationActivityChange={onDonationActivityChange}
            />
          ))}
          <div className="pt-1">
            <Button size="sm" variant="outline" className="w-full border-dashed" onClick={() => onAddSplit(cIdx)}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              添加分账
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
});

function readRuleDraft(key: string): RuleDraft | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.conditions)) return null;
    return parsed as RuleDraft;
  } catch {
    return null;
  }
}

function writeRuleDraft(key: string, draft: RuleDraft) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // 草稿只是兜底保护，写入失败不影响正常编辑和保存。
  }
}

function clearRuleDraft(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // 忽略浏览器存储异常。
  }
}

export default function RuleCreatePage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const editId = id ? parseInt(id, 10) : 0;
  const isEdit = editId > 0;
  const draftKey = useMemo(() => `finance-recon:rule-draft:${isEdit ? editId : "new"}`, [editId, isEdit]);
  const initialDraftRef = useRef<RuleDraft | null | undefined>(undefined);
  if (initialDraftRef.current === undefined) {
    initialDraftRef.current = readRuleDraft(draftKey);
  }
  const initialDraft = initialDraftRef.current;
  const hydratedRuleIdRef = useRef<number | null>(null);
  const conditionRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const pendingScrollConditionIndexRef = useRef<number | null>(null);
  const [isUsingDraft, setIsUsingDraft] = useState(Boolean(initialDraft));

  const [ruleName, setRuleName] = useState(initialDraft?.ruleName || "");
  const [matchedCounterpartyAlias, setMatchedCounterpartyAlias] = useState(initialDraft?.matchedCounterpartyAlias || "");
  const [dateField, setDateField] = useState(initialDraft?.dateField ?? "时间");
  const [incomeField, setIncomeField] = useState(initialDraft?.incomeField || "金额");
  const [orderNoField, setOrderNoField] = useState(initialDraft?.orderNoField ?? "订单号");
  const [invoiceOtherOrderNo1Field, setInvoiceOtherOrderNo1Field] = useState(initialDraft?.invoiceOtherOrderNo1Field || "");
  const [invoiceOtherOrderNo2Field, setInvoiceOtherOrderNo2Field] = useState(initialDraft?.invoiceOtherOrderNo2Field || "");
  const [conditionRecognitionEnabled, setConditionRecognitionEnabled] = useState(initialDraft?.conditionRecognitionEnabled ?? true);
  const [excludeOrderEnabled, setExcludeOrderEnabled] = useState(Boolean(
    initialDraft?.excludeOrderEnabled ||
    initialDraft?.excludeConditions?.some((condition) => condition.field || condition.keyword) ||
    initialDraft?.excludeOrderField ||
    initialDraft?.excludeOrderKeyword
  ));
  const [excludeOrderField, setExcludeOrderField] = useState(initialDraft?.excludeOrderField || "");
  const [excludeOrderKeyword, setExcludeOrderKeyword] = useState(initialDraft?.excludeOrderKeyword || "");
  const [excludeConditions, setExcludeConditions] = useState<ExcludeConditionForm[]>(
    getExcludeConditionForms(initialDraft),
  );
  const [refundOrderEnabled, setRefundOrderEnabled] = useState(Boolean(
    initialDraft?.refundOrderEnabled ||
    initialDraft?.refundJudgeField ||
    initialDraft?.refundJudgeValue ||
    initialDraft?.refundDirectionJudgeValue ||
    initialDraft?.refundAmountField
  ));
  const [refundJudgeField, setRefundJudgeField] = useState(initialDraft?.refundJudgeField || "");
  const [refundJudgeValue, setRefundJudgeValue] = useState(initialDraft?.refundJudgeValue || "");
  const [refundDirectionJudgeValue, setRefundDirectionJudgeValue] = useState(initialDraft?.refundDirectionJudgeValue || "");
  const [refundAmountField, setRefundAmountField] = useState(initialDraft?.refundAmountField || "");
  const [detailSplitEnabled, setDetailSplitEnabled] = useState(Boolean(
    initialDraft?.detailSplitEnabled ||
    initialDraft?.multiSplitKeywordField ||
    initialDraft?.multiSplitKeyword ||
    initialDraft?.multiSplitMatchField
  ));
  const [multiSplitKeywordField, setMultiSplitKeywordField] = useState(initialDraft?.multiSplitKeywordField || "");
  const [multiSplitKeyword, setMultiSplitKeyword] = useState(initialDraft?.multiSplitKeyword || "");
  const [multiSplitMatchField, setMultiSplitMatchField] = useState(initialDraft?.multiSplitMatchField || "");
  const [detailSplitRecognitionKeywordField, setDetailSplitRecognitionKeywordField] = useState(initialDraft?.detailSplitRecognitionKeywordField || defaultDetailSplitRecognitionKeywordField);
  const [detailSplitIncomeField, setDetailSplitIncomeField] = useState(initialDraft?.detailSplitIncomeField || defaultDetailSplitIncomeField);
  const [detailSplitMatchField, setDetailSplitMatchField] = useState(initialDraft?.detailSplitMatchField || defaultDetailSplitMatchField);
  const [detailSplitOrderNoField, setDetailSplitOrderNoField] = useState(initialDraft?.detailSplitOrderNoField || defaultDetailSplitOrderNoField);
  const [enabledAt, setEnabledAt] = useState(() => initialDraft?.enabledAt || new Date().toISOString().split("T")[0]);
  const [conditions, setConditions] = useState<ConditionForm[]>(initialDraft?.conditions || cloneDefaultConditions());
  const [draftReady, setDraftReady] = useState(!isEdit || Boolean(initialDraft));

  const markRuleDraftDirty = useCallback(() => {
    setIsUsingDraft(true);
  }, []);

  // 校验错误
  const [ruleNameError, setRuleNameError] = useState(false);
  const [matchedCounterpartyError, setMatchedCounterpartyError] = useState(false);
  const [multiSplitErrors, setMultiSplitErrors] = useState<string[]>([]);
  const [excludeOrderErrors, setExcludeOrderErrors] = useState<string[]>([]);
  const [refundOrderErrors, setRefundOrderErrors] = useState<string[]>([]);
  const [condErrors, setCondErrors] = useState<Record<number, { fields?: string[]; splitErrors?: Record<number, string[]> }>>({});

  // 弹窗
  const [successOpen, setSuccessOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorOpen, setErrorOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const utils = trpc.useUtils();

  const ruleQuery = trpc.rule.getById.useQuery(
    { id: editId },
    { enabled: isEdit, refetchOnMount: "always", refetchOnWindowFocus: false }
  );
  // 部门树（用于收入部门树形选择）
  const deptTreeQuery = trpc.department.tree.useQuery();
  const budgetCodeTreeQuery = trpc.budgetCode.tree.useQuery(undefined, {
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });
  const projectTreeQuery = trpc.project.tree.useQuery(undefined, {
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });
  const fundraisingPlatformTreeQuery = trpc.fundraisingPlatform.tree.useQuery(undefined, {
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });
  const donationActivityTreeQuery = trpc.donationActivity.tree.useQuery();
  const counterpartyQuery = trpc.counterparty.listRecorded.useQuery({ page: 1, pageSize: 500, recognitionType: "明细认账" });
  const matchedCounterpartyMissing = Boolean(
    matchedCounterpartyAlias &&
    counterpartyQuery.data &&
    !counterpartyQuery.data.items.some((item: any) => item.alias === matchedCounterpartyAlias)
  );
  const selectedCounterparty = counterpartyQuery.data?.items.find((item: any) => item.alias === matchedCounterpartyAlias);
  const selectedCounterpartyIsPackageDetail = selectedCounterparty?.detailPackageType === "打包明细";

  useEffect(() => {
    if (!isEdit) {
      hydratedRuleIdRef.current = null;
      setDraftReady(true);
      return;
    }
    if (initialDraftRef.current) {
      hydratedRuleIdRef.current = editId;
      setDraftReady(true);
      return;
    }
    if (hydratedRuleIdRef.current === editId) return;
    if (isEdit && ruleQuery.data) {
      const r = ruleQuery.data;
      hydratedRuleIdRef.current = editId;
      setRuleName(r.ruleName || "");
      setMatchedCounterpartyAlias(r.matchedCounterpartyAlias || "");
      setDateField(r.dateField ?? "时间");
      setIncomeField(r.incomeField || "金额");
      setOrderNoField(r.orderNoField ?? "订单号");
      setInvoiceOtherOrderNo1Field(r.invoiceOtherOrderNo1Field || "");
      setInvoiceOtherOrderNo2Field(r.invoiceOtherOrderNo2Field || "");
      setConditionRecognitionEnabled(r.conditionRecognitionEnabled !== false);
      const loadedExcludeConditions = getExcludeConditionForms(r);
      setExcludeOrderEnabled(Boolean(
        r.excludeOrderEnabled
        || loadedExcludeConditions.some((condition) => condition.field || condition.keyword),
      ));
      setExcludeOrderField(loadedExcludeConditions[0]?.field || "");
      setExcludeOrderKeyword(loadedExcludeConditions[0]?.keyword || "");
      setExcludeConditions(loadedExcludeConditions);
      setRefundOrderEnabled(Boolean(r.refundOrderEnabled || r.refundJudgeField || r.refundJudgeValue || r.refundDirectionJudgeValue || r.refundAmountField));
      setRefundJudgeField(r.refundJudgeField || "");
      setRefundJudgeValue(r.refundJudgeValue || "");
      setRefundDirectionJudgeValue(r.refundDirectionJudgeValue || "");
      setRefundAmountField(r.refundAmountField || "");
      setDetailSplitEnabled(Boolean(r.detailSplitEnabled || r.multiSplitKeywordField || r.multiSplitKeyword || r.multiSplitMatchField));
      setMultiSplitKeywordField(r.multiSplitKeywordField || "");
      setMultiSplitKeyword(r.multiSplitKeyword || "");
      setMultiSplitMatchField(r.multiSplitMatchField || "");
      setDetailSplitRecognitionKeywordField(r.detailSplitRecognitionKeywordField || defaultDetailSplitRecognitionKeywordField);
      setDetailSplitIncomeField(r.detailSplitIncomeField || defaultDetailSplitIncomeField);
      setDetailSplitMatchField(r.detailSplitMatchField || defaultDetailSplitMatchField);
      setDetailSplitOrderNoField(r.detailSplitOrderNoField || defaultDetailSplitOrderNoField);
      setEnabledAt(new Date(r.enabledAt).toISOString().split("T")[0]);
      if (r.items && r.items.length > 0) {
        setConditions(
          r.items.map((item: any) => ({
            id: Number(item.id),
            keywordField: item.keywordField || "商品名称",
            detailKeyword: item.detailKeyword || "",
            keywordMatchType: item.keywordMatchType === "包含" ? "包含" : "等于",
            isSaved: true,
            splits: (item.splits && item.splits.length > 0)
              ? item.splits.map((s: any) => ({
                  splitRatio: s.splitRatio || "100",
                  incomeType: "捐赠收入",
                  incomeAttr: s.incomeAttr || "",
                  incomeDept: s.incomeDept || "",
                  budgetCode: s.budgetCode || "",
                  incomeProject: s.incomeProject || "",
                  platformProjectName: s.platformProjectName || "",
                  platformProjectDetail: s.platformProjectDetail || "",
                  managementFeeRatio: formatManagementFeeRatio(s.managementFeeRatio),
                  expenseFundSource: s.expenseFundSource || "",
                }))
              : [
                  {
                    splitRatio: "100",
                    incomeType: "捐赠收入",
                    incomeAttr: "",
                    incomeDept: "",
                    budgetCode: "",
                    incomeProject: "",
                    platformProjectName: "",
                    platformProjectDetail: "",
                    managementFeeRatio: "5",
                    expenseFundSource: "",
                  },
                ],
          }))
        );
      }
      setDraftReady(true);
    }
  }, [editId, isEdit, ruleQuery.data]);

  useEffect(() => {
    if (!draftReady || !isUsingDraft) return;
    const timer = window.setTimeout(() => {
      writeRuleDraft(draftKey, {
        ruleName,
        matchedCounterpartyAlias,
        dateField,
        incomeField,
        orderNoField,
        invoiceOtherOrderNo1Field,
        invoiceOtherOrderNo2Field,
        conditionRecognitionEnabled,
        excludeOrderEnabled,
        excludeConditions,
        excludeOrderField,
        excludeOrderKeyword,
        refundOrderEnabled,
        refundJudgeField,
        refundJudgeValue,
        refundDirectionJudgeValue,
        refundAmountField,
        detailSplitEnabled,
        multiSplitKeywordField,
        multiSplitKeyword,
        multiSplitMatchField,
        detailSplitRecognitionKeywordField,
        detailSplitIncomeField,
        detailSplitMatchField,
        detailSplitOrderNoField,
        enabledAt,
        conditions,
        updatedAt: Date.now(),
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [conditionRecognitionEnabled, conditions, dateField, detailSplitEnabled, detailSplitIncomeField, detailSplitMatchField, detailSplitOrderNoField, detailSplitRecognitionKeywordField, draftKey, draftReady, enabledAt, excludeConditions, excludeOrderEnabled, excludeOrderField, excludeOrderKeyword, incomeField, invoiceOtherOrderNo1Field, invoiceOtherOrderNo2Field, isUsingDraft, matchedCounterpartyAlias, multiSplitKeyword, multiSplitKeywordField, multiSplitMatchField, orderNoField, refundAmountField, refundDirectionJudgeValue, refundJudgeField, refundJudgeValue, refundOrderEnabled, ruleName]);

  const createRule = trpc.rule.create.useMutation({
    onSuccess: () => {
      clearRuleDraft(draftKey);
      setIsUsingDraft(false);
      utils.rule.list.invalidate();
      utils.rule.getById.invalidate();
      setSuccessMsg("认账规则已成功创建");
      setSuccessOpen(true);
    },
    onError: (err) => {
      setErrorMsg(err.message || "保存失败");
      setErrorOpen(true);
    },
  });

  const handleClearDraft = () => {
    clearRuleDraft(draftKey);
    initialDraftRef.current = null;
    hydratedRuleIdRef.current = null;
    setIsUsingDraft(false);
    if (!isEdit) {
      setRuleName("");
      setMatchedCounterpartyAlias("");
      setDateField("时间");
      setIncomeField("金额");
      setOrderNoField("订单号");
      setInvoiceOtherOrderNo1Field("");
      setInvoiceOtherOrderNo2Field("");
      setConditionRecognitionEnabled(true);
      setExcludeOrderEnabled(false);
      setExcludeOrderField("");
      setExcludeOrderKeyword("");
      setExcludeConditions([{ field: "", matchType: "等于", keyword: "" }]);
      setRefundOrderEnabled(false);
      setRefundJudgeField("");
      setRefundJudgeValue("");
      setRefundDirectionJudgeValue("");
      setRefundAmountField("");
      setDetailSplitEnabled(false);
      setMultiSplitKeywordField("");
      setMultiSplitKeyword("");
      setMultiSplitMatchField("");
      setDetailSplitRecognitionKeywordField(defaultDetailSplitRecognitionKeywordField);
      setDetailSplitIncomeField(defaultDetailSplitIncomeField);
      setDetailSplitMatchField(defaultDetailSplitMatchField);
      setDetailSplitOrderNoField(defaultDetailSplitOrderNoField);
      setEnabledAt(new Date().toISOString().split("T")[0]);
      setConditions(cloneDefaultConditions());
      return;
    }
    if (ruleQuery.data) {
      const r = ruleQuery.data;
      setRuleName(r.ruleName || "");
      setMatchedCounterpartyAlias(r.matchedCounterpartyAlias || "");
      setDateField(r.dateField ?? "时间");
      setIncomeField(r.incomeField || "金额");
      setOrderNoField(r.orderNoField ?? "订单号");
      setInvoiceOtherOrderNo1Field(r.invoiceOtherOrderNo1Field || "");
      setInvoiceOtherOrderNo2Field(r.invoiceOtherOrderNo2Field || "");
      setConditionRecognitionEnabled(r.conditionRecognitionEnabled !== false);
      const loadedExcludeConditions = getExcludeConditionForms(r);
      setExcludeOrderEnabled(Boolean(
        r.excludeOrderEnabled
        || loadedExcludeConditions.some((condition) => condition.field || condition.keyword),
      ));
      setExcludeOrderField(loadedExcludeConditions[0]?.field || "");
      setExcludeOrderKeyword(loadedExcludeConditions[0]?.keyword || "");
      setExcludeConditions(loadedExcludeConditions);
      setRefundOrderEnabled(Boolean(r.refundOrderEnabled || r.refundJudgeField || r.refundJudgeValue || r.refundDirectionJudgeValue || r.refundAmountField));
      setRefundJudgeField(r.refundJudgeField || "");
      setRefundJudgeValue(r.refundJudgeValue || "");
      setRefundDirectionJudgeValue(r.refundDirectionJudgeValue || "");
      setRefundAmountField(r.refundAmountField || "");
      setDetailSplitEnabled(Boolean(r.detailSplitEnabled || r.multiSplitKeywordField || r.multiSplitKeyword || r.multiSplitMatchField));
      setMultiSplitKeywordField(r.multiSplitKeywordField || "");
      setMultiSplitKeyword(r.multiSplitKeyword || "");
      setMultiSplitMatchField(r.multiSplitMatchField || "");
      setDetailSplitRecognitionKeywordField(r.detailSplitRecognitionKeywordField || defaultDetailSplitRecognitionKeywordField);
      setDetailSplitIncomeField(r.detailSplitIncomeField || defaultDetailSplitIncomeField);
      setDetailSplitMatchField(r.detailSplitMatchField || defaultDetailSplitMatchField);
      setDetailSplitOrderNoField(r.detailSplitOrderNoField || defaultDetailSplitOrderNoField);
      setEnabledAt(new Date(r.enabledAt).toISOString().split("T")[0]);
      setConditions(
        r.items && r.items.length > 0
          ? r.items.map((item: any) => ({
              id: Number(item.id),
              keywordField: item.keywordField || "商品名称",
              detailKeyword: item.detailKeyword || "",
              keywordMatchType: item.keywordMatchType === "包含" ? "包含" : "等于",
              isSaved: true,
              splits: (item.splits && item.splits.length > 0)
                ? item.splits.map((s: any) => ({
                    splitRatio: s.splitRatio || "100",
                    incomeType: "捐赠收入",
                    incomeAttr: s.incomeAttr || "",
                    incomeDept: s.incomeDept || "",
                    budgetCode: s.budgetCode || "",
                    incomeProject: s.incomeProject || "",
                    platformProjectName: s.platformProjectName || "",
                    platformProjectDetail: s.platformProjectDetail || "",
                    managementFeeRatio: formatManagementFeeRatio(s.managementFeeRatio),
                    expenseFundSource: s.expenseFundSource || "",
                  }))
                : cloneDefaultConditions()[0].splits,
            }))
          : cloneDefaultConditions()
      );
      hydratedRuleIdRef.current = editId;
    } else {
      ruleQuery.refetch();
    }
  };

  const updateRule = trpc.rule.update.useMutation({
    onSuccess: () => {
      clearRuleDraft(draftKey);
      initialDraftRef.current = null;
      hydratedRuleIdRef.current = null;
      setIsUsingDraft(false);
      utils.rule.list.invalidate();
      utils.rule.getById.invalidate({ id: editId });
      setSuccessMsg("认账规则已成功更新");
      setSuccessOpen(true);
    },
    onError: (err) => {
      setErrorMsg(err.message || "更新失败");
      setErrorOpen(true);
    },
  });

  const clearCondFieldError = useCallback((condIdx: number, field: string) => {
    setCondErrors((prev) => {
      if (!prev[condIdx]?.fields?.includes(field)) return prev;
      const newErrors = { ...prev };
      newErrors[condIdx] = {
        ...newErrors[condIdx],
        fields: newErrors[condIdx].fields!.filter((f) => f !== field),
      };
      if (newErrors[condIdx].fields!.length === 0) {
        delete newErrors[condIdx].fields;
      }
      if (Object.keys(newErrors[condIdx] || {}).length === 0) {
        delete newErrors[condIdx];
      }
      return newErrors;
    });
  }, []);

  const clearSplitFieldError = useCallback((condIdx: number, splitIdx: number, field: string) => {
    setCondErrors((prev) => {
      if (!prev[condIdx]?.splitErrors?.[splitIdx]?.includes(field)) return prev;
      const newErrors = { ...prev };
      const se = { ...newErrors[condIdx].splitErrors! };
      se[splitIdx] = se[splitIdx].filter((f: string) => f !== field);
      if (se[splitIdx].length === 0) delete se[splitIdx];
      newErrors[condIdx] = { ...newErrors[condIdx], splitErrors: se };
      if (Object.keys(se).length === 0) {
        delete newErrors[condIdx].splitErrors;
      }
      if (Object.keys(newErrors[condIdx] || {}).length === 0) {
        delete newErrors[condIdx];
      }
      return newErrors;
    });
  }, []);

  const addCondition = useCallback(() => {
    markRuleDraftDirty();
    setConditions((prev) => {
      pendingScrollConditionIndexRef.current = prev.length;
      return [
        ...prev,
        {
          keywordField: "商品名称",
          detailKeyword: "",
          keywordMatchType: "等于",
          isSaved: false,
          splits: [
            {
              splitRatio: "100",
              incomeType: "捐赠收入",
              incomeAttr: "",
              incomeDept: "",
              budgetCode: "",
              incomeProject: "",
              platformProjectName: "",
              platformProjectDetail: "",
              managementFeeRatio: "5",
              expenseFundSource: "",
            },
          ],
        },
      ];
    });
  }, [markRuleDraftDirty]);

  useEffect(() => {
    const targetIndex = pendingScrollConditionIndexRef.current;
    if (targetIndex === null) return;

    const timer = window.setTimeout(() => {
      conditionRefs.current[targetIndex]?.scrollIntoView({ behavior: "smooth", block: "start" });
      pendingScrollConditionIndexRef.current = null;
    }, 0);

    return () => window.clearTimeout(timer);
  }, [conditions.length]);

  const removeCondition = useCallback((idx: number) => {
    markRuleDraftDirty();
    setConditions((prev) => prev.filter((_, i) => i !== idx));
    setCondErrors((prev) => {
      if (!prev[idx]) return prev;
      const newErrors = { ...prev };
      delete newErrors[idx];
      return newErrors;
    });
  }, [markRuleDraftDirty]);

  const updateCondition = useCallback((idx: number, field: keyof Omit<ConditionForm, "splits">, value: string) => {
    markRuleDraftDirty();
    setConditions((prev) =>
      prev.map((cond, i) =>
        i === idx ? { ...cond, [field]: value } : cond
      )
    );
    clearCondFieldError(idx, field);
  }, [clearCondFieldError, markRuleDraftDirty]);

  const addSplit = useCallback((condIdx: number) => {
    markRuleDraftDirty();
    setConditions((prev) =>
      prev.map((cond, idx) =>
        idx === condIdx
          ? {
              ...cond,
              splits: [
                ...cond.splits,
                {
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
                },
              ],
            }
          : cond
      )
    );
  }, [markRuleDraftDirty]);

  const removeSplit = useCallback((condIdx: number, splitIdx: number) => {
    markRuleDraftDirty();
    setConditions((prev) =>
      prev.map((cond, idx) =>
        idx === condIdx
          ? { ...cond, splits: cond.splits.filter((_, i) => i !== splitIdx) }
          : cond
      )
    );
  }, [markRuleDraftDirty]);

  const updateSplit = useCallback((condIdx: number, splitIdx: number, field: keyof SplitForm, value: string) => {
    markRuleDraftDirty();
    setConditions((prev) =>
      prev.map((cond, ci) => {
        if (ci !== condIdx) return cond;
        return {
          ...cond,
          splits: cond.splits.map((split, si) => {
            if (si !== splitIdx) return split;
            const next = { ...split, [field]: value };
            if (field === "incomeDept") {
              next.budgetCode = "";
              next.incomeProject = "";
              next.platformProjectName = "";
              next.platformProjectDetail = "";
              next.expenseFundSource = "";
            }
            if (field === "incomeAttr" || field === "platformProjectName") {
              next.expenseFundSource = "";
            }
            if (field === "platformProjectName") {
              next.platformProjectDetail = "";
            }
            return next;
          }),
        };
      })
    );
    clearSplitFieldError(condIdx, splitIdx, field);
  }, [clearSplitFieldError, markRuleDraftDirty]);

  const handleNCProjectChange = useCallback((condIdx: number, splitIdx: number, value: string) => {
    markRuleDraftDirty();
    setConditions((prev) =>
      prev.map((cond, ci) =>
        ci === condIdx
          ? {
              ...cond,
              splits: cond.splits.map((split, si) =>
                si === splitIdx
                  ? { ...split, incomeProject: value, platformProjectName: "", platformProjectDetail: "" }
                  : split
              ),
            }
          : cond
      )
    );
    clearSplitFieldError(condIdx, splitIdx, "incomeProject");
  }, [clearSplitFieldError, markRuleDraftDirty]);

  // 选择预算编码时，自动同步其 NC 项目，用户仍可手动改选
  const handleBudgetCodeChange = useCallback((condIdx: number, splitIdx: number, val: string, autoProject: string | null) => {
    markRuleDraftDirty();
    setConditions((prev) =>
      prev.map((cond, ci) => {
        if (ci !== condIdx) return cond;
        return {
          ...cond,
          splits: cond.splits.map((s, si) => {
            if (si !== splitIdx) return s;
            const next = { ...s, budgetCode: val, expenseFundSource: "" };
            if (autoProject && /^PM/.test(autoProject)) {
              next.incomeProject = autoProject;
              next.platformProjectName = "";
              next.platformProjectDetail = "";
            }
            return next;
          }),
        };
      })
    );
    clearSplitFieldError(condIdx, splitIdx, "budgetCode");
    clearSplitFieldError(condIdx, splitIdx, "incomeProject");
    clearSplitFieldError(condIdx, splitIdx, "platformProjectName");
    clearSplitFieldError(condIdx, splitIdx, "platformProjectDetail");
  }, [clearSplitFieldError, markRuleDraftDirty]);

  // 选择捐赠活动后，自动拼接支出资金来源
  const handleDonationActivityChange = useCallback((condIdx: number, splitIdx: number, activityName: string) => {
    markRuleDraftDirty();
    setConditions((prev) =>
      prev.map((cond, ci) => {
        if (ci !== condIdx) return cond;
        return {
          ...cond,
          splits: cond.splits.map((s, si) => {
            if (si !== splitIdx) return s;
            const prefix = s.incomeAttr === "限定性收入" ? "限定性" : "非限定性";
            let budgetName = "";
            if (s.budgetCode) {
              const parts = s.budgetCode.split("-");
              budgetName = parts.length > 1 ? parts.slice(1).join("-") : s.budgetCode;
            }
            const projectName = s.platformProjectName ? getProjectNameForFundSource(s.platformProjectName) : "";
            const parts = [prefix, budgetName, projectName, activityName].filter(Boolean);
            return { ...s, expenseFundSource: parts.join("_") };
          }),
        };
      })
    );
    clearSplitFieldError(condIdx, splitIdx, "expenseFundSource");
  }, [clearSplitFieldError, markRuleDraftDirty]);

  const allRatiosValid = (conditionRecognitionEnabled ? conditions : conditions.slice(0, 1))
    .every((c) => Math.abs(getCondRatio(c) - 100) < 0.01);

  const validate = (): { valid: boolean; message: string } => {
    let valid = true;
    const errors: Record<number, { fields?: string[]; splitErrors?: Record<number, string[]> }> = {};
    let hasRequiredMissing = false;
    const invalidRatioLabels: string[] = [];
    const keywordMap = new Map<string, number[]>();
    setMultiSplitErrors([]);
    setExcludeOrderErrors([]);

    if (!ruleName.trim()) {
      setRuleNameError(true);
      valid = false;
      hasRequiredMissing = true;
    } else {
      setRuleNameError(false);
    }

    if (!matchedCounterpartyAlias) {
      setMatchedCounterpartyError(true);
      valid = false;
      hasRequiredMissing = true;
    } else {
      setMatchedCounterpartyError(false);
    }

    const conditionsToValidate = conditionRecognitionEnabled ? conditions : conditions.slice(0, 1);
    conditionsToValidate.forEach((cond, cIdx) => {
      const fields: string[] = [];
      if (conditionRecognitionEnabled && !cond.keywordField.trim()) {
        fields.push("keywordField");
        hasRequiredMissing = true;
      }
      if (conditionRecognitionEnabled && !cond.detailKeyword.trim()) {
        fields.push("detailKeyword");
        hasRequiredMissing = true;
      } else if (conditionRecognitionEnabled) {
        const normalizedKey = `${getNormalizedKeyword(cond.keywordField)}|${getNormalizedKeyword(cond.detailKeyword)}`;
        keywordMap.set(normalizedKey, [...(keywordMap.get(normalizedKey) || []), cIdx]);
      }

      const splitErrs: Record<number, string[]> = {};
      let hasMissingSplitRatio = false;
      cond.splits.forEach((split, sIdx) => {
        const se: string[] = [];
        if (!split.splitRatio.trim()) {
          se.push("splitRatio");
          hasMissingSplitRatio = true;
        }
        if (!split.incomeAttr) se.push("incomeAttr");
        if (!split.incomeDept) se.push("incomeDept");
        if (!split.budgetCode) se.push("budgetCode");
        if (!split.incomeProject) se.push("incomeProject");
        if (!split.platformProjectName) se.push("platformProjectName");
        if (!split.platformProjectDetail) se.push("platformProjectDetail");
        if (!split.managementFeeRatio.trim()) se.push("managementFeeRatio");
        if (!split.expenseFundSource) se.push("expenseFundSource");
        if (se.length > 0) {
          splitErrs[sIdx] = se;
          hasRequiredMissing = true;
        }
      });

      const ratio = getCondRatio(cond);
      if (Math.abs(ratio - 100) > 0.01) {
        valid = false;
        if (!hasMissingSplitRatio) {
          invalidRatioLabels.push(`条件${cIdx + 1}当前为${Math.round(ratio)}%`);
        }
      }

      if (fields.length > 0 || Object.keys(splitErrs).length > 0) {
        errors[cIdx] = {};
        if (fields.length > 0) errors[cIdx].fields = fields;
        if (Object.keys(splitErrs).length > 0) errors[cIdx].splitErrors = splitErrs;
        valid = false;
      }
    });

    let hasDuplicateKeyword = false;
    if (conditionRecognitionEnabled) {
      keywordMap.forEach((indexes) => {
        if (indexes.length <= 1) return;
        hasDuplicateKeyword = true;
        indexes.forEach((idx) => {
          const fields = new Set(errors[idx]?.fields || []);
          fields.add("detailKeyword");
          errors[idx] = { ...errors[idx], fields: Array.from(fields) };
        });
      });
    }
    if (hasDuplicateKeyword) valid = false;

    setCondErrors(errors);
    if (!allRatiosValid) valid = false;

    if (hasDuplicateKeyword) {
      const duplicateLabels = Array.from(keywordMap.values())
        .filter((indexes) => indexes.length > 1)
        .map((indexes) => `条件${indexes.map((idx) => idx + 1).join("、")}`)
        .join("，");
      return { valid: false, message: `${duplicateLabels}的认账关键字字段和关键字相同，不能保存` };
    }

    const messages: string[] = [];
    if (hasRequiredMissing) messages.push("请检查标红的必填项");
    if (invalidRatioLabels.length > 0) messages.push(`分账比例之和必须等于100%（${invalidRatioLabels.join("，")}）`);
    const nextMultiSplitErrors: string[] = [];
    if (detailSplitEnabled) {
      if (!multiSplitKeywordField.trim()) nextMultiSplitErrors.push("multiSplitKeywordField");
      if (!multiSplitKeyword.trim()) nextMultiSplitErrors.push("multiSplitKeyword");
      if (!multiSplitMatchField.trim()) nextMultiSplitErrors.push("multiSplitMatchField");
      if (!detailSplitRecognitionKeywordField.trim()) nextMultiSplitErrors.push("detailSplitRecognitionKeywordField");
      if (!detailSplitIncomeField.trim()) nextMultiSplitErrors.push("detailSplitIncomeField");
      if (!detailSplitMatchField.trim()) nextMultiSplitErrors.push("detailSplitMatchField");
      if (!detailSplitOrderNoField.trim()) nextMultiSplitErrors.push("detailSplitOrderNoField");
    }
    if (nextMultiSplitErrors.length > 0) {
      valid = false;
      setMultiSplitErrors(nextMultiSplitErrors);
      messages.push("开启明细分账后，明细分账字段和分账包设置均为必填");
    }
    const nextExcludeOrderErrors: string[] = [];
    if (excludeOrderEnabled) {
      excludeConditions.forEach((condition, index) => {
        if (!condition.field.trim()) nextExcludeOrderErrors.push(`excludeCondition-${index}-field`);
        if (!condition.keyword.trim()) nextExcludeOrderErrors.push(`excludeCondition-${index}-keyword`);
      });
    }
    if (nextExcludeOrderErrors.length > 0) {
      valid = false;
      setExcludeOrderErrors(nextExcludeOrderErrors);
      messages.push("开启排除订单后，每组条件的识别字段和字段关键字均为必填");
    }
    const nextRefundOrderErrors: string[] = [];
    if (refundOrderEnabled) {
      if (!refundJudgeField.trim()) nextRefundOrderErrors.push("refundJudgeField");
      const normalizedJudgeValue = normalizeRefundJudgeValue(refundJudgeValue);
      const normalizedDirectionJudgeValue = normalizeRefundJudgeValue(refundDirectionJudgeValue);
      if (!normalizedJudgeValue) nextRefundOrderErrors.push("refundJudgeValue");
      if (normalizedDirectionJudgeValue && normalizedDirectionJudgeValue === normalizedJudgeValue) {
        nextRefundOrderErrors.push("refundJudgeValue", "refundDirectionJudgeValue");
      }
      if (!refundAmountField.trim()) nextRefundOrderErrors.push("refundAmountField");
    }
    if (nextRefundOrderErrors.length > 0) {
      valid = false;
      setRefundOrderErrors(nextRefundOrderErrors);
      messages.push("开启退款订单后，判断字段、退款订单字段值和退款金额字段均为必填；收支方向字段值不能与退款订单字段值相同");
    }

    return { valid, message: messages.join("；") || "表单校验未通过，请检查标红内容" };
  };

  const handleSubmit = () => {
    const result = validate();
    if (!result.valid) {
      setErrorMsg(result.message);
      setErrorOpen(true);
      return;
    }

    const sourceConditions = conditionRecognitionEnabled ? conditions : conditions.slice(0, 1);
    const payloadItems = sourceConditions.map((cond, i) => ({
      keywordField: conditionRecognitionEnabled ? cond.keywordField : "__整包认账__",
      detailKeyword: conditionRecognitionEnabled ? cond.detailKeyword : "__整包认账__",
      keywordMatchType: conditionRecognitionEnabled ? cond.keywordMatchType : "等于",
      splits: cond.splits.map((s, j) => ({
        splitRatio: formatSplitRatio(s.splitRatio),
        incomeType: "捐赠收入" as any,
        incomeAttr: s.incomeAttr as any,
        incomeDept: s.incomeDept,
        budgetCode: s.budgetCode,
        incomeProject: s.incomeProject,
        platformProjectName: s.platformProjectName,
        platformProjectDetail: s.platformProjectDetail,
        managementFeeRatio: formatManagementFeeRatio(s.managementFeeRatio),
        expenseFundSource: s.expenseFundSource,
        sortOrder: j,
      })),
      sortOrder: i,
    }));

    if (isEdit) {
      updateRule.mutate({
        id: editId,
        ruleName,
        matchedCounterpartyAlias,
        dateField,
        incomeField,
        orderNoField,
        invoiceOtherOrderNo1Field,
        invoiceOtherOrderNo2Field,
        conditionRecognitionEnabled,
        excludeOrderEnabled,
        excludeConditions: excludeOrderEnabled ? excludeConditions : [],
        excludeOrderField: excludeOrderEnabled ? excludeOrderField : "",
        excludeOrderKeyword: excludeOrderEnabled ? excludeOrderKeyword : "",
        refundOrderEnabled,
        refundJudgeField: refundOrderEnabled ? refundJudgeField : "",
        refundJudgeValue: refundOrderEnabled ? refundJudgeValue : "",
        refundDirectionJudgeValue: refundOrderEnabled ? refundDirectionJudgeValue : "",
        refundAmountField: refundOrderEnabled ? refundAmountField : "",
        detailSplitEnabled,
        multiSplitKeywordField: detailSplitEnabled ? multiSplitKeywordField : "",
        multiSplitKeyword: detailSplitEnabled ? multiSplitKeyword : "",
        multiSplitMatchField: detailSplitEnabled ? multiSplitMatchField : "",
        detailSplitRecognitionKeywordField: detailSplitRecognitionKeywordField || defaultDetailSplitRecognitionKeywordField,
        detailSplitIncomeField: detailSplitIncomeField || defaultDetailSplitIncomeField,
        detailSplitMatchField: detailSplitMatchField || defaultDetailSplitMatchField,
        detailSplitOrderNoField: detailSplitOrderNoField || defaultDetailSplitOrderNoField,
        enabledAt: new Date(enabledAt),
        items: payloadItems,
      });
    } else {
      createRule.mutate({
        ruleName,
        matchedCounterpartyAlias,
        dateField,
        incomeField,
        orderNoField,
        invoiceOtherOrderNo1Field,
        invoiceOtherOrderNo2Field,
        conditionRecognitionEnabled,
        excludeOrderEnabled,
        excludeConditions: excludeOrderEnabled ? excludeConditions : [],
        excludeOrderField: excludeOrderEnabled ? excludeOrderField : "",
        excludeOrderKeyword: excludeOrderEnabled ? excludeOrderKeyword : "",
        refundOrderEnabled,
        refundJudgeField: refundOrderEnabled ? refundJudgeField : "",
        refundJudgeValue: refundOrderEnabled ? refundJudgeValue : "",
        refundDirectionJudgeValue: refundOrderEnabled ? refundDirectionJudgeValue : "",
        refundAmountField: refundOrderEnabled ? refundAmountField : "",
        detailSplitEnabled,
        multiSplitKeywordField: detailSplitEnabled ? multiSplitKeywordField : "",
        multiSplitKeyword: detailSplitEnabled ? multiSplitKeyword : "",
        multiSplitMatchField: detailSplitEnabled ? multiSplitMatchField : "",
        detailSplitRecognitionKeywordField: detailSplitRecognitionKeywordField || defaultDetailSplitRecognitionKeywordField,
        detailSplitIncomeField: detailSplitIncomeField || defaultDetailSplitIncomeField,
        detailSplitMatchField: detailSplitMatchField || defaultDetailSplitMatchField,
        detailSplitOrderNoField: detailSplitOrderNoField || defaultDetailSplitOrderNoField,
        enabledAt: new Date(enabledAt),
        items: payloadItems,
      });
    }
  };

  const hasMultiSplitError = (field: string) => multiSplitErrors.includes(field);
  const hasExcludeOrderError = (field: string) => excludeOrderErrors.includes(field);
  const hasRefundOrderError = (field: string) => refundOrderErrors.includes(field);
  const updateExcludeCondition = (index: number, patch: Partial<ExcludeConditionForm>) => {
    const next = excludeConditions.map((condition, conditionIndex) => (
      conditionIndex === index ? { ...condition, ...patch } : condition
    ));
    markRuleDraftDirty();
    setExcludeConditions(next);
    if (index === 0) {
      if (patch.field !== undefined) {
        setExcludeOrderField(patch.field);
      }
      if (patch.keyword !== undefined) {
        setExcludeOrderKeyword(patch.keyword);
      }
    }
    setExcludeOrderErrors((prev) => prev.filter((field) => (
      !(patch.field?.trim() && field === `excludeCondition-${index}-field`)
      && !(patch.keyword?.trim() && field === `excludeCondition-${index}-keyword`)
    )));
  };
  const addExcludeCondition = () => {
    markRuleDraftDirty();
    setExcludeConditions((prev) => [...prev, { field: "", matchType: "等于", keyword: "" }]);
  };
  const removeExcludeCondition = (index: number) => {
    const remaining = excludeConditions.filter((_, conditionIndex) => conditionIndex !== index);
    const next = remaining.length > 0 ? remaining : [{ field: "", matchType: "等于" as const, keyword: "" }];
    markRuleDraftDirty();
    setExcludeConditions(next);
    setExcludeOrderField(next[0].field);
    setExcludeOrderKeyword(next[0].keyword);
    setExcludeOrderErrors([]);
  };
  const deptTree = deptTreeQuery.data ?? emptyTree;
  const budgetCodeTree = budgetCodeTreeQuery.data ?? emptyTree;
  const projectTree = projectTreeQuery.data ?? emptyTree;
  const fundraisingPlatformTree = fundraisingPlatformTreeQuery.data ?? emptyTree;
  const donationActivityTree = donationActivityTreeQuery.data ?? emptyTree;

  const conditionsEditor = useMemo(() => {
    const displayedConditions = (conditionRecognitionEnabled ? conditions : conditions.slice(0, 1))
      .map((cond, cIdx) => ({ cond, cIdx }));
    if (isEdit && conditionRecognitionEnabled) {
      displayedConditions.reverse();
    }

    return (
      <div className="space-y-4">
        {displayedConditions.map(({ cond, cIdx }) => (
          <div
            key={cIdx}
            ref={(node) => {
              conditionRefs.current[cIdx] = node;
            }}
          >
            <RuleConditionCard
              cIdx={cIdx}
              cond={cond}
              conditionCount={conditions.length}
              conditionRecognitionEnabled={conditionRecognitionEnabled}
              conditionError={condErrors[cIdx]}
              deptTree={deptTree}
              budgetCodeTree={budgetCodeTree}
              budgetCodeLoading={budgetCodeTreeQuery.isLoading}
              projectTree={projectTree}
              projectLoading={projectTreeQuery.isLoading}
              fundraisingPlatformTree={fundraisingPlatformTree}
              fundraisingPlatformLoading={fundraisingPlatformTreeQuery.isLoading}
              donationActivityTree={donationActivityTree}
              donationActivityLoading={donationActivityTreeQuery.isLoading}
              onRemoveCondition={removeCondition}
              onUpdateCondition={updateCondition}
              onAddSplit={addSplit}
              onRemoveSplit={removeSplit}
              onUpdateSplit={updateSplit}
              onBudgetCodeChange={handleBudgetCodeChange}
              onNCProjectChange={handleNCProjectChange}
              onDonationActivityChange={handleDonationActivityChange}
            />
          </div>
        ))}
      </div>
    );
  }, [
    addSplit,
    budgetCodeTree,
    budgetCodeTreeQuery.isLoading,
    condErrors,
    conditionRecognitionEnabled,
    conditions,
    deptTree,
    donationActivityTree,
    donationActivityTreeQuery.isLoading,
    fundraisingPlatformTree,
    fundraisingPlatformTreeQuery.isLoading,
    handleBudgetCodeChange,
    handleDonationActivityChange,
    handleNCProjectChange,
    isEdit,
    projectTree,
    projectTreeQuery.isLoading,
    removeCondition,
    removeSplit,
    updateCondition,
    updateSplit,
  ]);

  if (isEdit && ruleQuery.isLoading && !initialDraftRef.current) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" onClick={() => navigate("/rules")}>
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
          <Button variant="outline" size="sm" onClick={() => navigate("/rules")}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            返回
          </Button>
          <h1 className="text-xl font-semibold">{isEdit ? "编辑认账规则" : "新建认账规则"}</h1>
        </div>
        <Button onClick={handleSubmit} disabled={createRule.isPending || updateRule.isPending}>
          <Save className="h-4 w-4 mr-1" />
          {createRule.isPending || updateRule.isPending ? "保存中..." : "保存规则"}
        </Button>
      </div>

      {isUsingDraft && (
        <div className="flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 md:flex-row md:items-center md:justify-between">
          <div>
            当前显示的是未保存草稿，不是已保存的真实规则。保存后草稿会自动清除。
          </div>
          <Button size="sm" variant="outline" className="border-amber-300 bg-white hover:bg-amber-100" onClick={handleClearDraft}>
            清除草稿并加载当前规则
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="p-6 space-y-6">
          <h3 className="font-semibold text-sm text-gray-500 border-b pb-2">规则基本信息</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>规则名称 <span className="text-red-500">*</span></Label>
              <Input
                value={ruleName}
                onChange={(e) => { markRuleDraftDirty(); setRuleName(e.target.value); if (e.target.value.trim()) setRuleNameError(false); }}
                placeholder="输入规则名称"
                className={ruleNameError ? "border-red-500 focus-visible:ring-red-300" : ""}
              />
              {ruleNameError && <p className="text-xs text-red-500">规则名称不能为空</p>}
            </div>
            <div className="space-y-2">
              <Label>匹配到账信息 <span className="text-red-500">*</span></Label>
              <Select value={matchedCounterpartyAlias} onValueChange={(v) => { markRuleDraftDirty(); setMatchedCounterpartyAlias(v); setMatchedCounterpartyError(false); }}>
                <SelectTrigger className={`w-full ${matchedCounterpartyError ? "border-red-500 focus:ring-red-300" : ""}`}>
                  <SelectValue placeholder="选择到账别称" />
                </SelectTrigger>
                <SelectContent>
                  {matchedCounterpartyMissing && (
                    <SelectItem value={matchedCounterpartyAlias}>
                      {matchedCounterpartyAlias}（已变更或不可用）
                    </SelectItem>
                  )}
                  {counterpartyQuery.data?.items.map((item: any) => (
                    <SelectItem key={item.id} value={item.alias}>
                      {item.alias}（{item.detailPackageType || "T+1"}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {matchedCounterpartyError && <p className="text-xs text-red-500">匹配到账信息不能为空</p>}
              {matchedCounterpartyMissing && <p className="text-xs text-amber-600">原到账别称已变更或不可用，请重新选择当前到账信息。</p>}
            </div>
            <div className="space-y-2">
              <Label>启用时间</Label>
              <Input type="date" value={enabledAt} disabled className="bg-gray-50 text-gray-600" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>日期字段 {!selectedCounterpartyIsPackageDetail && <span className="text-red-500">*</span>}</Label>
              <Input value={dateField} onChange={(e) => { markRuleDraftDirty(); setDateField(e.target.value); }} placeholder="如：时间、日期" />
              <p className="text-[11px] text-gray-400">
                {selectedCounterpartyIsPackageDetail ? "打包明细主要使用匹配日期，可不填写订单明细日期列" : "识别订单明细文件中的日期列"}
              </p>
            </div>
            <div className="space-y-2">
              <Label>收入字段 <span className="text-red-500">*</span></Label>
              <Input value={incomeField} onChange={(e) => { markRuleDraftDirty(); setIncomeField(e.target.value); }} placeholder="如：金额、订单金额" />
              <p className="text-[11px] text-gray-400">识别订单明细文件中的金额列</p>
            </div>
            <div className="space-y-2">
              <Label>退款字段 {refundOrderEnabled && <span className="text-red-500">*</span>}</Label>
              <Input
                value={refundAmountField}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  markRuleDraftDirty();
                  setRefundAmountField(nextValue);
                  if (nextValue.trim()) setRefundOrderErrors((prev) => prev.filter((field) => field !== "refundAmountField"));
                }}
                placeholder="如：支出金额（-元）"
                className={refundOrderErrors.includes("refundAmountField") ? "border-red-500 focus-visible:ring-red-300" : ""}
              />
              {refundOrderErrors.includes("refundAmountField") && <p className="text-xs text-red-500">退款字段不能为空</p>}
              <p className="text-[11px] text-gray-400">直接退款命中后读取该列；收支方向值命中时，该列非0表示按退款处理</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>订单号字段 {!selectedCounterpartyIsPackageDetail && <span className="text-red-500">*</span>}</Label>
              <Input value={orderNoField} onChange={(e) => { markRuleDraftDirty(); setOrderNoField(e.target.value); }} placeholder="如：订单号、编号" />
              <p className="text-[11px] text-gray-400">
                {selectedCounterpartyIsPackageDetail ? "打包明细可不填写；日期字段和订单号字段都为空时，会保留明细原始信息便于追查" : "识别订单明细文件中的订单号列"}
              </p>
            </div>
            <div className="space-y-2">
              <Label>票据用其他单号1</Label>
              <Input
                value={invoiceOtherOrderNo1Field}
                maxLength={100}
                aria-label="票据用其他单号1"
                onChange={(e) => { markRuleDraftDirty(); setInvoiceOtherOrderNo1Field(e.target.value); }}
                placeholder="如：商户订单号"
              />
              <p className="text-[11px] text-gray-400">选填；填写订单明细中的原始列名</p>
            </div>
            <div className="space-y-2">
              <Label>票据用其他单号2</Label>
              <Input
                value={invoiceOtherOrderNo2Field}
                maxLength={100}
                aria-label="票据用其他单号2"
                onChange={(e) => { markRuleDraftDirty(); setInvoiceOtherOrderNo2Field(e.target.value); }}
                placeholder="如：业务流水号"
              />
              <p className="text-[11px] text-gray-400">选填；填写订单明细中的原始列名</p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-md border border-slate-200 p-4">
            <div>
              <Label>条件认账</Label>
              <p className="text-[11px] text-gray-400">关闭后不按关键字拆条件，整个订单包按下方分账设置一次入账</p>
            </div>
            <Switch
              checked={conditionRecognitionEnabled}
              onCheckedChange={(checked) => {
                markRuleDraftDirty();
                setConditionRecognitionEnabled(checked);
                if (!checked) {
                  setDetailSplitEnabled(false);
                  setMultiSplitKeywordField("");
                  setMultiSplitKeyword("");
                  setMultiSplitMatchField("");
                  setMultiSplitErrors([]);
                }
              }}
            />
          </div>
          <div className="space-y-4 rounded-md border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label>排除订单</Label>
                <p className="mt-1 text-[11px] text-gray-400">开启后，上传订单明细时命中任一排除条件的订单直接丢弃</p>
              </div>
              <Switch
                checked={excludeOrderEnabled}
                onCheckedChange={(checked) => {
                  markRuleDraftDirty();
                  setExcludeOrderEnabled(checked);
                  setExcludeOrderErrors([]);
                  if (!checked) {
                    setExcludeOrderField("");
                    setExcludeOrderKeyword("");
                    setExcludeConditions([{ field: "", matchType: "等于", keyword: "" }]);
                  }
                }}
              />
            </div>
            <div className="space-y-3">
              {excludeConditions.map((condition, conditionIndex) => (
                <div key={conditionIndex} className="space-y-3 rounded-md border border-slate-200 bg-slate-50/60 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-500">条件 {conditionIndex + 1}</span>
                    {excludeConditions.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-red-500 hover:bg-red-50 hover:text-red-600"
                        disabled={!excludeOrderEnabled}
                        aria-label={`删除排除条件 ${conditionIndex + 1}`}
                        onClick={() => removeExcludeCondition(conditionIndex)}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />删除
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>识别字段 {excludeOrderEnabled && <span className="text-red-500">*</span>}</Label>
                      <Input
                        value={condition.field}
                        disabled={!excludeOrderEnabled}
                        onChange={(e) => updateExcludeCondition(conditionIndex, { field: e.target.value })}
                        placeholder="如：订单状态、商品名称"
                        className={hasExcludeOrderError(`excludeCondition-${conditionIndex}-field`) ? "border-red-500 focus-visible:ring-red-300" : ""}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>匹配方式 {excludeOrderEnabled && <span className="text-red-500">*</span>}</Label>
                      <Select
                        value={condition.matchType}
                        disabled={!excludeOrderEnabled}
                        onValueChange={(value) => updateExcludeCondition(conditionIndex, { matchType: value === "包含" ? "包含" : "等于" })}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="等于">等于</SelectItem>
                          <SelectItem value="包含">包含</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>字段关键字 {excludeOrderEnabled && <span className="text-red-500">*</span>}</Label>
                      <Input
                        value={condition.keyword}
                        disabled={!excludeOrderEnabled}
                        onChange={(e) => updateExcludeCondition(conditionIndex, { keyword: e.target.value })}
                        placeholder="如：退款、已关闭"
                        className={hasExcludeOrderError(`excludeCondition-${conditionIndex}-keyword`) ? "border-red-500 focus-visible:ring-red-300" : ""}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full border-dashed"
              disabled={!excludeOrderEnabled}
              onClick={addExcludeCondition}
            >
              <Plus className="h-4 w-4 mr-1" />添加排除条件
            </Button>
          </div>
          <div className="space-y-4 rounded-md border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label>退款订单</Label>
                <p className="mt-1 text-[11px] text-gray-400">退款订单值直接判定退款；收支方向值命中后，根据收入字段和上方退款字段的非0金额确定方向</p>
              </div>
              <Switch
                checked={refundOrderEnabled}
                onCheckedChange={(checked) => {
                  markRuleDraftDirty();
                  setRefundOrderEnabled(checked);
                  setRefundOrderErrors([]);
                  if (!checked) {
                    setRefundJudgeField("");
                    setRefundJudgeValue("");
                    setRefundDirectionJudgeValue("");
                    setRefundAmountField("");
                  }
                }}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>判断字段 {refundOrderEnabled && <span className="text-red-500">*</span>}</Label>
                <Input
                  value={refundJudgeField}
                  disabled={!refundOrderEnabled}
                  onChange={(e) => {
                    markRuleDraftDirty();
                    setRefundJudgeField(e.target.value);
                    if (e.target.value.trim()) setRefundOrderErrors((prev) => prev.filter((field) => field !== "refundJudgeField"));
                  }}
                  placeholder="如：业务类型"
                  className={hasRefundOrderError("refundJudgeField") ? "border-red-500 focus-visible:ring-red-300" : ""}
                />
              </div>
              <div className="space-y-2">
                <Label>退款订单字段值 {refundOrderEnabled && <span className="text-red-500">*</span>}</Label>
                <Input
                  value={refundJudgeValue}
                  maxLength={500}
                  disabled={!refundOrderEnabled}
                  onChange={(e) => {
                    markRuleDraftDirty();
                    setRefundJudgeValue(e.target.value);
                    if (normalizeRefundJudgeValue(e.target.value)) {
                      setRefundOrderErrors((current) => current.filter((field) => field !== "refundJudgeValue"));
                    }
                  }}
                  placeholder="如：交易退款"
                  className={hasRefundOrderError("refundJudgeValue") ? "border-red-500 focus-visible:ring-red-300" : ""}
                />
              </div>
              <div className="space-y-2">
                <Label>收支方向字段值</Label>
                <Input
                  value={refundDirectionJudgeValue}
                  maxLength={500}
                  disabled={!refundOrderEnabled}
                  onChange={(e) => {
                    markRuleDraftDirty();
                    setRefundDirectionJudgeValue(e.target.value);
                    setRefundOrderErrors((current) => current.filter((field) => field !== "refundDirectionJudgeValue"));
                  }}
                  placeholder="如：转账（选填）"
                  className={hasRefundOrderError("refundDirectionJudgeValue") ? "border-red-500 focus-visible:ring-red-300" : ""}
                />
              </div>
            </div>
          </div>
          <div className="space-y-4 rounded-md border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label>明细分账</Label>
                <p className="text-[11px] text-gray-400">开启后可配置待拆分订单的预匹配字段</p>
              </div>
              <Switch
                checked={detailSplitEnabled}
                disabled={!conditionRecognitionEnabled}
                onCheckedChange={(checked) => {
                  markRuleDraftDirty();
                  setDetailSplitEnabled(checked);
                  setMultiSplitErrors([]);
                }}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>明细分账判断字段 {detailSplitEnabled && <span className="text-red-500">*</span>}</Label>
                <Input
                  value={multiSplitKeywordField}
                  disabled={!detailSplitEnabled}
                  onChange={(e) => {
                    markRuleDraftDirty();
                    setMultiSplitKeywordField(e.target.value);
                    if (e.target.value.trim()) setMultiSplitErrors((prev) => prev.filter((field) => field !== "multiSplitKeywordField"));
                  }}
                  placeholder="如：商品名称、商品信息"
                  className={hasMultiSplitError("multiSplitKeywordField") ? "border-red-500 focus-visible:ring-red-300" : ""}
                />
              </div>
              <div className="space-y-2">
                <Label>判断关键字 {detailSplitEnabled && <span className="text-red-500">*</span>}</Label>
                <Input
                  value={multiSplitKeyword}
                  disabled={!detailSplitEnabled}
                  onChange={(e) => {
                    markRuleDraftDirty();
                    setMultiSplitKeyword(e.target.value);
                    if (e.target.value.trim()) setMultiSplitErrors((prev) => prev.filter((field) => field !== "multiSplitKeyword"));
                  }}
                  placeholder="如：等多件"
                  className={hasMultiSplitError("multiSplitKeyword") ? "border-red-500 focus-visible:ring-red-300" : ""}
                />
              </div>
              <div className="space-y-2">
                <Label>明细匹配字段 {detailSplitEnabled && <span className="text-red-500">*</span>}</Label>
                <Input
                  value={multiSplitMatchField}
                  disabled={!detailSplitEnabled}
                  onChange={(e) => {
                    markRuleDraftDirty();
                    setMultiSplitMatchField(e.target.value);
                    if (e.target.value.trim()) setMultiSplitErrors((prev) => prev.filter((field) => field !== "multiSplitMatchField"));
                  }}
                  placeholder="如：订单号、商户订单号"
                  className={hasMultiSplitError("multiSplitMatchField") ? "border-red-500 focus-visible:ring-red-300" : ""}
                />
              </div>
            </div>
            <Separator />
            <div className="space-y-4">
              <h3 className="font-semibold text-xs text-gray-500">分账包设置</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label>子订单号字段 {detailSplitEnabled && <span className="text-red-500">*</span>}</Label>
                  <Input
                    value={detailSplitOrderNoField}
                    disabled={!detailSplitEnabled}
                    onChange={(e) => {
                      markRuleDraftDirty();
                      setDetailSplitOrderNoField(e.target.value);
                      if (e.target.value.trim()) setMultiSplitErrors((prev) => prev.filter((field) => field !== "detailSplitOrderNoField"));
                    }}
                    placeholder="如：子订单编号"
                    className={hasMultiSplitError("detailSplitOrderNoField") ? "border-red-500 focus-visible:ring-red-300" : ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label>认账条件字段 {detailSplitEnabled && <span className="text-red-500">*</span>}</Label>
                  <Input
                    value={detailSplitRecognitionKeywordField}
                    disabled={!detailSplitEnabled}
                    onChange={(e) => {
                      markRuleDraftDirty();
                      setDetailSplitRecognitionKeywordField(e.target.value);
                      if (e.target.value.trim()) setMultiSplitErrors((prev) => prev.filter((field) => field !== "detailSplitRecognitionKeywordField"));
                    }}
                    placeholder="如：商品标题"
                    className={hasMultiSplitError("detailSplitRecognitionKeywordField") ? "border-red-500 focus-visible:ring-red-300" : ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label>收入字段 {detailSplitEnabled && <span className="text-red-500">*</span>}</Label>
                  <Input
                    value={detailSplitIncomeField}
                    disabled={!detailSplitEnabled}
                    onChange={(e) => {
                      markRuleDraftDirty();
                      setDetailSplitIncomeField(e.target.value);
                      if (e.target.value.trim()) setMultiSplitErrors((prev) => prev.filter((field) => field !== "detailSplitIncomeField"));
                    }}
                    placeholder="如：买家实付金额"
                    className={hasMultiSplitError("detailSplitIncomeField") ? "border-red-500 focus-visible:ring-red-300" : ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label>明细匹配字段 {detailSplitEnabled && <span className="text-red-500">*</span>}</Label>
                  <Input
                    value={detailSplitMatchField}
                    disabled={!detailSplitEnabled}
                    onChange={(e) => {
                      markRuleDraftDirty();
                      setDetailSplitMatchField(e.target.value);
                      if (e.target.value.trim()) setMultiSplitErrors((prev) => prev.filter((field) => field !== "detailSplitMatchField"));
                    }}
                    placeholder="如：主订单编号"
                    className={hasMultiSplitError("detailSplitMatchField") ? "border-red-500 focus-visible:ring-red-300" : ""}
                  />
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-sm text-gray-700">认账归属条件</h3>
          <p className="mt-1 text-[11px] text-gray-400">收入和退款共用认账归属条件，退款只改变金额方向和收入类型。</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
          {conditionRecognitionEnabled ? `${conditions.length} 个条件` : "整包分账"}
        </span>
      </div>

      {conditionRecognitionEnabled && (
        <div className="pt-2">
          <Button size="sm" className="w-full bg-blue-600 text-white hover:bg-blue-700" onClick={addCondition}>
            <Plus className="h-4 w-4 mr-1" />
            添加条件
          </Button>
        </div>
      )}

      {conditionsEditor}

      {conditionRecognitionEnabled && !isEdit && (
        <div className="pt-2">
          <Button size="sm" className="w-full bg-blue-600 text-white hover:bg-blue-700" onClick={addCondition}>
            <Plus className="h-4 w-4 mr-1" />
            添加条件
          </Button>
        </div>
      )}

      {/* 成功弹窗 */}
      <AlertDialog open={successOpen} onOpenChange={setSuccessOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{successMsg.includes("创建") ? "创建成功" : "更新成功"}</AlertDialogTitle>
            <AlertDialogDescription>
              {successMsg}，是否返回规则列表？
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => navigate("/rules")}>返回列表</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 失败弹窗 */}
      <AlertDialog open={errorOpen} onOpenChange={setErrorOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>保存失败</AlertDialogTitle>
            <AlertDialogDescription>{errorMsg}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setErrorOpen(false)}>留在本页修改</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
