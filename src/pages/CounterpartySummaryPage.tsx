import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { ArrowLeft, Landmark, Plus, Trash2, CheckCircle, Tag, Pencil, X } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";

type CounterpartyRecognitionType = "到账认账" | "明细认账";
type DetailPackageType = "T+1" | "打包明细";
type DetailMatchingMode = "单笔匹配" | "同日汇总匹配" | "多日汇总匹配";
type ArrivalRegion = "北京市" | "外省市" | "港澳台" | "境外" | "内部客商";
type BankName = "广发银行" | "工商银行" | "中国银行";
type RecognitionTypeFilter = "all" | CounterpartyRecognitionType;
type MatchAccountDraft = {
  bankName: BankName | "";
  accountNo: string;
  accountName: string;
  summary: string;
  purpose: string;
  postScript: string;
};

const recognitionTypeOptions: CounterpartyRecognitionType[] = ["到账认账", "明细认账"];
const detailPackageTypeOptions: DetailPackageType[] = ["T+1", "打包明细"];
const detailMatchingModeOptions: DetailMatchingMode[] = ["单笔匹配", "同日汇总匹配", "多日汇总匹配"];
const arrivalRegionOptions: ArrivalRegion[] = ["北京市", "外省市", "港澳台", "境外", "内部客商"];
const bankNameOptions: BankName[] = ["广发银行", "工商银行", "中国银行"];
const recognitionTypeDescriptions: Record<CounterpartyRecognitionType, string> = {
  到账认账: "按银行到账本身直接认账，适用于单笔到账即可确认收入归属的场景。",
  明细认账: "订单明细利用规则中的匹配到账信息查找认账用银行流水，并按设置进行认账。",
};
const detailMatchingModeDescriptions: Record<DetailMatchingMode, string> = {
  单笔匹配: "单个订单明细包，对应同日一笔银行到账。",
  同日汇总匹配: "单个订单明细包，对应同日多笔银行到账。",
  多日汇总匹配: "单个订单明细包，可匹配单笔银行到账，或多个日期的银行到账汇总。",
};
const detailPackageTypeDescriptions: Record<DetailPackageType, string> = {
  "T+1": "订单明细的到账为T+1的自动形式。",
  打包明细: "订单明细打包后在指定日期到账。",
};

function formatRecognitionType(type: CounterpartyRecognitionType | string | null | undefined, packageType?: DetailPackageType | string | null) {
  if (type === "明细认账") return `明细认账（${packageType || "T+1"}）`;
  return type || "到账认账";
}

function createMatchAccount(accountNo = "", accountName = "", summary = "", purpose = "", postScript = "", bankName: BankName | "" = ""): MatchAccountDraft {
  return { bankName, accountNo, accountName, summary, purpose, postScript };
}

function getMatchAccounts(item: any): MatchAccountDraft[] {
  const accounts = Array.isArray(item.matchAccounts) ? item.matchAccounts : [];
  return accounts.map((match: any) => createMatchAccount(
    match.accountNo || "",
    match.accountName || "",
    match.summary || "",
    match.purpose || "",
    match.postScript || "",
    match.bankName || "",
  ));
}

function displaySingleMatchField(matches: MatchAccountDraft[], field: keyof MatchAccountDraft) {
  if (matches.length > 1) return "-";
  return matches[0]?.[field] || "-";
}

function RadioOption({
  value,
  title,
  description,
}: {
  value: string;
  title: string;
  description: string;
}) {
  return (
    <label className="flex min-h-[74px] cursor-pointer gap-3 rounded-md border border-gray-200 bg-white p-3 text-sm transition-colors hover:border-blue-300 hover:bg-blue-50/40 has-[[data-state=checked]]:border-blue-500 has-[[data-state=checked]]:bg-blue-50">
      <RadioGroupItem value={value} className="mt-0.5" />
      <span className="space-y-1">
        <span className="block font-medium text-gray-800">{title}</span>
        <span className="block leading-5 text-gray-500">{description}</span>
      </span>
    </label>
  );
}

function SimpleRadioOption({
  value,
  title,
}: {
  value: string;
  title: string;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-gray-200 bg-white p-3 text-sm transition-colors hover:border-blue-300 hover:bg-blue-50/40 has-[[data-state=checked]]:border-blue-500 has-[[data-state=checked]]:bg-blue-50">
      <RadioGroupItem value={value} />
      <span className="font-medium text-gray-800">{title}</span>
    </label>
  );
}

export default function CounterpartySummaryPage() {
  const { hasPermission } = usePermissions();
  const canDeleteArrivalInfo = hasPermission("arrival_info_delete");
  const [activeTab, setActiveTab] = useState("recorded");
  const [recordedPage, setRecordedPage] = useState(1);
  const [unrecordedPage, setUnrecordedPage] = useState(1);
  const [recognitionTypeFilter, setRecognitionTypeFilter] = useState<RecognitionTypeFilter>("all");

  const [recordFormMode, setRecordFormMode] = useState<"record" | "edit" | null>(null);
  const [editRecordId, setEditRecordId] = useState<number | null>(null);
  const [recordAlias, setRecordAlias] = useState("");
  const [recordRecognitionType, setRecordRecognitionType] = useState<CounterpartyRecognitionType>("到账认账");
  const [recordDetailPackageType, setRecordDetailPackageType] = useState<DetailPackageType>("T+1");
  const [recordDetailMatchingMode, setRecordDetailMatchingMode] = useState<DetailMatchingMode>("单笔匹配");
  const [recordArrivalRegion, setRecordArrivalRegion] = useState<ArrivalRegion>("北京市");
  const [recordMatchAccounts, setRecordMatchAccounts] = useState<MatchAccountDraft[]>([createMatchAccount()]);
  const [recordVoucherIncomeName, setRecordVoucherIncomeName] = useState("");
  const [pendingRecord, setPendingRecord] = useState<{
    id?: number;
    bankName: BankName | null;
    accountNo: string;
    accountName: string | null;
    summary: string | null;
    purpose: string | null;
    postScript: string | null;
  } | null>(null);

  const utils = trpc.useUtils();

  const resetRecordForm = () => {
    setRecordFormMode(null);
    setEditRecordId(null);
    setRecordAlias("");
    setRecordRecognitionType("到账认账");
    setRecordDetailPackageType("T+1");
    setRecordDetailMatchingMode("单笔匹配");
    setRecordArrivalRegion("北京市");
    setRecordMatchAccounts([createMatchAccount()]);
    setRecordVoucherIncomeName("");
    setPendingRecord(null);
  };

  const recordedQuery = trpc.counterparty.listRecorded.useQuery(
    {
      page: recordedPage,
      pageSize: 100,
      recognitionType: recognitionTypeFilter === "all" ? undefined : recognitionTypeFilter,
    },
    { enabled: activeTab === "recorded" }
  );
  const unrecordedQuery = trpc.counterparty.listUnrecorded.useQuery(
    { page: unrecordedPage, pageSize: 100 },
    { enabled: activeTab === "unrecorded" }
  );
  const statsQuery = trpc.counterparty.stats.useQuery();
  const voucherReceiptChannelsQuery = trpc.counterparty.listVoucherReceiptChannels.useQuery(
    undefined,
    { enabled: Boolean(recordFormMode) }
  );

  const recordMutation = trpc.counterparty.record.useMutation({
    onSuccess: () => {
      utils.counterparty.listRecorded.invalidate();
      utils.counterparty.listUnrecorded.invalidate();
      utils.counterparty.stats.invalidate();
      toast.success("记录成功");
      resetRecordForm();
    },
    onError: (err: any) => {
      toast.error(err.message || "记录失败");
    },
  });

  const updateMutation = trpc.counterparty.update.useMutation({
    onSuccess: () => {
      utils.counterparty.listRecorded.invalidate();
      utils.counterparty.listUnrecorded.invalidate();
      utils.counterparty.stats.invalidate();
      toast.success("更新成功");
      resetRecordForm();
    },
    onError: (err: any) => {
      toast.error(err.message || "更新失败");
    },
  });

  const deleteMutation = trpc.counterparty.delete.useMutation({
    onSuccess: () => {
      utils.counterparty.listRecorded.invalidate();
      utils.counterparty.stats.invalidate();
      toast.success("已删除");
    },
    onError: (err: any) => toast.error(err.message || "删除失败"),
  });

  const dedupMutation = trpc.counterparty.dailyDedup.useMutation({
    onSuccess: (data) => {
      utils.counterparty.listUnrecorded.invalidate();
      utils.counterparty.stats.invalidate();
      toast.success(`同步完成，共 ${data.synced || 0} 条未记录`);
    },
    onError: (err: any) => toast.error(err.message || "同步失败"),
  });

  const openRecordDialog = (item: {
    id?: number;
    bankName: BankName | null;
    accountNo: string;
    accountName: string | null;
    summary: string | null;
    purpose: string | null;
    postScript: string | null;
  }) => {
    setEditRecordId(null);
    setPendingRecord(item);
    setRecordAlias("");
    setRecordRecognitionType("到账认账");
    setRecordDetailPackageType("T+1");
    setRecordDetailMatchingMode("单笔匹配");
    setRecordArrivalRegion("北京市");
    setRecordMatchAccounts([createMatchAccount(item.accountNo || "", item.accountName || "", item.summary || "", item.purpose || "", item.postScript || "", item.bankName || "")]);
    setRecordVoucherIncomeName("");
    setRecordFormMode("record");
  };

  const openNewRecord = () => {
    openRecordDialog({
      bankName: null,
      accountNo: "",
      accountName: null,
      summary: null,
      purpose: null,
      postScript: null,
    });
  };

  const openEditDialog = (item: any) => {
    const matchAccounts = Array.isArray(item.matchAccounts) && item.matchAccounts.length > 0
      ? item.matchAccounts.map((match: any) => createMatchAccount(
        match.accountNo || "",
        match.accountName || "",
        match.summary || "",
        match.purpose || "",
        match.postScript || "",
        match.bankName || "",
      ))
      : [createMatchAccount()];
    const primary = matchAccounts[0];
    setEditRecordId(item.id);
    setPendingRecord({
      bankName: primary.bankName || null,
      accountNo: primary.accountNo,
      accountName: primary.accountName || null,
      summary: primary.summary || null,
      purpose: primary.purpose || null,
      postScript: primary.postScript || null,
    });
    setRecordAlias(item.alias || "");
    setRecordRecognitionType(item.recognitionType === "明细认账" ? "明细认账" : "到账认账");
    setRecordDetailPackageType(item.detailPackageType === "打包明细" ? "打包明细" : "T+1");
    setRecordDetailMatchingMode(detailMatchingModeOptions.includes(item.detailMatchingMode) ? item.detailMatchingMode : "单笔匹配");
    setRecordArrivalRegion(arrivalRegionOptions.includes(item.arrivalRegion) ? item.arrivalRegion : "北京市");
    setRecordMatchAccounts(matchAccounts);
    setRecordVoucherIncomeName(item.voucherIncomeName || "");
    setRecordFormMode("edit");
  };

  const updateMatchAccount = <K extends keyof MatchAccountDraft>(index: number, field: K, value: MatchAccountDraft[K]) => {
    setRecordMatchAccounts((items) => items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, [field]: value } : item
    ));
  };

  const addMatchAccount = () => {
    setRecordMatchAccounts((items) => [...items, createMatchAccount()]);
  };

  const removeMatchAccount = (index: number) => {
    setRecordMatchAccounts((items) => items.length > 1 ? items.filter((_, itemIndex) => itemIndex !== index) : items);
  };

  const handleRecord = () => {
    if (!pendingRecord) return;
    const alias = recordAlias.trim();
    if (!alias) {
      toast.error("请输入到账别称");
      return;
    }
    const matchAccounts = recordMatchAccounts
      .map((item) => ({
        bankName: item.bankName || null,
        accountNo: item.accountNo.trim(),
        accountName: item.accountName.trim() || null,
        summary: item.summary.trim() || null,
        purpose: item.purpose.trim() || null,
        postScript: item.postScript.trim() || null,
      }));
    const invalidMatchIndex = matchAccounts.findIndex((item) => ![
      item.bankName,
      item.accountNo,
      item.accountName,
      item.summary,
      item.purpose,
      item.postScript,
    ].some(Boolean));
    if (invalidMatchIndex >= 0) {
      toast.error(`匹配条件 ${invalidMatchIndex + 1} 至少填写银行、对方账号/付款人账号、对方户名/对方单位/付款人名称、摘要、用途/备注或附言/交易附言中的一项`);
      return;
    }
    if (editRecordId) {
      updateMutation.mutate({
        id: editRecordId,
        alias,
        recognitionType: recordRecognitionType,
        detailMatchingMode: recordDetailMatchingMode,
        arrivalRegion: recordArrivalRegion,
        detailPackageType: recordDetailPackageType,
        voucherIncomeName: recordVoucherIncomeName.trim() || null,
        matchAccounts,
      });
      return;
    }
    recordMutation.mutate({
      alias,
      recognitionType: recordRecognitionType,
      detailMatchingMode: recordDetailMatchingMode,
      arrivalRegion: recordArrivalRegion,
      detailPackageType: recordDetailPackageType,
      voucherIncomeName: recordVoucherIncomeName.trim() || null,
      matchAccounts,
      unrecordedId: pendingRecord.id,
    });
  };

  if (recordFormMode && pendingRecord) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="h-8 px-3" onClick={resetRecordForm}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              返回
            </Button>
            <h1 className="text-xl font-semibold">{recordFormMode === "edit" ? "编辑到账信息" : "记录到账信息"}</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={resetRecordForm}>
              取消
            </Button>
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700"
              onClick={handleRecord}
              disabled={
                recordMutation.isPending
                || updateMutation.isPending
                || !recordAlias.trim()
                || recordMatchAccounts.some((item) => ![
                  item.bankName,
                  item.accountNo,
                  item.accountName,
                  item.summary,
                  item.purpose,
                  item.postScript,
                ].some((value) => value.trim()))
              }
            >
              {recordMutation.isPending || updateMutation.isPending ? "保存中..." : recordFormMode === "edit" ? "保存修改" : "确认记录"}
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="space-y-6 p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  到账别称 <span className="text-red-500">*</span>
                </label>
                <Input
                  value={recordAlias}
                  onChange={(e) => setRecordAlias(e.target.value)}
                  placeholder="请输入唯一名称（如：阿里巴巴捐赠）"
                  autoFocus
                />
                <p className="text-xs text-gray-400">到账别称必须唯一，不可重复</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">凭证收款渠道</label>
                <div className="relative">
                  <Select
                    value={recordVoucherIncomeName}
                    onValueChange={setRecordVoucherIncomeName}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={voucherReceiptChannelsQuery.isLoading ? "加载渠道中..." : "请选择凭证收款渠道"} />
                    </SelectTrigger>
                    <SelectContent>
                      {voucherReceiptChannelsQuery.data?.items.map((item: any) => (
                        <SelectItem key={item.id} value={item.channelCode}>
                          {item.channelName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {recordVoucherIncomeName && (
                    <button
                      type="button"
                      title="清空凭证收款渠道"
                      aria-label="清空凭证收款渠道"
                      className="absolute right-8 top-1/2 z-10 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        setRecordVoucherIncomeName("");
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-400">用于制单时的收款渠道</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">匹配条件</span>
                <Button type="button" size="sm" variant="outline" className="h-7 px-2" onClick={addMatchAccount}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  新增
                </Button>
              </div>
              <p className="text-xs text-gray-400">银行和其他空字段不参与匹配；同一组内已填写字段需全部命中，多组条件任意一组命中即可。</p>
              <div className="space-y-2">
                {recordMatchAccounts.map((match, index) => (
                  <div key={index} className="rounded-md border p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs text-gray-500">条件 {index + 1}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-red-500"
                        onClick={() => removeMatchAccount(index)}
                        disabled={recordMatchAccounts.length <= 1}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="grid gap-3 text-sm md:grid-cols-2">
                      <div>
                        <span className="text-gray-500">到账银行</span>
                        <Select
                          value={match.bankName || "__any_bank"}
                          onValueChange={(value) => updateMatchAccount(index, "bankName", value === "__any_bank" ? "" : value as BankName)}
                        >
                          <SelectTrigger className="mt-1 w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__any_bank">不限制银行</SelectItem>
                            {bankNameOptions.map((bankName) => (
                              <SelectItem key={bankName} value={bankName}>{bankName}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <span className="text-gray-500">对方账号/付款人账号（选填）</span>
                        <Input
                          value={match.accountNo}
                          onChange={(e) => updateMatchAccount(index, "accountNo", e.target.value)}
                          placeholder="可填写对方账号或付款人账号"
                          className="mt-1 font-mono"
                        />
                      </div>
                      <div>
                        <span className="text-gray-500">对方户名/对方单位/付款人名称（选填）</span>
                        <Input
                          value={match.accountName}
                          onChange={(e) => updateMatchAccount(index, "accountName", e.target.value)}
                          placeholder="可填写对方户名、对方单位或付款人名称"
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <span className="text-gray-500">摘要</span>
                        <Input
                          value={match.summary}
                          onChange={(e) => updateMatchAccount(index, "summary", e.target.value)}
                          placeholder="可填写摘要关键字"
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <span className="text-gray-500">用途/备注</span>
                        <Input
                          value={match.purpose}
                          onChange={(e) => updateMatchAccount(index, "purpose", e.target.value)}
                          placeholder="可填写用途或备注关键字"
                          className="mt-1"
                        />
                      </div>
                      <div>
                        <span className="text-gray-500">附言/交易附言</span>
                        <Input
                          value={match.postScript}
                          onChange={(e) => updateMatchAccount(index, "postScript", e.target.value)}
                          placeholder="可填写附言或交易附言关键字"
                          className="mt-1"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-5">
              <section className="space-y-2">
                <span className="text-sm font-medium text-gray-700">认账类型</span>
                <RadioGroup
                  value={recordRecognitionType}
                  onValueChange={(value) => {
                    const nextType = value as CounterpartyRecognitionType;
                    setRecordRecognitionType(nextType);
                    if (nextType !== "明细认账") {
                      setRecordDetailPackageType("T+1");
                      setRecordDetailMatchingMode("单笔匹配");
                    }
                  }}
                  className="grid gap-2 sm:grid-cols-2"
                >
                  {recognitionTypeOptions.map((type) => (
                    <RadioOption key={type} value={type} title={type} description={recognitionTypeDescriptions[type]} />
                  ))}
                </RadioGroup>
              </section>

              <section className="space-y-2">
                <span className="text-sm font-medium text-gray-700">{recordRecognitionType === "到账认账" ? "渠道认账地区" : "到账地区"}</span>
                <RadioGroup value={recordArrivalRegion} onValueChange={(value) => setRecordArrivalRegion(value as ArrivalRegion)} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {arrivalRegionOptions.map((region) => (
                    <SimpleRadioOption key={region} value={region} title={region} />
                  ))}
                </RadioGroup>
              </section>

              {recordRecognitionType === "明细认账" && (
                <>
                  <section className="space-y-2">
                    <span className="text-sm font-medium text-gray-700">明细匹配到账方式</span>
                    <RadioGroup
                      value={recordDetailMatchingMode}
                      onValueChange={(value) => {
                        const nextMode = value as DetailMatchingMode;
                        setRecordDetailMatchingMode(nextMode);
                        if (nextMode === "多日汇总匹配") setRecordDetailPackageType("打包明细");
                      }}
                      className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
                    >
                      {detailMatchingModeOptions.map((mode) => (
                        <RadioOption key={mode} value={mode} title={mode} description={detailMatchingModeDescriptions[mode]} />
                      ))}
                    </RadioGroup>
                  </section>
                  <section className="space-y-2">
                    <span className="text-sm font-medium text-gray-700">明细包类型</span>
                    <RadioGroup
                      value={recordDetailPackageType}
                      onValueChange={(value) => setRecordDetailPackageType(value as DetailPackageType)}
                      className="grid gap-2 sm:grid-cols-2"
                      disabled={recordDetailMatchingMode === "多日汇总匹配"}
                    >
                      {detailPackageTypeOptions.map((type) => (
                        <RadioOption key={type} value={type} title={type} description={detailPackageTypeDescriptions[type]} />
                      ))}
                    </RadioGroup>
                    {recordDetailMatchingMode === "多日汇总匹配" && (
                      <p className="text-xs text-gray-400">多日汇总匹配固定使用打包明细。</p>
                    )}
                  </section>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">到账信息汇总</h1>
        <div className="flex gap-3 text-sm text-gray-500">
          <div className="flex items-center gap-1">
            <CheckCircle className="h-4 w-4 text-green-600" />
            已记录: <span className="font-medium text-gray-700">{statsQuery.data?.recordedCount || 0}</span>
          </div>
          <div className="flex items-center gap-1">
            <Landmark className="h-4 w-4 text-blue-600" />
            银行流水: <span className="font-medium text-gray-700">{statsQuery.data?.totalFlowCount || 0}</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="recorded">
              <CheckCircle className="h-4 w-4 mr-1" />
              已记录 ({statsQuery.data?.recordedCount || 0})
            </TabsTrigger>
            <TabsTrigger value="unrecorded">
              <Plus className="h-4 w-4 mr-1" />
              未记录 ({statsQuery.data?.unrecordedCount || 0})
            </TabsTrigger>
          </TabsList>
          <Button type="button" size="sm" variant="outline" className="ml-auto h-8 shrink-0" onClick={openNewRecord}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            新增到账信息
          </Button>
        </div>

        {/* 已记录 Tab */}
        <TabsContent value="recorded">
          <Card>
            <CardContent className="p-0">
              <div className="flex flex-col gap-3 p-4 pb-0 md:flex-row md:items-center md:justify-between">
                <div className="text-sm text-gray-500">
                  共 {recordedQuery.data?.total || 0} 条
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">认账类型</span>
                  <Select
                    value={recognitionTypeFilter}
                    onValueChange={(value) => {
                      setRecognitionTypeFilter(value as RecognitionTypeFilter);
                      setRecordedPage(1);
                    }}
                  >
                    <SelectTrigger className="h-8 w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部</SelectItem>
                      {recognitionTypeOptions.map((type) => (
                        <SelectItem key={type} value={type}>{type}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="overflow-auto">
                <Table className="w-max min-w-full table-auto">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">到账别称</TableHead>
                      <TableHead className="w-28 min-w-[100px]">认账类型</TableHead>
                      <TableHead className="w-32 min-w-[120px]">到账匹配方式</TableHead>
                      <TableHead className="w-40 min-w-[160px]">匹配条件</TableHead>
                      <TableHead className="w-28 min-w-[100px]">地区</TableHead>
                      <TableHead className="w-28 min-w-[110px]">到账银行</TableHead>
                      <TableHead className="w-40 min-w-[160px]">对方账号</TableHead>
                      <TableHead className="w-36 min-w-[120px]">对方户名</TableHead>
                      <TableHead className="w-32 min-w-[100px]">摘要</TableHead>
                      <TableHead className="w-32 min-w-[100px]">用途</TableHead>
                      <TableHead className="w-32 min-w-[100px]">附言</TableHead>
                      <TableHead className="sticky right-0 z-20 w-24 min-w-[96px] bg-white shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recordedQuery.isLoading ? (
                      <TableRow>
                        <TableCell colSpan={12} className="text-center py-8">加载中...</TableCell>
                      </TableRow>
                    ) : recordedQuery.data?.items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={12} className="text-center py-8 text-gray-400">暂无已记录信息</TableCell>
                      </TableRow>
                    ) : (
                      recordedQuery.data?.items.map((item: any) => {
                        const matches = getMatchAccounts(item);
                        return (
                        <TableRow key={item.id}>
                          <TableCell className="whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <Tag className="h-3.5 w-3.5 text-blue-600 flex-shrink-0" />
                              <span className="font-medium text-blue-700">{item.alias}</span>
                            </div>
                          </TableCell>
                          <TableCell>{formatRecognitionType(item.recognitionType, item.detailPackageType)}</TableCell>
                          <TableCell>{item.recognitionType === "明细认账" ? item.detailMatchingMode || "单笔匹配" : "-"}</TableCell>
                          <TableCell>{matches.length} 组</TableCell>
                          <TableCell>{item.arrivalRegion || "-"}</TableCell>
                          <TableCell>{matches.length > 1 ? "多组" : displaySingleMatchField(matches, "bankName") === "-" ? "不限制" : displaySingleMatchField(matches, "bankName")}</TableCell>
                          <TableCell className="font-mono text-sm truncate">{displaySingleMatchField(matches, "accountNo")}</TableCell>
                          <TableCell className="truncate">{displaySingleMatchField(matches, "accountName")}</TableCell>
                          <TableCell className="truncate">{displaySingleMatchField(matches, "summary")}</TableCell>
                          <TableCell className="truncate">{displaySingleMatchField(matches, "purpose")}</TableCell>
                          <TableCell className="truncate">{displaySingleMatchField(matches, "postScript")}</TableCell>
                          <TableCell className="sticky right-0 z-10 bg-white shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]">
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-blue-600 h-7 w-7 p-0"
                                onClick={() => openEditDialog(item)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className={`h-7 w-7 p-0 ${canDeleteArrivalInfo ? "text-red-500 hover:text-red-700" : "text-gray-300"}`}
                                disabled={!canDeleteArrivalInfo}
                                title={canDeleteArrivalInfo ? "删除" : "无删除权限"}
                                onClick={() => {
                                  if (confirm("确定删除此记录？")) {
                                    deleteMutation.mutate({ id: item.id });
                                  }
                                }}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
              {recordedQuery.data && recordedQuery.data.total > 100 && (
                <div className="flex justify-center p-4 gap-2">
                  <Button variant="outline" size="sm" onClick={() => setRecordedPage((p) => Math.max(1, p - 1))} disabled={recordedPage === 1}>上一页</Button>
                  <span className="text-sm text-gray-500 self-center">第 {recordedPage} 页</span>
                  <Button variant="outline" size="sm" onClick={() => setRecordedPage((p) => p + 1)} disabled={recordedPage * 100 >= (recordedQuery.data?.total || 0)}>下一页</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 未记录 Tab */}
        <TabsContent value="unrecorded">
          <Card>
            <CardContent className="p-0">
              <div className="flex items-center justify-between p-4 pb-0">
                <div className="text-sm text-gray-500">
                  共 {unrecordedQuery.data?.total || 0} 条
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-blue-600 border-blue-300 hover:bg-blue-50"
                  onClick={() => dedupMutation.mutate()}
                  disabled={dedupMutation.isPending}
                >
                  <Landmark className="h-3.5 w-3.5 mr-1" />
                  {dedupMutation.isPending ? "同步中..." : "同步未记录"}
                </Button>
              </div>
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>对方账号</TableHead>
                      <TableHead>对方户名</TableHead>
                      <TableHead>到账银行</TableHead>
                      <TableHead>摘要</TableHead>
                      <TableHead>用途</TableHead>
                      <TableHead>附言</TableHead>
                      <TableHead className="w-20">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {unrecordedQuery.isLoading ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8">加载中...</TableCell>
                      </TableRow>
                    ) : unrecordedQuery.data?.items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-gray-400">暂无未记录信息</TableCell>
                      </TableRow>
                    ) : (
                      unrecordedQuery.data?.items.map((item: any) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-mono text-sm">{item.accountNo}</TableCell>
                          <TableCell>{item.accountName || "-"}</TableCell>
                          <TableCell>{item.bankName || "-"}</TableCell>
                          <TableCell className="max-w-[200px] truncate">{item.summary || "-"}</TableCell>
                          <TableCell className="max-w-[200px] truncate">{item.purpose || "-"}</TableCell>
                          <TableCell className="max-w-[200px] truncate">{item.postScript || "-"}</TableCell>
                          <TableCell className="sticky right-0 z-10 bg-white shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-green-600 border-green-300 hover:bg-green-50"
                              onClick={() => openRecordDialog(item)}
                              disabled={recordMutation.isPending}
                            >
                              <Plus className="h-3.5 w-3.5 mr-1" />
                              记录
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              {unrecordedQuery.data && unrecordedQuery.data.total > 100 && (
                <div className="flex justify-center p-4 gap-2">
                  <Button variant="outline" size="sm" onClick={() => setUnrecordedPage((p) => Math.max(1, p - 1))} disabled={unrecordedPage === 1}>上一页</Button>
                  <span className="text-sm text-gray-500 self-center">第 {unrecordedPage} 页</span>
                  <Button variant="outline" size="sm" onClick={() => setUnrecordedPage((p) => p + 1)} disabled={unrecordedPage * 100 >= (unrecordedQuery.data?.total || 0)}>下一页</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
