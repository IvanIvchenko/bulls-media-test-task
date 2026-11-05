import type { PolicyRule } from './policy.js';

/*
 * Pure keyword ranking over a small rule set: no database, no network, deterministic.
 * TF-IDF in spirit: words found in many rules count for little, rare words for a lot,
 * and a match in the title counts double.
 */

const STOPWORDS = new Set(
  "the and for with this that have has had was were are you your our can could would should will not but all any from they them their what when where who how why about into than then there here been being its it's may must also only just very much more some such other over after before again out off too got get want need please hello thanks thank".split(
    ' ',
  ),
);

/** Lowercase words of 3+ letters, minus stopwords, with plural-s / -ed / -ing endings trimmed ("refunded" matches "refund"). */
export function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  return words
    .filter((word) => !STOPWORDS.has(word))
    .map((word) => word.replace(/(ing|ed|s)$/, (suffix) => (word.length - suffix.length >= 4 ? '' : suffix)));
}

const TITLE_WEIGHT = 2;
/** A hit must score at least this fraction of the best hit, which cuts the long tail of weak matches. */
const RELATIVE_CUTOFF = 0.5;
/** Query words found in more than this share of the rules are treated as generic and ignored. */
const MAX_DOCUMENT_FREQUENCY_SHARE = 0.5;
/** With fewer rules than this, document frequencies are too noisy to filter on. */
const MIN_RULES_FOR_GENERIC_FILTER = 4;

export interface ScoredRule {
  rule: PolicyRule;
  score: number;
}

/** Rank `rules` against `query`, best first. Ties break by rule id so the order is stable. */
export function rankRules(rules: readonly PolicyRule[], query: string, limit = 3): ScoredRule[] {
  const indexed = rules.map((rule) => ({
    rule,
    title: new Set(tokenize(rule.title)),
    body: new Set(tokenize(rule.text)),
  }));
  const documentFrequency = (token: string) =>
    indexed.filter((entry) => entry.title.has(token) || entry.body.has(token)).length;

  // A word present in most rules ("refund") cannot tell them apart, so it is ignored.
  const isDiscriminating = (token: string) =>
    rules.length < MIN_RULES_FOR_GENERIC_FILTER ||
    documentFrequency(token) <= rules.length * MAX_DOCUMENT_FREQUENCY_SHARE;
  const queryTokens = [...new Set(tokenize(query))].filter(isDiscriminating);

  const scored = indexed
    .map(({ rule, title, body }) => ({
      rule,
      score: queryTokens.reduce((sum, token) => {
        const weight = title.has(token) ? TITLE_WEIGHT : body.has(token) ? 1 : 0;
        return weight === 0 ? sum : sum + weight * Math.log(1 + rules.length / documentFrequency(token));
      }, 0),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.rule.id.localeCompare(b.rule.id));

  const best = scored[0]?.score ?? 0;
  return scored.filter((entry) => entry.score >= best * RELATIVE_CUTOFF).slice(0, limit);
}

/** The rules with these ids, in rule order. Unknown ids are ignored. */
export function pickRules(rules: readonly PolicyRule[], ids: readonly string[]): PolicyRule[] {
  const wanted = new Set(ids);
  return rules.filter((rule) => wanted.has(rule.id));
}

const MAX_QUERY_CHARS = 1000;

/** Reasons that point at a specific rule get search words; the others say nothing about which policy applies. */
const REASON_WORDS: Record<string, string> = {
  defective: 'defective',
  not_as_described: 'defective not as described',
  late_delivery: 'late delivery',
};

/**
 * Query for the policy search: the customer's own words plus a few words for the refund reason. The
 * classifier's intent label is left out on purpose: "refund_request" would match every rule that mentions
 * requests. The text only influences which of our own rules are ranked; it is never executed or shown to a model.
 */
export function searchQuery(subject: string, body: string, refundReason: string | null): string {
  return `${REASON_WORDS[refundReason ?? ''] ?? ''} ${subject} ${body}`.slice(0, MAX_QUERY_CHARS);
}
