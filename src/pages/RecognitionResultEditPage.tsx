import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ManualRecognitionForm,
  createManualSplit,
  serializeRecognitionResultAttributes,
  validateRecognitionResultAttributeSplit,
  type ManualSplit,
} from "@/components/ManualRecognitionForm";

function createRecognitionResultEditSplit(result: any): ManualSplit {
  const managementFeeType = result?.managementFeeType === "金额" ? "金额" : "比例";
  const managementFeeValue = managementFeeType === "金额"
    ? result?.managementFeeValue
    : result?.managementFeeRatio ?? result?.managementFeeValue;
  return {
    ...createManualSplit(),
    splitForm: "金额",
    splitRatio: String(result?.splitRatio ?? "100"),
    splitAmount: String(result?.splitAmount ?? "0"),
    incomeType: String(result?.incomeType || ""),
    donationSource: String(result?.donationSource || ""),
    incomeAttr: String(result?.incomeAttr || ""),
    remark: String(result?.remark || ""),
    incomeDept: String(result?.incomeDept || ""),
    budgetCode: String(result?.budgetCode || ""),
    incomeProject: String(result?.incomeProject || ""),
    platformProjectName: String(result?.platformProjectName || result?.platformProjectDisplayName || ""),
    platformProjectDetail: String(result?.platformProjectDetail || ""),
    feedbackType: String(result?.feedbackType || ""),
    memberName: String(result?.memberName || ""),
    projectCenter: String(result?.projectCenter || ""),
    membershipPaymentYears: result?.membershipPaymentYears == null ? "" : String(result.membershipPaymentYears),
    region: String(result?.region || ""),
    isAnonymous: Boolean(result?.isAnonymous),
    managementFeeType,
    managementFeeValue: String(managementFeeValue ?? "0"),
    managementFeeRatio: String(result?.managementFeeRatio ?? "0"),
    expenseFundSource: String(result?.expenseFundSource || ""),
  };
}

export default function RecognitionResultEditPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const resultId = Number(id);
  const validResultId = Number.isInteger(resultId) && resultId > 0;
  const utils = trpc.useUtils();
  const [initializedResultId, setInitializedResultId] = useState<number | null>(null);
  const [splits, setSplits] = useState<ManualSplit[]>([]);
  const [voucherReceiptChannelCode, setVoucherReceiptChannelCode] = useState("");

  const resultQuery = trpc.result.getRecognitionAttributeEdit.useQuery(
    { id: resultId },
    { enabled: validResultId },
  );
  const result = resultQuery.data;
  const isBlocked = Boolean(result?.hasVoucherLine) || result?.voucherStatus === "created";

  useEffect(() => {
    if (!result || initializedResultId === Number(result.id)) return;
    setSplits([createRecognitionResultEditSplit(result)]);
    setVoucherReceiptChannelCode(String(result.voucherReceiptChannelCode || ""));
    setInitializedResultId(Number(result.id));
  }, [initializedResultId, result]);

  const goBack = () => navigate(-1);
  const updateRecognitionAttributes = trpc.result.updateRecognitionAttributes.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.result.list.invalidate(),
        utils.result.dayGroups.invalidate(),
        utils.result.summary.invalidate(),
        utils.result.getRecognitionAttributeEdit.invalidate({ id: resultId }),
      ]);
      toast.success("认账属性已更新");
      goBack();
    },
    onError: (err: any) => toast.error(err.message || "修改认账失败"),
  });

  const handleSave = () => {
    if (!result || !splits[0] || isBlocked) return;
    const validation = validateRecognitionResultAttributeSplit(splits[0]);
    if (validation) {
      toast.error(validation.message);
      return;
    }
    updateRecognitionAttributes.mutate({
      id: resultId,
      ...serializeRecognitionResultAttributes(splits[0]),
      voucherReceiptChannelCode: voucherReceiptChannelCode || null,
    });
  };

  if (!validResultId) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" onClick={goBack}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          返回
        </Button>
        <div className="py-12 text-center text-red-500">入账结果编号无效</div>
      </div>
    );
  }

  if (resultQuery.isLoading) {
    return <div className="py-12 text-center text-gray-400">加载中...</div>;
  }

  if (resultQuery.isError || !result) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" onClick={goBack}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          返回
        </Button>
        <div className="py-12 text-center text-red-500">
          {resultQuery.error?.message || "入账结果不存在或已删除"}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={goBack} disabled={updateRecognitionAttributes.isPending}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            返回
          </Button>
          <h1 className="text-xl font-semibold">修改认账</h1>
        </div>
        {!isBlocked && (
          <Button
            disabled={updateRecognitionAttributes.isPending || !splits[0]}
            onClick={handleSave}
          >
            <Save className="mr-1 h-4 w-4" />
            {updateRecognitionAttributes.isPending ? "保存中..." : "保存修改"}
          </Button>
        )}
      </div>

      {isBlocked ? (
        <Card className="border-slate-200 bg-slate-50">
          <CardContent className="p-8 text-center text-orange-700">
            {result.hasVoucherLine
              ? "该入账结果已制单，请先取消凭证后再修改"
              : "该入账结果已锁定，请先取消锁定后再修改"}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-slate-200 bg-slate-50">
          <CardContent className="space-y-4 p-5">
            {splits[0] && (
              <ManualRecognitionForm
                attributeEditMode
                selectedFlow={result.bankFlow}
                splits={splits}
                onSplitsChange={setSplits}
                voucherReceiptChannelCode={voucherReceiptChannelCode}
                onVoucherReceiptChannelCodeChange={setVoucherReceiptChannelCode}
                splitGridClassName="grid grid-cols-1 gap-4 md:grid-cols-2"
                amountSection={(
                  <div className="grid grid-cols-1 gap-3 rounded-md border bg-gray-50 p-3 text-sm md:grid-cols-3">
                    <div>
                      <div className="text-xs text-gray-500">入账时间（不可修改）</div>
                      <div className="mt-1 font-medium">{result.entryTime || "-"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">流水号（不可修改）</div>
                      <div className="mt-1 break-all font-mono text-blue-700">
                        {result.bankFlow?.referenceNo || result.bankReferenceNo || "-"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">入账金额（不可修改）</div>
                      <div className="mt-1 font-medium text-blue-700">
                        ¥{Number(result.splitAmount || 0).toLocaleString("zh-CN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </div>
                    </div>
                  </div>
                )}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
