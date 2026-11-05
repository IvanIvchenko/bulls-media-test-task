import type { Order } from './order.js';
import type { Result } from './result.js';

export type Verdict = Result['decision'];

/** What the decision policy comes to, with its whole explanation. */
export interface Outcome {
  decision: Verdict;
  /** For the reviewer, the summary and the audit trail. */
  reasons: string[];
  /** Facts the reply may use. Already decided here; the LLM only words them. */
  facts: string[];
  citations: string[];
  refundAmount: number;
}

export const buildOutcome = (
  decision: Verdict,
  reasons: string[],
  facts: string[],
  citations: string[] = [],
  refundAmount = 0,
): Outcome => ({
  decision,
  reasons,
  facts,
  citations,
  refundAmount,
});

/** Facts are written to the customer; reasons are for the reviewer. They are never the same list. */
export const HUMAN_REVIEW_FACTS = ['A team member will review your request and reply shortly.'];

/** The customer-facing line that says which order a reply is about. */
export const orderFact = (order: Pick<Order, 'orderId' | 'item'>): string =>
  `Regarding order ${order.orderId} (${order.item}).`;
