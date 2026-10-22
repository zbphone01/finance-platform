import { and, asc, eq } from "drizzle-orm";
import { counterpartyMatchAccounts } from "@db/schema";

export type CounterpartyMatcher = {
  id?: number | null;
  bankName?: string | null;
  accountNo?: string | null;
  accountName?: string | null;
  summary?: string | null;
  purpose?: string | null;
  postScript?: string | null;
  isActive?: number | null;
  sortOrder?: number | null;
};

export type CounterpartyWithMatchers = {
  id?: number | null;
  matchAccounts?: CounterpartyMatcher[];
} & Record<string, any>;

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function keywordMatches(value: unknown, keyword: unknown) {
  const normalizedKeyword = clean(keyword);
  if (!normalizedKeyword) return true;
  return clean(value).includes(normalizedKeyword);
}

export function normalizeCounterpartyMatchers(counterparty: CounterpartyWithMatchers | null | undefined) {
  if (!counterparty) return [];
  const activeMatchAccounts = (counterparty.matchAccounts || [])
    .filter((item) => Number(item.isActive ?? 1) === 1)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || Number(a.id || 0) - Number(b.id || 0))
    .map((item) => ({
      bankName: item.bankName || "",
      accountNo: item.accountNo || "",
      accountName: item.accountName || "",
      summary: item.summary || "",
      purpose: item.purpose || "",
      postScript: item.postScript || "",
    }));

  return activeMatchAccounts;
}

export function getPrimaryCounterpartyMatcher(counterparty: CounterpartyWithMatchers | null | undefined) {
  return normalizeCounterpartyMatchers(counterparty)[0] || null;
}

export function flowMatchesCounterpartyMatcher(flow: any, matcher: CounterpartyMatcher) {
  const bankMatch = !matcher.bankName || clean(flow.bankName) === clean(matcher.bankName);
  const accountMatch = !matcher.accountNo || clean(flow.counterpartyAccount) === clean(matcher.accountNo);
  const nameMatch = !matcher.accountName || clean(flow.counterpartyName) === clean(matcher.accountName);
  const summaryMatch = keywordMatches(flow.summary, matcher.summary);
  const purposeMatch = keywordMatches(flow.purpose, matcher.purpose);
  const postScriptMatch = keywordMatches(flow.postScript, matcher.postScript);
  return bankMatch && accountMatch && nameMatch && summaryMatch && purposeMatch && postScriptMatch;
}

export function getCounterpartyMatchSpecificity(flow: any, counterparty: CounterpartyWithMatchers | null | undefined) {
  return normalizeCounterpartyMatchers(counterparty)
    .filter((matcher) => flowMatchesCounterpartyMatcher(flow, matcher))
    .reduce((highest, matcher) => Math.max(highest, [
      matcher.bankName,
      matcher.accountNo,
      matcher.accountName,
      matcher.summary,
      matcher.purpose,
      matcher.postScript,
    ].filter((value) => clean(value)).length), -1);
}

export function flowMatchesCounterpartyMatchers(flow: any, counterparty: CounterpartyWithMatchers | null | undefined) {
  return getCounterpartyMatchSpecificity(flow, counterparty) >= 0;
}

export async function attachCounterpartyMatchers<T extends CounterpartyWithMatchers | null | undefined>(db: any, counterparty: T): Promise<T extends null | undefined ? T : T & { matchAccounts: CounterpartyMatcher[] }> {
  if (!counterparty?.id) return counterparty as any;
  const matchAccounts = await db
    .select()
    .from(counterpartyMatchAccounts)
    .where(and(
      eq(counterpartyMatchAccounts.counterpartyRecordId, Number(counterparty.id)),
      eq(counterpartyMatchAccounts.isActive, 1),
    ))
    .orderBy(asc(counterpartyMatchAccounts.sortOrder), asc(counterpartyMatchAccounts.id));
  return { ...counterparty, matchAccounts } as any;
}
