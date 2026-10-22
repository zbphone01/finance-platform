import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, Landmark, CheckCircle, X, Save, Search, Pencil, Download, Upload, Eye, Copy } from "lucide-react";
import {
  BudgetCodeSelect,
  DeptTreeSelect,
  DonationActivitySelect,
  NCProjectSelect,
  PlatformProjectDetailSelect,
  PlatformProjectSelect,
  ProjectCenterSelect,
} from "@/components/TreeSelects";
import { usePermissions } from "@/hooks/usePermissions";

type IncomeRuleSplitForm = "百分比" | "认账时填写";

interface SplitForm {
  splitForm: IncomeRuleSplitForm;
  splitRatio: string;
  incomeType: string;
  donationSource: string;
  incomeAttr: string;
  remark: string;
  incomeDept: string;
  budgetCode: string;
  incomeProject: string;
  platformProjectName: string;
  platformProjectDetail: string;
  feedbackType: string;
  memberName: string;
  projectCenter: string;
  region: string;
  isAnonymous: boolean;
  managementFeeType: "比例" | "金额";
  managementFeeValue: string;
  managementFeeRatio: string;
  expenseFundSource: string;
}

type RegionOption = "北京市" | "外省市" | "港澳台" | "境外" | "内部客商";
const regionOptions: RegionOption[] = ["北京市", "外省市", "港澳台", "境外", "内部客商"];
type DonationSourceOption = "互联网募捐平台" | "银行直捐" | "拍卖";
type SplitFieldMode = "platform" | "direct" | "membership" | "interest" | "remarkOnly";
const donationSourceOptions: DonationSourceOption[] = ["互联网募捐平台", "银行直捐", "拍卖"];
const simpleIncomeTypes = ["政府补助", "利息", "个税返还", "本金", "投资收益"];
const remarkOnlyIncomeTypes = ["其他收入", "其他"];
const interestExpenseFundSource = "非限定性-利息收入";

function normalizeRegionOption(value: string): RegionOption | null {
  return regionOptions.includes(value as RegionOption) ? value as RegionOption : null;
}

function formatManagementFeeRatio(value: unknown) {
  const parsed = parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : "0";
}

function formatManagementFeeValue(value: unknown) {
  const parsed = Number(String(value ?? "0"));
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

function normalizeFeedbackType(value: string): "反馈" | "重点反馈" | null {
  return value === "反馈" || value === "重点反馈" ? value : null;
}

function normalizeDonationSourceOption(value: string, incomeType: string): DonationSourceOption | null {
  if (incomeType !== "捐赠收入") return null;
  return donationSourceOptions.includes(value as DonationSourceOption) ? value as DonationSourceOption : null;
}

function getSplitFieldMode(incomeType: string, donationSource: string): SplitFieldMode {
  if (remarkOnlyIncomeTypes.includes(incomeType)) return "remarkOnly";
  if (simpleIncomeTypes.includes(incomeType)) return "interest";
  if (incomeType === "会费收入") return "membership";
  const normalizedDonationSource = normalizeDonationSourceOption(donationSource, incomeType);
  if (normalizedDonationSource === "互联网募捐平台") return "platform";
  return "direct";
}

function getSplitMode(split: Pick<SplitForm, "incomeType" | "donationSource">): SplitFieldMode {
  return getSplitFieldMode(split.incomeType, split.donationSource);
}

function isBankDirectDonationSplit(split: Pick<SplitForm, "incomeType" | "donationSource">) {
  return split.incomeType === "捐赠收入" && split.donationSource === "银行直捐";
}

function getIncomeAttrPrefix(incomeAttr: string) {
  return incomeAttr === "限定性收入" ? "限定性" : "非限定性";
}

function updateFundSourcePrefix(expenseFundSource: string, incomeAttr: string) {
  if (!expenseFundSource) return "";
  const parts = expenseFundSource.split("_");
  parts[0] = getIncomeAttrPrefix(incomeAttr);
  return parts.filter(Boolean).join("_");
}

function updateFundSourceFeedback(expenseFundSource: string, incomeAttr: string, feedbackType: string) {
  if (!expenseFundSource) return "";
  const accountPlaceholder = "[到账户名]";
  const activitySeparator = `_${accountPlaceholder}_`;
  const separatorIndex = expenseFundSource.indexOf(activitySeparator);
  if (separatorIndex < 0) return expenseFundSource;
  const activityName = expenseFundSource.slice(separatorIndex + activitySeparator.length);
  if (!activityName) return expenseFundSource;
  return [getIncomeAttrPrefix(incomeAttr), feedbackType, accountPlaceholder, activityName].filter(Boolean).join("_");
}

function getMembershipExpenseFundSource(budgetCode: string) {
  return budgetCode.trim() === "2.1-其他银行直捐"
    ? "非限定性-项目中心-企业家捐赠"
    : "非限定性_企业家捐赠";
}

function createSplitForm(splitForm: IncomeRuleSplitForm = "百分比"): SplitForm {
  return {
    splitForm,
    splitRatio: splitForm === "百分比" ? "100" : "0",
    incomeType: "",
    donationSource: "",
    incomeAttr: "",
    remark: "",
    incomeDept: "",
    budgetCode: "",
    incomeProject: "",
    platformProjectName: "",
    platformProjectDetail: "",
    feedbackType: "",
    memberName: "",
    projectCenter: "",
    region: "",
    isAnonymous: false,
    managementFeeType: "比例",
    managementFeeValue: "5",
    managementFeeRatio: "5",
    expenseFundSource: "",
  };
}

export default function IncomeRecognitionPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const canDeleteRecognitionRule = hasPermission("recognition_rule_delete");
  const [editing, setEditing] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [ruleName, setRuleName] = useState("");
  const [matchedCounterpartyAlias, setMatchedCounterpartyAlias] = useState("");
  const [splits, setSplits] = useState<SplitForm[]>([]);
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [rulePage, setRulePage] = useState(1);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copySource, setCopySource] = useState<any | null>(null);
  const [copyRuleName, setCopyRuleName] = useState("");
  const [copyCounterpartyAlias, setCopyCounterpartyAlias] = useState("");
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [detailLoadingRuleId, setDetailLoadingRuleId] = useState<number | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const utils = trpc.useUtils();
  const rulesQuery = trpc.incomeRule.list.useQuery({ search: searchQuery || undefined, page: rulePage, pageSize: 20 });
  const statsQuery = trpc.incomeRule.stats.useQuery();
  const exportQuery = trpc.incomeRule.exportAll.useQuery(undefined, { enabled: false });
  const treeQueryOptions = { enabled: editing, staleTime: 5 * 60 * 1000 };
  const deptTreeQuery = trpc.department.tree.useQuery(undefined, treeQueryOptions);
  const budgetCodeTreeQuery = trpc.budgetCode.tree.useQuery(undefined, {
    ...treeQueryOptions,
  });
  const projectTreeQuery = trpc.project.tree.useQuery(undefined, {
    ...treeQueryOptions,
  });
  const fundraisingPlatformTreeQuery = trpc.fundraisingPlatform.tree.useQuery(undefined, {
    ...treeQueryOptions,
  });
  const donationActivityTreeQuery = trpc.donationActivity.tree.useQuery(undefined, treeQueryOptions);
  const incomeCounterpartyQuery = trpc.counterparty.listRecorded.useQuery({ page: 1, pageSize: 500, recognitionType: "到账认账" });

  const showMutationError = (err: any, fallback: string) => {
    if ((err.message || "").includes("创建失败，有相同规则，请检查")) {
      setDuplicateOpen(true);
      return;
    }
    toast.error(err.message || fallback);
  };

  const createMutation = trpc.incomeRule.create.useMutation({
    onSuccess: () => {
      utils.incomeRule.list.invalidate();
      utils.incomeRule.stats.invalidate();
      resetForm();
      toast.success("规则创建成功");
    },
    onError: (err: any) => showMutationError(err, "创建失败"),
  });

  const updateMutation = trpc.incomeRule.update.useMutation({
    onSuccess: () => {
      utils.incomeRule.list.invalidate();
      utils.incomeRule.stats.invalidate();
      resetForm();
      toast.success("规则更新成功");
    },
    onError: (err: any) => showMutationError(err, "更新失败"),
  });

  const copyMutation = trpc.incomeRule.create.useMutation({
    onSuccess: () => {
      utils.incomeRule.list.invalidate();
      utils.incomeRule.stats.invalidate();
      setCopyDialogOpen(false);
      setCopySource(null);
      toast.success("复制成功");
    },
    onError: (err: any) => showMutationError(err, "复制失败"),
  });

  const deleteMutation = trpc.incomeRule.delete.useMutation({
    onSuccess: () => {
      utils.incomeRule.list.invalidate();
      utils.incomeRule.stats.invalidate();
      toast.success("已删除");
    },
    onError: (err: any) => toast.error(err.message || "删除失败"),
  });

  const toggleMutation = trpc.incomeRule.setActive.useMutation({
    onSuccess: () => {
      utils.incomeRule.list.invalidate();
      toast.success("状态已更新");
    },
    onError: (err: any) => toast.error(err.message || "更新失败"),
  });

  const importRulesMutation = trpc.incomeRule.importRules.useMutation({
    onSuccess: (data) => {
      utils.incomeRule.list.invalidate();
      utils.incomeRule.stats.invalidate();
      const extra = data.deactivated > 0 ? `，其中 ${data.deactivated} 条因匹配条件重复已自动停用` : "";
      toast.success(`导入成功：新增 ${data.imported} 条规则${extra}`);
    },
    onError: (err: any) => toast.error(err.message || "导入失败"),
  });

  const resetForm = () => {
    setEditing(false);
    setEditId(null);
    setRuleName("");
    setMatchedCounterpartyAlias("");
    setSplits([]);
  };

  const startCreate = () => {
    setEditing(true);
    setEditId(null);
    setRuleName("");
    setMatchedCounterpartyAlias("");
    setSplits([createSplitForm()]);
  };

  const downloadJson = (data: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = async () => {
    const result = await exportQuery.refetch();
    if (!result.data) {
      toast.error("导出失败");
      return;
    }
    downloadJson(result.data, `到账认账规则_${new Date().toISOString().slice(0, 10)}.json`);
    toast.success("规则已导出");
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await importRulesMutation.mutateAsync({ data });
    } catch (err: any) {
      toast.error(err?.message || "导入失败，请检查文件");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const addSplit = () => {
    setSplits((prev) => [...prev, createSplitForm(prev[0]?.splitForm || "百分比")]);
  };

  const removeSplit = (idx: number) => {
    setSplits((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateSplit = (idx: number, field: keyof SplitForm, value: string | boolean) => {
    if (field === "splitForm") {
      const nextSplitForm = value === "认账时填写" ? "认账时填写" : "百分比";
      setSplits((prev) => prev.map((split) => ({
        ...split,
        splitForm: nextSplitForm,
        splitRatio: nextSplitForm === "百分比" ? split.splitRatio || "100" : "0",
      })));
      return;
    }
    setSplits((prev) =>
      prev.map((s, i) => {
        if (i !== idx) return s;
        const next = { ...s, [field]: value };
        if (field === "incomeDept") {
          next.budgetCode = "";
          next.incomeProject = "";
          next.platformProjectName = "";
          next.platformProjectDetail = "";
          next.expenseFundSource = getSplitMode(next) === "membership" ? getMembershipExpenseFundSource("") : "";
        }
        if (field === "incomeAttr") {
          next.expenseFundSource = getSplitMode(next) === "membership"
            ? getMembershipExpenseFundSource(next.budgetCode)
            : updateFundSourcePrefix(next.expenseFundSource, String(value));
        }
        if (field === "incomeType" && value !== "捐赠收入") {
          next.donationSource = "";
        }
        if (field === "incomeType" || field === "donationSource") {
          next.expenseFundSource = "";
          const mode = getSplitMode(next);
          const isBankDirectDonation = isBankDirectDonationSplit(next);
          if (mode !== "platform") {
            next.platformProjectName = "";
            next.platformProjectDetail = "";
          }
          if (mode === "platform" || mode === "remarkOnly") {
            next.feedbackType = "";
            next.region = "";
          }
          if (mode === "interest" || mode === "remarkOnly") {
            next.feedbackType = "";
            next.region = "";
          }
          if (isBankDirectDonation) {
            next.region = "";
          }
          if (mode === "remarkOnly") {
            next.incomeDept = "";
            next.budgetCode = "";
            next.incomeProject = "";
            next.expenseFundSource = "";
          } else {
            next.remark = "";
          }
          if (mode !== "membership" && !isBankDirectDonation) {
            next.memberName = "";
          }
          if (!isBankDirectDonation) {
            next.projectCenter = "";
          }
          if (mode !== "membership") {
            next.isAnonymous = false;
          }
          if (mode === "membership" || mode === "interest" || mode === "remarkOnly") {
            next.managementFeeType = "比例";
            next.managementFeeValue = "0";
            next.managementFeeRatio = "0";
          }
          if (mode === "membership") {
            next.expenseFundSource = getMembershipExpenseFundSource(next.budgetCode);
          }
        }
        if (field === "platformProjectName") {
          next.expenseFundSource = "";
        }
        if (field === "feedbackType") {
          next.expenseFundSource = getSplitMode(next) === "membership"
            ? getMembershipExpenseFundSource(next.budgetCode)
            : updateFundSourceFeedback(next.expenseFundSource, next.incomeAttr, String(value));
        }
        if (field === "platformProjectName") {
          next.platformProjectDetail = "";
        }
        return next;
      })
    );
  };

  const handleNCProjectChange = (idx: number, value: string) => {
    setSplits((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, incomeProject: value, platformProjectName: "", platformProjectDetail: "" } : s))
    );
  };

  // 选择预算编码时，自动同步其 NC 项目，用户仍可手动改选
  const handleBudgetCodeChange = (idx: number, val: string, autoProject: string | null) => {
    setSplits((prev) =>
      prev.map((s, i) => {
        if (i !== idx) return s;
        const next = {
          ...s,
          budgetCode: val,
          expenseFundSource: getSplitMode(s) === "membership" ? getMembershipExpenseFundSource(val) : "",
        };
        if (autoProject && /^PM/.test(autoProject)) {
          next.incomeProject = autoProject;
          next.platformProjectName = "";
          next.platformProjectDetail = "";
        }
        return next;
      })
    );
  };

  // 选择捐赠活动后，自动拼接支出资金来源
  const handleDonationActivityChange = (idx: number, activityName: string) => {
    setSplits((prev) =>
      prev.map((s, i) => {
        if (i !== idx) return s;
        const mode = getSplitMode(s);
        if (mode !== "platform") {
          const parts = [getIncomeAttrPrefix(s.incomeAttr), s.feedbackType, "[到账户名]", activityName].filter(Boolean);
          return { ...s, expenseFundSource: parts.join("_") };
        }
        const prefix = getIncomeAttrPrefix(s.incomeAttr);
        // 解析预算名称（去掉 code- 前缀）
        let budgetName = "";
        if (s.budgetCode) {
          const parts = s.budgetCode.split("-");
          budgetName = parts.length > 1 ? parts.slice(1).join("-") : s.budgetCode;
        }
        const projectName = s.platformProjectName ? getProjectNameForFundSource(s.platformProjectName) : "";
        const parts = [prefix, budgetName, projectName, activityName].filter(Boolean);
        return { ...s, expenseFundSource: parts.join("_") };
      })
    );
  };

  const getTotalRatio = () =>
    splits.reduce((sum, s) => sum + (parseInt(s.splitRatio || "0", 10) || 0), 0);

  const handleSave = () => {
    if (!ruleName.trim()) {
      toast.error("规则名称不能为空");
      return;
    }
    if (!matchedCounterpartyAlias) {
      toast.error("请选择匹配到账信息");
      return;
    }
    const splitForm = splits[0]?.splitForm || "百分比";
    if (splits.some((split) => split.splitForm !== splitForm)) {
      toast.error("各分账的分账形式必须一致");
      return;
    }
    if (splitForm === "百分比") {
      const totalRatio = getTotalRatio();
      if (Math.abs(totalRatio - 100) > 0.01) {
        toast.error(`分账比例之和必须等于100%，当前${Math.round(totalRatio)}%`);
        return;
      }
    }
    for (let i = 0; i < splits.length; i++) {
      const split = splits[i];
      const mode = getSplitMode(split);
      if (split.incomeType === "捐赠收入" && !normalizeDonationSourceOption(split.donationSource, split.incomeType)) {
        toast.error(`分账 ${i + 1} 捐赠来源必填`);
        return;
      }
      if (!split.incomeAttr) {
        toast.error(`分账 ${i + 1} 收入属性必填`);
        return;
      }
      if (mode === "remarkOnly") {
        continue;
      }
      if (!split.incomeDept) {
        toast.error(`分账 ${i + 1} 收入部门必填`);
        return;
      }
      if (!split.budgetCode) {
        toast.error(`分账 ${i + 1} 预算编码必填`);
        return;
      }
      if (!split.incomeProject) {
        toast.error(`分账 ${i + 1} NC项目名称必填`);
        return;
      }
      if (mode === "platform" && !split.platformProjectName) {
        toast.error(`分账 ${i + 1} 平台项目名称必填`);
        return;
      }
      if (mode === "platform" && !split.platformProjectDetail) {
        toast.error(`分账 ${i + 1} 平台项目详情必填`);
        return;
      }
      if (mode !== "platform" && mode !== "interest" && !split.feedbackType) {
        toast.error(`分账 ${i + 1} 反馈类型必填`);
        return;
      }
      if (mode !== "platform" && mode !== "interest" && !isBankDirectDonationSplit(split) && !split.region) {
        toast.error(`分账 ${i + 1} 地区必填`);
        return;
      }
      if (mode === "membership" && !split.memberName.trim()) {
        toast.error(`分账 ${i + 1} 会员姓名必填`);
        return;
      }
      if (isBankDirectDonationSplit(split) && split.memberName.trim() && !split.projectCenter) {
        toast.error(`分账 ${i + 1} 填写会员姓名时所属项目中心必填`);
        return;
      }
      if (mode !== "membership" && mode !== "interest" && !split.expenseFundSource) {
        toast.error(`分账 ${i + 1} 支出资金来源必填`);
        return;
      }
      if (mode !== "membership" && mode !== "interest" && !String(split.managementFeeValue || split.managementFeeRatio).trim()) {
        toast.error(`分账 ${i + 1} 管理费必填`);
        return;
      }
    }

    const payload = {
      ruleName: ruleName.trim(),
      matchedCounterpartyAlias,
      recognitionType: "渠道捐赠" as const,
      accountName: null,
      purpose: null,
      postScript: null,
      splits: splits.map((s) => {
        const mode = getSplitMode(s);
        const isBankDirectDonation = isBankDirectDonationSplit(s);
        const hasNoManagementFee = mode === "membership" || mode === "interest" || mode === "remarkOnly";
        const managementFeeType = hasNoManagementFee ? "比例" : s.managementFeeType;
        const managementFeeValue = hasNoManagementFee ? "0" : formatManagementFeeValue(s.managementFeeValue || s.managementFeeRatio);
        return {
          ...s,
          splitForm: s.splitForm,
          splitRatio: s.splitForm === "百分比" ? formatSplitRatio(s.splitRatio) : "0",
          incomeType: s.incomeType || null,
          donationSource: normalizeDonationSourceOption(s.donationSource, s.incomeType),
          incomeAttr: s.incomeAttr || null,
          remark: mode === "remarkOnly" ? s.remark.trim() || null : null,
          incomeDept: mode === "remarkOnly" ? null : s.incomeDept || null,
          budgetCode: mode === "remarkOnly" ? null : s.budgetCode || null,
          incomeProject: mode === "remarkOnly" ? null : s.incomeProject || null,
          platformProjectName: mode === "platform" ? s.platformProjectName || null : null,
          platformProjectDetail: mode === "platform" ? s.platformProjectDetail || null : null,
          feedbackType: mode === "platform" || mode === "interest" || mode === "remarkOnly" ? null : normalizeFeedbackType(s.feedbackType),
          memberName: mode === "membership" || isBankDirectDonation ? s.memberName.trim() || null : null,
          projectCenter: isBankDirectDonation ? s.projectCenter || null : null,
          region: mode === "platform" || mode === "interest" || mode === "remarkOnly" || isBankDirectDonation ? null : normalizeRegionOption(s.region),
          isAnonymous: mode === "membership" ? s.isAnonymous : false,
          managementFeeType,
          managementFeeValue,
          managementFeeRatio: managementFeeType === "比例" ? formatManagementFeeRatio(managementFeeValue) : "0",
          expenseFundSource: s.incomeType === "利息"
            ? interestExpenseFundSource
            : mode === "interest" || mode === "remarkOnly"
              ? null
            : mode === "membership"
              ? s.expenseFundSource || getMembershipExpenseFundSource(s.budgetCode)
              : s.expenseFundSource || null,
        };
      }),
    };

    if (editId) {
      updateMutation.mutate({ id: editId, ...payload, isActive: true });
    } else {
      createMutation.mutate(payload);
    }
  };

  const loadRuleDetail = async (ruleId: number) => {
    setDetailLoadingRuleId(ruleId);
    try {
      const rule = await utils.incomeRule.getById.fetch({ id: ruleId });
      if (!rule) {
        toast.error("规则不存在或已被删除");
        return null;
      }
      return rule;
    } catch (err: any) {
      toast.error(err.message || "加载规则详情失败");
      return null;
    } finally {
      setDetailLoadingRuleId(null);
    }
  };

  const handleEdit = async (summaryRule: any) => {
    const rule = await loadRuleDetail(Number(summaryRule.id));
    if (!rule) return;
    setEditing(true);
    setEditId(rule.id);
    setRuleName(rule.ruleName || "");
    setMatchedCounterpartyAlias(rule.matchedCounterpartyAlias || "");
    setSplits(
      (rule.splits || []).map((s: any) => ({
        splitForm: s.splitForm === "认账时填写" ? "认账时填写" : "百分比",
        splitRatio: s.splitRatio || "100",
        incomeType: s.incomeType || "",
        donationSource: s.donationSource || "",
        incomeAttr: s.incomeAttr || "",
        remark: s.remark || "",
        incomeDept: s.incomeDept || "",
        budgetCode: s.budgetCode || "",
        incomeProject: s.incomeProject || "",
        platformProjectName: s.platformProjectName || "",
        platformProjectDetail: s.platformProjectDetail || "",
        feedbackType: s.feedbackType || "",
        memberName: s.memberName || "",
        projectCenter: s.projectCenter || "",
        region: s.region || "",
        isAnonymous: !!s.isAnonymous,
        managementFeeType: s.managementFeeType === "金额" ? "金额" : "比例",
        managementFeeValue: formatManagementFeeValue(s.managementFeeValue ?? s.managementFeeRatio),
        managementFeeRatio: formatManagementFeeRatio(s.managementFeeRatio),
        expenseFundSource: s.expenseFundSource || "",
      }))
    );
  };

  const applyCounterpartyMatch = (value: string) => {
    setMatchedCounterpartyAlias(value);
  };

  const applyCopyCounterpartyMatch = (value: string) => {
    setCopyCounterpartyAlias(value);
  };

  const openCopyDialog = async (summaryRule: any) => {
    const rule = await loadRuleDetail(Number(summaryRule.id));
    if (!rule) return;
    setCopySource(rule);
    setCopyRuleName(`${rule.ruleName} 副本`);
    setCopyCounterpartyAlias(rule.matchedCounterpartyAlias || "");
    setCopyDialogOpen(true);
  };

  const handleCopy = () => {
    if (!copySource) return;
    if (!copyRuleName.trim()) {
      toast.error("请输入规则名称");
      return;
    }
    if (!copyCounterpartyAlias) {
      toast.error("请选择匹配到账信息");
      return;
    }
    copyMutation.mutate({
      ruleName: copyRuleName.trim(),
      matchedCounterpartyAlias: copyCounterpartyAlias,
      recognitionType: "渠道捐赠" as const,
      accountName: null,
      purpose: null,
      postScript: null,
      splits: (copySource.splits || []).map((split: any) => {
        const mode = getSplitFieldMode(split.incomeType || "", split.donationSource || "");
        const isBankDirectDonation = isBankDirectDonationSplit({
          incomeType: split.incomeType || "",
          donationSource: split.donationSource || "",
        });
        const hasNoManagementFee = mode === "membership" || mode === "interest" || mode === "remarkOnly";
        const managementFeeType = hasNoManagementFee ? "比例" : split.managementFeeType === "金额" ? "金额" : "比例";
        const managementFeeValue = hasNoManagementFee ? "0" : formatManagementFeeValue(split.managementFeeValue ?? split.managementFeeRatio);
        return {
          splitForm: split.splitForm === "认账时填写" ? "认账时填写" as const : "百分比" as const,
          splitRatio: split.splitForm === "认账时填写" ? "0" : formatSplitRatio(split.splitRatio),
          incomeType: split.incomeType || null,
          donationSource: normalizeDonationSourceOption(split.donationSource || "", split.incomeType || ""),
          incomeAttr: split.incomeAttr || null,
          remark: mode === "remarkOnly" ? String(split.remark || "").trim() || null : null,
          incomeDept: mode === "remarkOnly" ? null : split.incomeDept || null,
          budgetCode: mode === "remarkOnly" ? null : split.budgetCode || null,
          incomeProject: mode === "remarkOnly" ? null : split.incomeProject || null,
          platformProjectName: mode === "platform" ? split.platformProjectName || null : null,
          platformProjectDetail: mode === "platform" ? split.platformProjectDetail || null : null,
          feedbackType: mode === "platform" || mode === "interest" || mode === "remarkOnly" ? null : normalizeFeedbackType(split.feedbackType),
          memberName: mode === "membership" || isBankDirectDonation ? split.memberName || null : null,
          projectCenter: isBankDirectDonation ? split.projectCenter || null : null,
          region: mode === "platform" || mode === "interest" || mode === "remarkOnly" || isBankDirectDonation ? null : split.region || null,
          isAnonymous: mode === "membership" ? !!split.isAnonymous : false,
          managementFeeType,
          managementFeeValue,
          managementFeeRatio: managementFeeType === "金额" ? "0" : formatManagementFeeRatio(managementFeeValue),
          expenseFundSource: split.incomeType === "利息"
            ? interestExpenseFundSource
            : mode === "interest" || mode === "remarkOnly"
              ? null
              : split.expenseFundSource || null,
        };
      }),
    });
  };

  const totalRatio = getTotalRatio();
  const currentSplitForm = splits[0]?.splitForm || "百分比";
  const ratioValid = currentSplitForm !== "百分比" || Math.abs(totalRatio - 100) < 0.01;
  const rules = rulesQuery.data?.items || [];
  const totalRules = rulesQuery.data?.total || 0;
  const totalPages = Math.ceil(totalRules / 20);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">到账认账</h1>
        <div className="flex items-center gap-4">
          <div className="flex gap-3 text-sm text-gray-500">
            <div className="flex items-center gap-1">
              <Landmark className="h-4 w-4 text-blue-600" />
              规则: <span className="font-medium text-gray-700">{statsQuery.data?.total || 0}</span>
            </div>
            <div className="flex items-center gap-1">
              <CheckCircle className="h-4 w-4 text-green-600" />
              启用: <span className="font-medium text-gray-700">{statsQuery.data?.active || 0}</span>
            </div>
          </div>
          {!editing && (
            <>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImportFile(file);
                }}
              />
              <Button variant="outline" onClick={handleExport} disabled={exportQuery.isFetching}>
                <Download className="h-4 w-4 mr-1" />
                导出规则
              </Button>
              <Button variant="outline" onClick={() => importInputRef.current?.click()} disabled={importRulesMutation.isPending}>
                <Upload className="h-4 w-4 mr-1" />
                导入规则
              </Button>
              <Button onClick={startCreate}>
                <Plus className="h-4 w-4 mr-1" />
                新建规则
              </Button>
            </>
          )}
        </div>
      </div>

      {!editing && (
        <div className="flex gap-2">
          <Input
            placeholder="搜索规则名称"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64"
          />
          <Button variant="outline" onClick={() => { setRulePage(1); setSearchQuery(search.trim()); }}>
            <Search className="h-4 w-4 mr-1" />
            搜索
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setSearch("");
              setSearchQuery("");
              setRulePage(1);
            }}
          >
            重置
          </Button>
        </div>
      )}

      {/* 新建/编辑表单 */}
      {editing && (
        <Card className="bg-slate-50 border-slate-200">
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-gray-800">
                {editId ? "编辑规则" : "新建到账认账规则"}
              </h3>
              <Button variant="ghost" onClick={resetForm}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* 基本信息 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>规则名称 <span className="text-red-500">*</span></Label>
                <Input value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder="自定义规则名称，便于识别" />
              </div>
              <div className="space-y-2">
                <Label>匹配到账信息 <span className="text-red-500">*</span></Label>
                <Select value={matchedCounterpartyAlias} onValueChange={applyCounterpartyMatch}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="请选择已记录的到账信息" />
                  </SelectTrigger>
                  <SelectContent>
                    {incomeCounterpartyQuery.data?.items.map((item: any) => (
                      <SelectItem key={item.id} value={item.alias}>
                        {item.alias}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!incomeCounterpartyQuery.isLoading && !incomeCounterpartyQuery.data?.items.length && (
                  <p className="text-xs text-amber-600">暂无可用到账信息，请先在“到账信息汇总”中记录认账类型为“到账认账”的到账信息。</p>
                )}
              </div>
            </div>

            {/* 分账设置 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-700">分账设置</span>
                  {currentSplitForm === "百分比" ? (
                    <span className="text-sm">
                      比例总和:{" "}
                      <span className={ratioValid ? "text-green-600 font-semibold" : "text-red-600 font-semibold"}>
                        {Math.round(totalRatio)}%
                      </span>
                      {!ratioValid && <span className="text-xs text-red-500 ml-2">（必须=100%）</span>}
                    </span>
                  ) : (
                    <span className="text-xs text-orange-600">匹配到账后逐行填写认账金额</span>
                  )}
                </div>
              </div>

              {splits.map((split, idx) => {
                const mode = getSplitMode(split);
                const isPlatformMode = mode === "platform";
                const isMembershipMode = mode === "membership";
                const isInterestMode = mode === "interest";
                const isRemarkOnlyMode = mode === "remarkOnly";
                const isBankDirectDonationMode = isBankDirectDonationSplit(split);
                return (
                  <Card key={idx} className="bg-white">
                  <CardContent className="p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-600">分账 {idx + 1}</span>
                      {splits.length > 1 && (
                        <Button variant="ghost" className="h-6 w-6 p-0 text-red-400" onClick={() => removeSplit(idx)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">分账形式 <span className="text-red-500">*</span></Label>
                        <div className="flex h-9 rounded-md border border-input bg-background">
                          <select
                            className={`${split.splitForm === "百分比" ? "w-28 border-r" : "w-full"} bg-transparent px-2 text-sm outline-none disabled:text-gray-400`}
                            value={split.splitForm}
                            onChange={(e) => updateSplit(idx, "splitForm", e.target.value)}
                            disabled={idx > 0}
                          >
                            <option>百分比</option>
                            <option>认账时填写</option>
                          </select>
                          {split.splitForm === "百分比" && (
                            <Input
                              className="h-8 flex-1 border-0 shadow-none focus-visible:ring-0"
                              value={split.splitRatio}
                              onChange={(e) => updateSplit(idx, "splitRatio", e.target.value.replace(/\D/g, ""))}
                              placeholder="100"
                              inputMode="numeric"
                            />
                          )}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">收入类型 <span className="text-red-500">*</span></Label>
                        <select
                          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                          value={split.incomeType}
                          onChange={(e) => updateSplit(idx, "incomeType", e.target.value)}
                        >
                          <option value="">请选择</option>
                          <option>捐赠收入</option>
                          <option>会费收入</option>
                          <option>政府补助</option>
                          <option>个税返还</option>
                          <option>本金</option>
                          <option>投资收益</option>
                          <option>利息</option>
                          <option>其他收入</option>
                          <option>其他</option>
                        </select>
                      </div>
                      {split.incomeType === "捐赠收入" && (
                        <div className="space-y-1">
                          <Label className="text-xs">捐赠来源 <span className="text-red-500">*</span></Label>
                          <select
                            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                            value={split.donationSource}
                            onChange={(e) => updateSplit(idx, "donationSource", e.target.value)}
                          >
                            <option value="">请选择</option>
                            {donationSourceOptions.map((option) => <option key={option}>{option}</option>)}
                          </select>
                        </div>
                      )}
                      {Boolean(split.incomeType) && (
                        <div className="space-y-1">
                          <Label className="text-xs">收入属性 <span className="text-red-500">*</span></Label>
                          <select
                            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                            value={split.incomeAttr}
                            onChange={(e) => updateSplit(idx, "incomeAttr", e.target.value)}
                          >
                            <option value="">请选择</option>
                            <option>非限定性收入</option>
                            <option>限定性收入</option>
                          </select>
                        </div>
                      )}
                      {Boolean(split.incomeType) && isRemarkOnlyMode && (
                        <div className="space-y-1">
                          <Label className="text-xs">备注</Label>
                          <Input className="h-9" value={split.remark} onChange={(e) => updateSplit(idx, "remark", e.target.value)} placeholder="请输入备注" />
                        </div>
                      )}
                      {Boolean(split.incomeType) && !isRemarkOnlyMode && (
                        <>
                          <div className="space-y-1">
                            <Label className="text-xs">收入部门 <span className="text-red-500">*</span></Label>
                            <DeptTreeSelect
                              value={split.incomeDept}
                              tree={deptTreeQuery.data || []}
                              onChange={(val) => updateSplit(idx, "incomeDept", val)}
                              placeholder="请选择部门"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">预算编码 <span className="text-red-500">*</span></Label>
                            <BudgetCodeSelect
                              value={split.budgetCode}
                              tree={budgetCodeTreeQuery.data || []}
                              incomeDept={split.incomeDept}
                              onChange={(val, autoProject) => handleBudgetCodeChange(idx, val, autoProject)}
                              placeholder="请选择预算编码"
                              disabled={budgetCodeTreeQuery.isLoading}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">NC项目名称 <span className="text-red-500">*</span></Label>
                            <NCProjectSelect
                              value={split.incomeProject}
                              tree={projectTreeQuery.data || []}
                              budgetCodeTree={budgetCodeTreeQuery.data || []}
                              budgetCodeValue={split.budgetCode}
                              onChange={(val) => handleNCProjectChange(idx, val)}
                              placeholder="请选择NC项目名称"
                              disabled={projectTreeQuery.isLoading}
                            />
                          </div>
                          {isInterestMode ? null : isPlatformMode ? (
                            <>
                              <div className="space-y-1">
                                <Label className="text-xs">平台项目名称 <span className="text-red-500">*</span></Label>
                                <PlatformProjectSelect
                                  value={split.platformProjectName}
                                  tree={projectTreeQuery.data || []}
                                  budgetCodeTree={budgetCodeTreeQuery.data || []}
                                  budgetCodeValue={split.budgetCode}
                                  ncProjectValue={split.incomeProject}
                                  onChange={(val) => updateSplit(idx, "platformProjectName", val)}
                                  placeholder="请选择平台项目名称"
                                  disabled={projectTreeQuery.isLoading}
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">平台项目详情 <span className="text-red-500">*</span></Label>
                                <PlatformProjectDetailSelect
                                  value={split.platformProjectDetail}
                                  tree={fundraisingPlatformTreeQuery.data || []}
                                  platformProjectValue={split.platformProjectName}
                                  onChange={(val) => updateSplit(idx, "platformProjectDetail", val)}
                                  placeholder="请选择平台项目详情"
                                  disabled={fundraisingPlatformTreeQuery.isLoading}
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">支出资金来源 <span className="text-red-500">*</span></Label>
                                <DonationActivitySelect
                                  value={split.expenseFundSource}
                                  tree={donationActivityTreeQuery.data || []}
                                  onChange={(activityName) => handleDonationActivityChange(idx, activityName)}
                                  placeholder="请选择捐赠活动"
                                  disabled={donationActivityTreeQuery.isLoading}
                                />
                              </div>
                            </>
                          ) : isMembershipMode ? (
                            <>
                              <div className="space-y-1">
                                <Label className="text-xs">反馈类型 <span className="text-red-500">*</span></Label>
                                <select
                                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                                  value={split.feedbackType}
                                  onChange={(e) => updateSplit(idx, "feedbackType", e.target.value)}
                                >
                                  <option value="">请选择</option>
                                  <option>反馈</option>
                                  <option>重点反馈</option>
                                </select>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">地区 <span className="text-red-500">*</span></Label>
                                <select
                                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                                  value={split.region}
                                  onChange={(e) => updateSplit(idx, "region", e.target.value)}
                                >
                                  <option value="">请选择</option>
                                  {regionOptions.map((option) => <option key={option}>{option}</option>)}
                                </select>
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">会员姓名 <span className="text-red-500">*</span></Label>
                                <Input className="h-9" value={split.memberName} onChange={(e) => updateSplit(idx, "memberName", e.target.value)} placeholder="请输入会员姓名" />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">匿名 <span className="text-red-500">*</span></Label>
                                <select
                                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                                  value={split.isAnonymous ? "是" : "否"}
                                  onChange={(e) => updateSplit(idx, "isAnonymous", e.target.value === "是")}
                                >
                                  <option>否</option>
                                  <option>是</option>
                                </select>
                              </div>
                            </>
                          ) : (
                            <>
                              <div className="space-y-1">
                                <Label className="text-xs">支出资金来源 <span className="text-red-500">*</span></Label>
                                <DonationActivitySelect
                                  value={split.expenseFundSource}
                                  tree={donationActivityTreeQuery.data || []}
                                  onChange={(activityName) => handleDonationActivityChange(idx, activityName)}
                                  placeholder="请选择捐赠活动"
                                  disabled={donationActivityTreeQuery.isLoading}
                                />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-xs">反馈类型 <span className="text-red-500">*</span></Label>
                                <select
                                  className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                                  value={split.feedbackType}
                                  onChange={(e) => updateSplit(idx, "feedbackType", e.target.value)}
                                >
                                  <option value="">请选择</option>
                                  <option>反馈</option>
                                  <option>重点反馈</option>
                                </select>
                              </div>
                              {!isBankDirectDonationMode && (
                                <div className="space-y-1">
                                  <Label className="text-xs">地区 <span className="text-red-500">*</span></Label>
                                  <select
                                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                                    value={split.region}
                                    onChange={(e) => updateSplit(idx, "region", e.target.value)}
                                  >
                                    <option value="">请选择</option>
                                    {regionOptions.map((option) => <option key={option}>{option}</option>)}
                                  </select>
                                </div>
                              )}
                              {isBankDirectDonationMode && (
                                <>
                                  <div className="space-y-1">
                                    <Label className="text-xs">会员姓名</Label>
                                    <Input
                                      className="h-9"
                                      value={split.memberName}
                                      onChange={(e) => updateSplit(idx, "memberName", e.target.value)}
                                      placeholder="选填"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label className="text-xs">
                                      所属项目中心
                                      {split.memberName.trim() && <span className="text-red-500"> *</span>}
                                    </Label>
                                    <ProjectCenterSelect
                                      value={split.projectCenter}
                                      tree={deptTreeQuery.data || []}
                                      onChange={(value) => updateSplit(idx, "projectCenter", value)}
                                      placeholder="请选择所属项目中心"
                                      disabled={deptTreeQuery.isLoading}
                                    />
                                  </div>
                                </>
                              )}
                            </>
                          )}
                          {!isMembershipMode && !isInterestMode && (
                            <div className="space-y-1">
                              <Label className="text-xs">管理费 <span className="text-red-500">*</span></Label>
                              <div className="flex h-9 rounded-md border border-input bg-background">
                                <select
                                  className="w-20 border-r bg-transparent px-2 text-sm outline-none"
                                  value={split.managementFeeType}
                                  onChange={(e) => updateSplit(idx, "managementFeeType", e.target.value as "比例" | "金额")}
                                >
                                  <option value="比例">百分比</option>
                                  <option>金额</option>
                                </select>
                                <Input
                                  className="h-8 flex-1 border-0 shadow-none focus-visible:ring-0"
                                  value={split.managementFeeValue}
                                  onChange={(e) => updateSplit(idx, "managementFeeValue", e.target.value.replace(/[^\d.]/g, ""))}
                                  placeholder={split.managementFeeType === "比例" ? "9" : "0.00"}
                                  inputMode="decimal"
                                />
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </CardContent>
                  </Card>
                );
              })}

              <Button variant="outline" className="w-full border-dashed" onClick={addSplit}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                添加分账
              </Button>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={resetForm}>取消</Button>
              <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
                <Save className="h-4 w-4 mr-1" />
                {editId ? "保存修改" : "创建规则"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 规则列表 */}
      {!editing && (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">ID</TableHead>
                    <TableHead className="w-40 min-w-[160px]">规则名称</TableHead>
                    <TableHead className="w-40 min-w-[160px]">匹配到账信息</TableHead>
                    <TableHead className="w-16">分账数</TableHead>
                    <TableHead className="w-16">状态</TableHead>
                    <TableHead className="w-36">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rulesQuery.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8">加载中...</TableCell>
                    </TableRow>
                  ) : rules.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-gray-400">
                        {searchQuery ? "未找到匹配的到账认账规则" : "暂无到账认账规则，点击“新建规则”创建"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    rules.map((rule: any) => (
                      <TableRow key={rule.id}>
                        <TableCell className="font-mono text-xs">{rule.id}</TableCell>
                        <TableCell className="font-medium truncate">{rule.ruleName}</TableCell>
                        <TableCell className="truncate">{rule.matchedCounterpartyAlias || "未关联到账信息"}</TableCell>
                        <TableCell>{rule.splitCount || 0}</TableCell>
                        <TableCell>
                          <Switch
                            checked={!!rule.isActive}
                            onCheckedChange={(checked) => {
                              toggleMutation.mutate({
                                id: rule.id,
                                isActive: checked,
                              });
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-blue-500 h-7 w-7 p-0"
                              onClick={() => navigate(`/income-recognition/${rule.id}`)}
                              title="查看"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-orange-500 h-7 w-7 p-0"
                              onClick={() => handleEdit(rule)}
                              disabled={detailLoadingRuleId === rule.id}
                              title="编辑"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-green-600 h-7 w-7 p-0"
                              onClick={() => openCopyDialog(rule)}
                              disabled={detailLoadingRuleId === rule.id}
                              title="复制"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className={`h-7 w-7 p-0 ${canDeleteRecognitionRule ? "text-red-500 hover:text-red-700" : "text-gray-300"}`}
                              onClick={() => { if (confirm("确定删除？")) deleteMutation.mutate({ id: rule.id }); }}
                              disabled={!canDeleteRecognitionRule}
                              title={canDeleteRecognitionRule ? "删除" : "无删除权限"}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {totalRules > 20 && (
              <div className="flex justify-center p-4 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRulePage((p) => Math.max(1, p - 1))}
                  disabled={rulePage === 1 || rulesQuery.isFetching}
                >
                  上一页
                </Button>
                <span className="text-sm text-gray-500 self-center">
                  第 {rulePage} / {totalPages} 页，共 {totalRules} 条
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRulePage((p) => p + 1)}
                  disabled={rulePage >= totalPages || rulesQuery.isFetching}
                >
                  下一页
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={copyDialogOpen} onOpenChange={setCopyDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>复制到账认账规则</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>规则名称 <span className="text-red-500">*</span></Label>
                <Input value={copyRuleName} onChange={(e) => setCopyRuleName(e.target.value)} placeholder="请输入新规则名称" autoFocus />
              </div>
              <div className="space-y-2">
                <Label>匹配到账信息 <span className="text-red-500">*</span></Label>
                <Select value={copyCounterpartyAlias} onValueChange={applyCopyCounterpartyMatch}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="请选择已记录的到账信息" />
                  </SelectTrigger>
                  <SelectContent>
                    {incomeCounterpartyQuery.data?.items.map((item: any) => (
                      <SelectItem key={item.id} value={item.alias}>
                        {item.alias}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-gray-400">复制成功后沿用原规则的分账设置。</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyDialogOpen(false)} disabled={copyMutation.isPending}>取消</Button>
            <Button onClick={handleCopy} disabled={copyMutation.isPending}>
              {copyMutation.isPending ? "复制中..." : "确定"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={duplicateOpen} onOpenChange={setDuplicateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>创建失败</AlertDialogTitle>
            <AlertDialogDescription>创建失败，有相同规则，请检查。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setDuplicateOpen(false)}>关闭</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
