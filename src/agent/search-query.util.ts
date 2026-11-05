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
