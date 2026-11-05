import { z } from 'zod';

import { FLAG } from './constants.js';
import type { OrderLookup } from './decision.js';
import { roundMoney } from './money.js';
import type { Order } from './order.js';
import { buildOutcome, HUMAN_REVIEW_FACTS, orderFact, type Outcome } from './outcome.js';
import type { Result } from './result.js';
import type { Classification } from './ticket.js';

/** What a human reviewer sends back. The reviewer decides yes or no; code decides the amount. */
export const reviewAnswerSchema = z.object({
  action: z.enum(['approve', 'deny']),
  reviewer: z.string().trim().min(1).max(80),
  note: z.string().trim().max(500).optional(),
});
export type ReviewAnswer = z.infer<typeof reviewAnswerSchema>;

/** Flags that mean the ticket cannot be acted on, whatever a reviewer says: no trustworthy order, or a hostile ticket. */
const BLOCKING_FLAGS: readonly string[] = [
  FLAG.PROMPT_INJECTION_SUSPECTED,
  FLAG.CLASSIFIER_FAILED,
  FLAG.ORDER_ID_CONFLICT,
];

export interface ReviewInput {
  decision?: string;
  lookup: OrderLookup;
  order?: Order;
  classification?: Classification;
  flags: readonly string[];
}

/**
 * Whether an escalation is one a reviewer can settle here: a refund request on a verified order, with nothing
 * hostile or ambiguous about the ticket. Anything else is handed to a human outside the agent, as before.
 */
export function reviewableEscalation(input: ReviewInput): boolean {
  return (
    input.decision === 'escalate' &&
    input.lookup === 'found' &&
    input.order !== undefined &&
    !input.order.refunded &&
    input.classification?.intent === 'refund_request' &&
    !input.flags.some((flag) => BLOCKING_FLAGS.includes(flag))
  );
}

const reviewNote = (answer: ReviewAnswer) => `${answer.reviewer}${answer.note ? `: ${answer.note}` : ''}`;

/**
 * What a reviewer's yes or no turns into. The amount is the order's, never anything the reviewer typed, and the
 * customer-facing facts never contain the reviewer's name or note (those are for the audit trail).
 */
export function reviewedOutcome(answer: ReviewAnswer, order: Order, citations: string[]): Outcome {
  if (answer.action === 'deny') {
    return buildOutcome(
      'deny',
      [`Declined after review by ${reviewNote(answer)}.`],
      [orderFact(order), 'After a review by our team, we are not able to refund this order.'],
      citations,
    );
  }
  return buildOutcome(
    'approve',
    [`Approved after review by ${reviewNote(answer)}.`],
    [orderFact(order), 'Our team reviewed your request before this was approved.'],
    citations,
    order.amount,
  );
}

/**
 * What differs between the order the reviewer was shown and the order as it is when the refund would be paid, if
 * anything that matters for paying it: the amount, the category, or an order that is no longer delivered.
 */
export function orderChangedSince(before: Order, after: Order): string | undefined {
  if (roundMoney(before.amount) !== roundMoney(after.amount)) {
    return `the amount went from ${before.amount.toFixed(2)} to ${after.amount.toFixed(2)}`;
  }
  if (before.category !== after.category) return `the category went from ${before.category} to ${after.category}`;
  if (after.status !== 'delivered') return `the status is now ${after.status}`;
  return undefined;
}

/** The reviewer approved, but the order is no longer what they approved: pay nothing and send it back to a person. */
export function orderChangedOutcome(what: string, order: Order, citations: string[]): Outcome {
  return buildOutcome(
    'escalate',
    [`The order changed after the review (${what}), so nothing was refunded. A person must look at it again.`],
    [
      orderFact(order),
      'Something about your order changed while we were reviewing it, so we need to take another look before any refund.',
      ...HUMAN_REVIEW_FACTS,
    ],
    citations,
  );
}

export interface ResumedReview {
  result: Result;
  /**
   * Whether this call's answer is the one the run used. False when an earlier attempt had already applied an answer
   * (money may have moved on it) and this call only carried the run to its end: `result.review` then names that answer.
   */
  consumed: boolean;
}

/** A run paused for a human: what the reviewer sees, and the graph thread (saved in the database) to resume. */
export interface NewReview {
  reviewId: string;
  ticketId: string;
  orderId: string;
  threadId: string;
  /** The escalation as the customer received it, with `review.status` pending. */
  request: Result;
}

export interface ReviewRecord extends NewReview {
  status: 'pending' | 'deciding' | 'resolved';
  /** Once resolved: the answer that was applied, and the final result the customer got. */
  answer?: ReviewAnswer;
  finalResult?: Result;
}

export interface ReviewSummary {
  reviewId: string;
  ticketId: string;
  summary: string;
  createdAt: Date;
  /** How many earlier tickets about this order were denied by a reviewer. */
  priorDenials: number;
}

/** A reviewer's earlier no, on another ticket about the same order. */
export interface PriorDenial {
  ticketId: string;
  reviewer: string;
  note?: string;
  decidedAt: Date;
}
