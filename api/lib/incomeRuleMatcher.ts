import {
  flowMatchesCounterpartyMatchers,
  normalizeCounterpartyMatchers,
  type CounterpartyWithMatchers,
} from "./counterpartyMatchers";

export type IncomeRuleMatchFields = {
  matchedCounterpartyAlias?: string | null;
  accountName?: string | null;
  purpose?: string | null;
  postScript?: string | null;
};

function clean(value: unknown) {
  return String(value ?? "").trim();
}

export function getIncomeRuleConditionCount(
  rule: IncomeRuleMatchFields,
  counterparty: CounterpartyWithMatchers | null | undefined,
) {
  if (rule.matchedCounterpartyAlias && counterparty) {
    return Math.max(0, ...normalizeCounterpartyMatchers(counterparty).map((matcher) =>
      [matcher.bankName, matcher.accountNo, matcher.accountName, matcher.summary, matcher.purpose, matcher.postScript]
        .filter((value) => clean(value)).length
    ));
  }
  return [rule.accountName, rule.purpose, rule.postScript].filter((value) => clean(value)).length;
}

export function flowMatchesIncomeRule(
  flow: any,
  rule: IncomeRuleMatchFields,
  counterparty: CounterpartyWithMatchers | null | undefined,
) {
  if (rule.matchedCounterpartyAlias && counterparty) {
    return flowMatchesCounterpartyMatchers(flow, counterparty);
  }

  const nameMatch = !rule.accountName || clean(flow.counterpartyName) === clean(rule.accountName);
  const purposeMatch = !rule.purpose || clean(flow.purpose).includes(clean(rule.purpose));
  const postScriptMatch = !rule.postScript || clean(flow.postScript).includes(clean(rule.postScript));
  return nameMatch && purposeMatch && postScriptMatch;
}
