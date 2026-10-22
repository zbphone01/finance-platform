import { and, asc, eq, inArray } from "drizzle-orm";
import { counterpartyMatchAccounts, counterpartyRecords } from "@db/schema";
import { getDb } from "../queries/connection";
import {
  getCounterpartyMatchSpecificity,
  type CounterpartyMatcher,
} from "./counterpartyMatchers";

export type BankFlowCounterparty = typeof counterpartyRecords.$inferSelect & {
  matchAccounts: CounterpartyMatcher[];
};

export type BankFlowCounterpartyResolution =
  | { kind: "matched"; counterparty: BankFlowCounterparty; aliases: [] }
  | { kind: "unmatched"; counterparty: null; aliases: [] }
  | { kind: "ambiguous"; counterparty: null; aliases: string[] };

export async function loadBankFlowCounterparties(database: any = getDb()): Promise<BankFlowCounterparty[]> {
  const db = database;
  const records = await db.select().from(counterpartyRecords);
  const recordIds = records.map((record: typeof counterpartyRecords.$inferSelect) => Number(record.id)).filter(Boolean);
  const matchRows = recordIds.length > 0
    ? await db.select().from(counterpartyMatchAccounts).where(and(
      inArray(counterpartyMatchAccounts.counterpartyRecordId, recordIds),
      eq(counterpartyMatchAccounts.isActive, 1),
    )).orderBy(
      asc(counterpartyMatchAccounts.counterpartyRecordId),
      asc(counterpartyMatchAccounts.sortOrder),
      asc(counterpartyMatchAccounts.id),
    )
    : [];
  const matchAccountsByRecordId = new Map<number, CounterpartyMatcher[]>();
  for (const row of matchRows) {
    const recordId = Number(row.counterpartyRecordId);
    const rows = matchAccountsByRecordId.get(recordId) || [];
    rows.push(row);
    matchAccountsByRecordId.set(recordId, rows);
  }
  return records.map((record: typeof counterpartyRecords.$inferSelect) => ({
    ...record,
    matchAccounts: matchAccountsByRecordId.get(Number(record.id)) || [],
  }));
}

export function resolveBankFlowCounterparty(
  flow: any,
  counterparties: BankFlowCounterparty[],
): BankFlowCounterpartyResolution {
  const matches = counterparties
    .map((counterparty) => ({
      counterparty,
      specificity: getCounterpartyMatchSpecificity(flow, counterparty),
    }))
    .filter((item) => item.specificity > 0)
    .sort((a, b) => b.specificity - a.specificity || Number(a.counterparty.id) - Number(b.counterparty.id));
  if (matches.length === 0) {
    return { kind: "unmatched", counterparty: null, aliases: [] };
  }
  const highestSpecificity = matches[0].specificity;
  const highestMatches = matches.filter((item) => item.specificity === highestSpecificity);
  if (highestMatches.length > 1) {
    return {
      kind: "ambiguous",
      counterparty: null,
      aliases: highestMatches.map((item) => item.counterparty.alias),
    };
  }
  return { kind: "matched", counterparty: matches[0].counterparty, aliases: [] };
}
