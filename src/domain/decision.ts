import { FLAG, ORDER_ID_PREFIX } from './constants.js';
import type { Eligibility } from './eligibility.js';
import { roundMoney } from './money.js';
import { refundedBy, type Order } from './order.js';
import { RULE } from './policy.js';
import { refundQuoteIsInTicket } from './refund-request.js';
import type { Result } from './result.js';
import type { ReviewAnswer } from './review.js';
import type { Classification, Ticket } from './ticket.js';

export type Verdict = Result['decision'];

/** How the order lookup went. `skipped` means no lookup was attempted. */
export type OrderLookup = 'found' | 'not_found' | 'email_mismatch' | 'no_order_id' | 'skipped';

/** Everything the decision policy looks at. A plain object, so it can be built and tested without the agent graph. */
export interface DecisionInput {
  flags: readonly string[];
  /** The customer's own words. A refund is only approved if the model's quote of the request is really in them. */
  ticket?: Pick<Ticket, 'ticketId' | 'subject' | 'body'>;
  classification?: Classification;
  lookup: OrderLookup;
  order?: Order;
  eligibility?: Eligibility;
}

export interface Outcome {
  decision: Verdict;
  reasons: string[];
  /** Facts the reply may use. Already decided here; the LLM only words them. */
  facts: string[];
  citations: string[];
  refundAmount: number;
}

const buildOutcome = (
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
const HUMAN_REVIEW_FACTS = ['A team member will review your request and reply shortly.'];

/**
 * The decision policy as a PURE function of state: no I/O, no LLM. Order of checks matters:
 * safety flags first, then scope, then order verification, then the eligibility verdict.
 */
export function decideOutcome(state: DecisionInput): Outcome {
  const { flags, classification, lookup, order, eligibility, ticket } = state;

  if (flags.includes(FLAG.CLASSIFIER_FAILED))
    return buildOutcome('escalate', ['Classifier unavailable; routed to a human.'], HUMAN_REVIEW_FACTS);
  if (flags.includes(FLAG.PROMPT_INJECTION_SUSPECTED))
    return buildOutcome(
      'escalate',
      ['Ticket contains instruction-like text aimed at the agent; routed to a human.'],
      HUMAN_REVIEW_FACTS,
    );
  if (flags.includes(FLAG.ORDER_ID_CONFLICT))
    return buildOutcome(
      'escalate',
      ['Order id in the form differs from the one in the message.'],
      ['We need a team member to confirm which order you mean.'],
    );
  if (!classification || classification.intent === 'other')
    return buildOutcome(
      'escalate',
      ['Out of scope for the agent (not a refund or order status request).'],
      ['Your request will be handled by a team member.'],
      [RULE.OUT_OF_SCOPE],
    );

  if (lookup === 'no_order_id')
    return buildOutcome(
      'info',
      ['No order id provided.'],
      [`Please reply with your order number (it starts with ${ORDER_ID_PREFIX}) so we can help.`],
    );
  if (lookup === 'not_found' || lookup === 'email_mismatch') {
    // Same outward behaviour for both cases: do not reveal whether the order exists.
    return buildOutcome(
      'refuse',
      [`Order could not be verified (${lookup}).`],
      // The same words whichever way verification failed, so the reply cannot tell the customer which it was.
      ['We could not verify this request against the account on the order.'],
      [RULE.IDENTITY],
    );
  }
  if (!order) return buildOutcome('escalate', ['Order data missing.'], HUMAN_REVIEW_FACTS);

  if (classification.intent === 'order_status') {
    const note = order.trackingNote ? ` ${order.trackingNote}.` : '';
    return buildOutcome(
      'info',
      ['Order status provided.'],
      [`Order ${order.orderId} (${order.item}) is currently ${order.status}.${note}`],
      [RULE.ORDER_STATUS],
    );
  }

  if (refundedBy(order, ticket?.ticketId)) return refundAlreadyRecordedOutcome(order);

  if (!eligibility) return buildOutcome('escalate', ['Eligibility not evaluated.'], HUMAN_REVIEW_FACTS);
  const facts = [`Regarding order ${order.orderId} (${order.item}).`, ...eligibility.facts];
  if (
    eligibility.verdict === 'approve' &&
    !(ticket && refundQuoteIsInTicket(ticket, classification.refundRequestQuote))
  ) {
    // The model says "refund request" but cannot point at the words. Never pay on its word alone.
    return buildOutcome(
      'escalate',
      [
        'The message was read as a refund request, but the quoted request is not in the ticket, so a person must check.',
      ],
      [
        `Regarding order ${order.orderId} (${order.item}).`,
        'We could not confirm from your message that you are asking for a refund.',
        ...HUMAN_REVIEW_FACTS,
      ],
    );
  }
  if (eligibility.verdict === 'approve')
    return buildOutcome('approve', eligibility.reasons, facts, eligibility.citations, order.amount);
  if (eligibility.verdict === 'deny') return buildOutcome('deny', eligibility.reasons, facts, eligibility.citations);
  return buildOutcome('escalate', eligibility.reasons, [...facts, ...HUMAN_REVIEW_FACTS], eligibility.citations);
}

/**
 * What to do when a refund the policy approved could not be recorded. The explanation replaces the approval's:
 * if the order was refunded in the meantime (another ticket, another instance) this is a denial under the
 * "already refunded" rule; anything else needs a human.
 */
export function refundFailureOutcome(reason: 'not_found' | 'already_refunded', order: Order): Outcome {
  const orderFact = `Regarding order ${order.orderId} (${order.item}).`;
  if (reason === 'already_refunded') {
    return buildOutcome(
      'deny',
      ['The order was already refunded.'],
      [orderFact, 'This order has already been refunded.'],
      [RULE.ALREADY_REFUNDED],
    );
  }
  return buildOutcome(
    'escalate',
    ['The refund could not be recorded (order not found).'],
    [orderFact, ...HUMAN_REVIEW_FACTS],
  );
}

const reviewNote = (answer: ReviewAnswer) => `${answer.reviewer}${answer.note ? `: ${answer.note}` : ''}`;

/**
 * What a reviewer's yes or no turns into. The amount is the order's, never anything the reviewer typed, and the
 * customer-facing facts never contain the reviewer's name or note (those are for the audit trail).
 */
export function reviewedOutcome(answer: ReviewAnswer, order: Order, citations: string[]): Outcome {
  const orderFact = `Regarding order ${order.orderId} (${order.item}).`;
  if (answer.action === 'deny') {
    return buildOutcome(
      'deny',
      [`Declined after review by ${reviewNote(answer)}.`],
      [orderFact, 'After a review by our team, we are not able to refund this order.'],
      citations,
    );
  }
  return buildOutcome(
    'approve',
    [`Approved after review by ${reviewNote(answer)}.`],
    [orderFact, 'Our team reviewed your request before this was approved.'],
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
      `Regarding order ${order.orderId} (${order.item}).`,
      'Something about your order changed while we were reviewing it, so we need to take another look before any refund.',
      ...HUMAN_REVIEW_FACTS,
    ],
    citations,
  );
}

/**
 * This ticket was already refunded (sent twice, or answered before a crash): say so again. Nothing is paid, nothing is
 * re-judged: the money moved on a decision that was already made, and it is the amount that was actually paid.
 */
export function refundAlreadyRecordedOutcome(order: Order): Outcome {
  return buildOutcome(
    'approve',
    ['The refund for this ticket was already recorded.'],
    [`Regarding order ${order.orderId} (${order.item}).`, 'This refund was already issued for your request.'],
    [],
    order.refundedAmount ?? order.amount,
  );
}
