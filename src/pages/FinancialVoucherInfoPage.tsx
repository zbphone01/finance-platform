import { useEffect, useState } from "react";
import type {
  VoucherTemplateRow,
  VoucherTemplateSet,
  VoucherTemplateSettingsValue,
  VoucherTemplateType,
} from "@db/schema";
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
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const templateColumns: Array<keyof VoucherTemplateRow> = ["摘要", "科目编码", "科目名称", "借方金额", "贷方金额"];
const templateColumnWidths: Record<keyof VoucherTemplateRow, string> = {
  摘要: "w-[35%]",
  科目编码: "w-[14%]",
  科目名称: "w-[17%]",
  借方金额: "w-[12.5%]",
  贷方金额: "w-[12.5%]",
};
const templateRowPurposes = ["凭证总览", "项目资金", "管理费"];
const templateTypes: VoucherTemplateType[] = ["捐赠收入-到账认账模版", "捐赠收入-明细认账模版", "会费收入", "利息收入"];

const emptyRow = (): VoucherTemplateRow => ({
  摘要: "",
  科目编码: "",
  科目名称: "",
  借方金额: "",
  贷方金额: "",
});

const createRows = (summary = ""): VoucherTemplateRow[] => [
  { ...emptyRow(), 摘要: summary },
  emptyRow(),
  emptyRow(),
];

const initialTemplates: VoucherTemplateSettingsValue = {
  "捐赠收入-到账认账模版": [{
    id: "donation-arrival-default",
    name: "默认模板",
    rows: createRows("收到【凭证收款渠道名称】捐赠收入【订单明细总计】笔"),
  }],
  "捐赠收入-明细认账模版": [{
    id: "donation-detail-default",
    name: "默认模板",
    rows: createRows(),
  }],
  会费收入: [{
    id: "membership-default",
    name: "默认模板",
    rows: createRows(),
  }],
  利息收入: [{
    id: "interest-default",
    name: "默认模板",
    rows: createRows(),
  }],
};

const variableDescriptions = [
  ["【到账户名】", "银行流水中的对方户名"],
  ["【银行】", "银行流水中的银行名称"],
  ["【到账月份】", "银行流水的到账月份信息，格式示例“2026年7月”"],
  ["【季度】", "银行流水的到账月份对应的季度，如“第一季度”"],
  ["【捐赠活动】", "入账结果中支出资金来源的最后一个字段，如“日常捐赠”"],
  ["【NC项目名称】", "入账结果中的NC项目名称（不带编号）"],
  ["【管理费比例】", "入账结果的管理费比例"],
  ["【管理费】", "入账结果的管理费"],
  ["【凭证收款渠道名称】", "到账信息中选择的凭证收款渠道名称"],
  ["【订单明细总计】", "该银行流水对应的所有入账结果的订单明细和"],
  ["【入账金额】", "入账结果的入账金额"],
  ["【分账金额】", "认账进行分账时，入账结果的分账金额"],
  ["【公益平台】", "入账结果的公益平台"],
  ["【项目详情】", "入账结果的项目详情（不带编号）"],
  ["【订单明细数】", "入账结果的订单明细数"],
  ["【项目资金】", "入账结果的项目资金"],
  ["【会员姓名】", "入账结果的会员姓名"],
  ["【缴纳年限】", "会费收入认账时填写的（会费）缴纳年限"],
];

function createTemplateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `template-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function cloneRows(rows: VoucherTemplateRow[]) {
  return rows.map((row) => ({ ...row }));
}

function makeUniqueCopyName(templates: VoucherTemplateSet[], sourceName: string) {
  const names = new Set(templates.map((item) => item.name.trim().toLocaleLowerCase("zh-CN")));
  const baseName = `${sourceName.trim() || "未命名模板"} 副本`;
  if (!names.has(baseName.toLocaleLowerCase("zh-CN"))) return baseName;
  let index = 2;
  while (names.has(`${baseName} ${index}`.toLocaleLowerCase("zh-CN"))) index += 1;
  return `${baseName} ${index}`;
}

export default function FinancialVoucherInfoPage() {
  const [templates, setTemplates] = useState<VoucherTemplateSettingsValue>(initialTemplates);
  const [savedTemplates, setSavedTemplates] = useState<VoucherTemplateSettingsValue | null>(null);
  const [renameTarget, setRenameTarget] = useState<{
    templateType: VoucherTemplateType;
    templateId: string;
  } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const utils = trpc.useUtils();
  const templateQuery = trpc.voucherTemplate.get.useQuery();
  const saveTemplate = trpc.voucherTemplate.save.useMutation({
    onSuccess: async () => {
      await utils.voucherTemplate.get.invalidate();
      toast.success("凭证模板已保存");
    },
    onError: (err: any) => toast.error(err.message || "保存失败"),
  });

  useEffect(() => {
    if (templateQuery.data?.templates) {
      setTemplates(templateQuery.data.templates);
      setSavedTemplates(templateQuery.data.templates);
    }
  }, [templateQuery.data?.templates]);

  const hasTemplateChanges = savedTemplates !== null
    && JSON.stringify(templates) !== JSON.stringify(savedTemplates);

  const updateTemplate = (
    templateType: VoucherTemplateType,
    templateId: string,
    updater: (template: VoucherTemplateSet) => VoucherTemplateSet,
  ) => {
    setTemplates((current) => ({
      ...current,
      [templateType]: current[templateType].map((template) =>
        template.id === templateId ? updater(template) : template,
      ),
    }));
  };

  const updateCell = (
    templateType: VoucherTemplateType,
    templateId: string,
    rowIndex: number,
    column: keyof VoucherTemplateRow,
    value: string,
  ) => {
    updateTemplate(templateType, templateId, (template) => ({
      ...template,
      rows: template.rows.map((row, index) =>
        index === rowIndex ? { ...row, [column]: value } : row,
      ),
    }));
  };

  const addTemplate = (templateType: VoucherTemplateType) => {
    const next: VoucherTemplateSet = {
      id: createTemplateId(),
      name: `新模板 ${templates[templateType].length + 1}`,
      rows: createRows(),
    };
    setTemplates((current) => ({
      ...current,
      [templateType]: [...current[templateType], next],
    }));
  };

  const copyTemplate = (templateType: VoucherTemplateType, source: VoucherTemplateSet) => {
    setTemplates((current) => ({
      ...current,
      [templateType]: [
        ...current[templateType],
        {
          id: createTemplateId(),
          name: makeUniqueCopyName(current[templateType], source.name),
          rows: cloneRows(source.rows),
        },
      ],
    }));
  };

  const openRenameDialog = (templateType: VoucherTemplateType, template: VoucherTemplateSet) => {
    setRenameTarget({ templateType, templateId: template.id });
    setRenameValue(template.name);
  };

  const confirmRename = () => {
    if (!renameTarget) return;
    const nextName = renameValue.trim();
    if (!nextName) {
      toast.error("请输入模板名称");
      return;
    }
    const duplicated = templates[renameTarget.templateType].some((template) =>
      template.id !== renameTarget.templateId
      && template.name.trim().toLocaleLowerCase("zh-CN") === nextName.toLocaleLowerCase("zh-CN")
    );
    if (duplicated) {
      toast.error(`${renameTarget.templateType}的模板名称不能重复`);
      return;
    }
    updateTemplate(renameTarget.templateType, renameTarget.templateId, (template) => ({
      ...template,
      name: nextName,
    }));
    setRenameTarget(null);
    setRenameValue("");
  };

  const deleteTemplate = (templateType: VoucherTemplateType, templateId: string) => {
    if (templates[templateType].length <= 1) {
      toast.error("每个凭证种类至少保留一套模板");
      return;
    }
    setTemplates((current) => ({
      ...current,
      [templateType]: current[templateType].filter((template) => template.id !== templateId),
    }));
  };

  const handleSave = () => {
    for (const templateType of templateTypes) {
      const names = templates[templateType].map((item) => item.name.trim());
      if (names.some((name) => !name)) {
        toast.error(`${templateType}存在未填写名称的模板`);
        return;
      }
      const normalizedNames = names.map((name) => name.toLocaleLowerCase("zh-CN"));
      if (new Set(normalizedNames).size !== normalizedNames.length) {
        toast.error(`${templateType}的模板名称不能重复`);
        return;
      }
    }
    saveTemplate.mutate({ templates });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">凭证模板</h1>
          <p className="mt-1 text-sm text-gray-500">每个凭证种类可以维护多套具名模板，制单时按模板名称选择。</p>
        </div>
        {hasTemplateChanges && (
          <Button
            variant="destructive"
            onClick={handleSave}
            disabled={templateQuery.isLoading || saveTemplate.isPending}
          >
            {saveTemplate.isPending ? "保存中..." : "保存全部模板"}
          </Button>
        )}
      </div>

      <section className="space-y-4">
        {templateTypes.map((templateType) => (
          <Card key={templateType}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">{templateType}</h2>
                  <p className="mt-1 text-xs text-gray-500">共 {templates[templateType].length} 套模板，每套固定三行。</p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => addTemplate(templateType)}>
                  <Plus className="mr-1 h-4 w-4" />
                  新增模板
                </Button>
              </div>

              <Accordion
                type="multiple"
                className="divide-y"
              >
                {templates[templateType].map((template) => (
                  <AccordionItem key={template.id} value={template.id} className="border-0">
                    <div className="flex flex-wrap items-center gap-1">
                      <AccordionTrigger className="min-w-0 flex-1 hover:no-underline">
                        <div className="min-w-0">
                          <span className="truncate font-medium">{template.name || "未命名模板"}</span>
                        </div>
                      </AccordionTrigger>
                      <div className="ml-auto flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2 text-xs text-gray-500 hover:text-gray-800"
                          onClick={() => openRenameDialog(templateType, template)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          改名
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2 text-xs text-gray-500 hover:text-gray-800"
                          onClick={() => copyTemplate(templateType, template)}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          复制
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2 text-xs text-red-500 hover:bg-red-50 hover:text-red-700"
                          disabled={templates[templateType].length <= 1}
                          onClick={() => deleteTemplate(templateType, template.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          删除
                        </Button>
                      </div>
                    </div>
                    <AccordionContent className="space-y-3">
                      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
                        <Table className="min-w-[980px] table-fixed">
                          <TableHeader className="bg-gray-50/80">
                            <TableRow className="hover:bg-transparent">
                              <TableHead className="h-9 w-[9%] border-r border-gray-200 px-3 text-xs font-medium text-gray-500">
                                行用途
                              </TableHead>
                              {templateColumns.map((column) => (
                                <TableHead
                                  key={column}
                                  className={`h-9 border-r border-gray-200 px-3 text-xs font-medium text-gray-700 last:border-r-0 ${templateColumnWidths[column]}`}
                                >
                                  {column}
                                </TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {template.rows.map((row, rowIndex) => (
                              <TableRow key={`${template.id}-${rowIndex}`} className="hover:bg-blue-50/20">
                                <TableCell className="border-r border-gray-200 bg-gray-50/60 px-3 py-0 align-middle text-xs font-medium text-gray-500">
                                  {templateRowPurposes[rowIndex]}
                                </TableCell>
                                {templateColumns.map((column) => {
                                  const commonClassName = "h-16 rounded-none border-0 bg-transparent px-3 text-sm shadow-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/30";
                                  return (
                                    <TableCell key={column} className="border-r border-gray-200 p-0 align-top last:border-r-0">
                                      {column === "摘要" ? (
                                        <Textarea
                                          value={row[column]}
                                          onChange={(event) => updateCell(templateType, template.id, rowIndex, column, event.target.value)}
                                          className={`${commonClassName} min-h-16 resize-none py-2.5 leading-5`}
                                        />
                                      ) : (
                                        <Input
                                          value={row[column]}
                                          onChange={(event) => updateCell(templateType, template.id, rowIndex, column, event.target.value)}
                                          className={commonClassName}
                                        />
                                      )}
                                    </TableCell>
                                  );
                                })}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-900">模板变量说明</h2>
        <Card>
          <CardContent className="p-0">
            <div className="divide-y text-sm">
              {variableDescriptions.map(([variable, description]) => (
                <div key={variable} className="grid gap-2 px-4 py-3 sm:grid-cols-[180px_1fr]">
                  <div className="font-mono font-medium text-blue-700">{variable}</div>
                  <div className="text-gray-700">{description}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <Dialog
        open={Boolean(renameTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setRenameTarget(null);
            setRenameValue("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>修改模板名称</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="voucher-template-rename" className="text-sm font-medium text-gray-700">
              模板名称
            </label>
            <Input
              id="voucher-template-rename"
              value={renameValue}
              maxLength={100}
              placeholder="请输入新名称"
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") confirmRename();
              }}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setRenameTarget(null);
                setRenameValue("");
              }}
            >
              取消
            </Button>
            <Button type="button" size="sm" onClick={confirmRename}>
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
