import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  UPLOADED_INCOME_RECOGNITION_BATCH_SIZE,
  buildUploadedIncomeRecognitionRuleLookups,
  chunkUploadedIncomeRecognitionCandidates,
} from "./uploadedIncomeRecognition";

describe("uploaded income recognition batching", () => {
  it("splits 250 uploaded flows into 100, 100 and 50", () => {
    const candidates = Array.from({ length: 250 }, (_, index) => index + 1);
    const batches = chunkUploadedIncomeRecognitionCandidates(candidates);

    expect(UPLOADED_INCOME_RECOGNITION_BATCH_SIZE).toBe(100);
    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 50]);
    expect(batches.flat()).toEqual(candidates);
  });

  it("builds one rule and split lookup snapshot for all batches", () => {
    const rules = [
      { id: 7, matchedCounterpartyAlias: "平台到账" },
      { id: 8, matchedCounterpartyAlias: "银行直捐" },
    ];
    const splits = [
      { id: 70, incomeRuleId: 7 },
      { id: 71, incomeRuleId: 7 },
      { id: 80, incomeRuleId: 8 },
    ];

    const lookups = buildUploadedIncomeRecognitionRuleLookups(rules, splits);

    expect(lookups.ruleByCounterpartyAlias.get("平台到账")?.id).toBe(7);
    expect(lookups.ruleByCounterpartyAlias.get("银行直捐")?.id).toBe(8);
    expect(lookups.splitsByRuleId.get(7)?.map((split) => split.id)).toEqual([70, 71]);
    expect(lookups.splitsByRuleId.get(8)?.map((split) => split.id)).toEqual([80]);
  });

  it("rejects invalid batch sizes", () => {
    expect(() => chunkUploadedIncomeRecognitionCandidates([1], 0)).toThrow("到账认账批次大小必须是正整数");
  });

  it("loads rules once after upload and removes per-flow income recognition", () => {
    const taskRouterSource = readFileSync("api/taskRouter.ts", "utf8");
    const incomeRouterSource = readFileSync("api/incomeRuleRouter.ts", "utf8");
    const uploadStart = taskRouterSource.indexOf("  uploadBankFlowsAndCreateTasks:");
    const uploadEnd = taskRouterSource.indexOf("  uploadOrderFile:", uploadStart);
    const uploadSection = taskRouterSource.slice(uploadStart, uploadEnd);
    const batchStart = incomeRouterSource.indexOf("export async function executeUploadedIncomeRecognition");
    const batchEnd = incomeRouterSource.indexOf("/**\n * 执行到账认账核心逻辑", batchStart);
    const batchSection = incomeRouterSource.slice(batchStart, batchEnd);

    expect(uploadSection.match(/executeUploadedIncomeRecognition\(/g)).toHaveLength(1);
    expect(uploadSection).not.toContain("await executeIncomeRecognition(taskId)");
    expect(batchSection.match(/from\(incomeRecognitionRules\)/g)).toHaveLength(1);
    expect(batchSection.match(/from\(incomeRuleSplits\)/g)).toHaveLength(1);
    expect(batchSection).toContain("chunkUploadedIncomeRecognitionCandidates(uniqueCandidates)");
    expect(batchSection).toContain("ORDER BY id");
    expect(batchSection).toContain("FOR UPDATE");
  });
});
