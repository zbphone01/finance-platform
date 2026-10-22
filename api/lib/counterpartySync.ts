import { getDb } from "../queries/connection";
import { counterpartyMatchAccounts, bankFlows, unrecordedCounterparties } from "@db/schema";
import { eq, and, sql } from "drizzle-orm";
import { flowMatchesCounterpartyMatchers } from "./counterpartyMatchers";

type CounterpartyMatcher = {
  bankName: string | null;
  accountNo: string | null;
  accountName: string | null;
  summary: string | null;
  purpose: string | null;
  postScript: string | null;
};

type BankFlowMatcher = {
  bankName: string | null;
  counterpartyAccount: string | null;
  counterpartyName: string | null;
  summary: string | null;
  purpose: string | null;
  postScript: string | null;
};

export function isRecordedCounterparty(flow: BankFlowMatcher, records: CounterpartyMatcher[]) {
  return records.some((record) => flowMatchesCounterpartyMatchers(flow, { matchAccounts: [record] }));
}

/**
 * 执行未记录到账信息的同步与滤重
 * 1. 扫描 bank_flows 补充新未记录条目
 * 2. 删除已记录但未从静态表清理的条目
 * 3. 合并重复（按 accountNo+accountName+purpose+postScript 去重）
 */
export async function runDailyDedup() {
  const db = getDb();

  // Step 1: 获取所有已记录的账号组合（用于过滤）
  const recordedMatchAccounts = await db.select({
    bankName: counterpartyMatchAccounts.bankName,
    accountNo: counterpartyMatchAccounts.accountNo,
    accountName: counterpartyMatchAccounts.accountName,
    summary: counterpartyMatchAccounts.summary,
    purpose: counterpartyMatchAccounts.purpose,
    postScript: counterpartyMatchAccounts.postScript,
  }).from(counterpartyMatchAccounts).where(eq(counterpartyMatchAccounts.isActive, 1));
  const recordedMatchers = recordedMatchAccounts;

  // Step 2: 从 bank_flows 提取所有有对方账号的流水
  const allFlows = await db.select({
    bankName: bankFlows.bankName,
    counterpartyAccount: bankFlows.counterpartyAccount,
    counterpartyName: bankFlows.counterpartyName,
    summary: bankFlows.summary,
    purpose: bankFlows.purpose,
    postScript: bankFlows.postScript,
  }).from(bankFlows).where(
    sql`${bankFlows.counterpartyAccount} IS NOT NULL AND ${bankFlows.counterpartyAccount} != ''`
  );

  // Step 3: 去重统计每个未记录组合的最近出现次数
  const flowMap = new Map<string, {
    bankName: string;
    accountNo: string;
    accountName: string;
    summary: string;
    purpose: string;
    postScript: string;
    count: number;
  }>();
  for (const f of allFlows) {
    const key = `${f.bankName}|${f.counterpartyAccount}|${f.counterpartyName || ''}|${f.summary || ''}|${f.purpose || ''}|${f.postScript || ''}`;
    if (isRecordedCounterparty(f, recordedMatchers)) continue;
    if (!flowMap.has(key)) {
      flowMap.set(key, {
        bankName: f.bankName,
        accountNo: f.counterpartyAccount!,
        accountName: f.counterpartyName || '',
        summary: f.summary || '',
        purpose: f.purpose || '',
        postScript: f.postScript || '',
        count: 0,
      });
    }
    flowMap.get(key)!.count++;
  }

  // Step 4: 清理已记录但未从静态表删除的条目
  const allUnrecorded = await db.select().from(unrecordedCounterparties);
  for (const u of allUnrecorded) {
    if (isRecordedCounterparty({
      bankName: u.bankName,
      counterpartyAccount: u.accountNo,
      counterpartyName: u.accountName || '',
      summary: u.summary || '',
      purpose: u.purpose || '',
      postScript: u.postScript || '',
    }, recordedMatchers)) {
      await db.delete(unrecordedCounterparties).where(eq(unrecordedCounterparties.id, u.id));
    }
  }

  // Step 5: 补充 bank_flows 中新出现的未记录条目到静态表（已存在则更新）
  for (const [, value] of flowMap) {
    const existing = await db.select().from(unrecordedCounterparties).where(and(
      sql`${unrecordedCounterparties.bankName} <=> ${value.bankName}`,
      eq(unrecordedCounterparties.accountNo, value.accountNo),
      eq(unrecordedCounterparties.accountName, value.accountName),
      eq(unrecordedCounterparties.summary, value.summary),
      eq(unrecordedCounterparties.purpose, value.purpose),
      eq(unrecordedCounterparties.postScript, value.postScript),
    ));
    if (existing.length > 0) {
      await db.update(unrecordedCounterparties).set({
        occurrenceCount: value.count,
        lastSeenAt: new Date(),
      }).where(eq(unrecordedCounterparties.id, existing[0].id));
    } else {
      await db.insert(unrecordedCounterparties).values({
        bankName: value.bankName,
        accountNo: value.accountNo,
        accountName: value.accountName,
        summary: value.summary,
        purpose: value.purpose,
        postScript: value.postScript,
        occurrenceCount: value.count,
      });
    }
  }

  return { synced: flowMap.size };
}
