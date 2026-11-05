import {
  orderChangedOutcome,
  orderChangedSince,
  refundFailureOutcome,
  reviewedOutcome,
  type Order,
  type OrderTools,
  type Outcome,
  type ReviewAnswer,
} from '../../domain/index.js';
import { STEP, TOOL } from '../constants.js';
import { needs } from '../needs.util.js';
import { step } from '../trace.util.js';
import type { AgentNode, AgentState, AgentStateUpdate } from '../typedef.js';

/**
 * Turns the reviewer's yes or no into a decision. The reviewer decides whether; the amount is the order's, and the
 * refund goes through the same guarded `recordRefund` as an automatic approval, so a double click or a second
 * reviewer cannot pay twice.
 *
 * The saved order can be days old, so before paying the order is read again. If it has changed in a way that matters
 * (amount, category, no longer delivered, refunded by another ticket, gone), nothing is paid: the reviewer approved
 * the order they were shown, not this one.
 */
export class ApplyReviewNode implements AgentNode {
  public constructor(
    private readonly orders: OrderTools,
    private readonly now: () => Date,
  ) {}

  public async execute(state: AgentState): Promise<AgentStateUpdate> {
    const { ticket, order, review } = needs(state, 'ticket', 'order', 'review');
    const answer: ReviewAnswer = {
      action: review.status === 'approved' ? 'approve' : 'deny',
      reviewer: review.reviewer ?? 'unknown',
      note: review.note,
    };
    if (answer.action === 'deny') return this.update(state, reviewedOutcome(answer, order, state.citations), []);

    const current = await this.orders.lookupOrder(order.orderId, ticket.customerEmail);
    const checked = step(state, {
      step: STEP.LOOKUP_ORDER,
      tool: TOOL.LOOKUP_ORDER,
      ok: current.found,
      detail: current.found ? `${order.orderId} re-checked before paying` : `${order.orderId} ${current.reason}`,
    });
    if (!current.found) return this.update(state, refundFailureOutcome('not_found', order), checked);

    const stopped = this.notToPay(order, current.order, ticket.ticketId, state.citations);
    if (stopped) return this.update(state, stopped, checked);

    const refund = await this.orders.recordRefund(order.orderId, ticket.ticketId, current.order.amount, this.now());
    const outcome = refund.ok
      ? reviewedOutcome(answer, current.order, state.citations)
      : refundFailureOutcome(refund.reason, current.order);
    const recorded = step(state, {
      step: STEP.EXECUTE_REFUND,
      tool: TOOL.RECORD_REFUND,
      ok: refund.ok,
      detail: refund.ok ? `refunded ${current.order.amount.toFixed(2)} after review` : refund.reason,
    });
    return this.update(state, outcome, [...checked, ...recorded]);
  }

  /** The outcome to give instead of paying, if the order as it is now should not be paid on the old approval. */
  private notToPay(shown: Order, current: Order, ticketId: string, citations: string[]): Outcome | undefined {
    // Refunded by this same ticket is fine: an earlier attempt already paid, and `recordRefund` accepts it again.
    if (current.refunded && current.refundedByTicket !== ticketId) {
      return refundFailureOutcome('already_refunded', current);
    }
    const changed = orderChangedSince(shown, current);
    return changed ? orderChangedOutcome(changed, current, citations) : undefined;
  }

  private update(state: AgentState, outcome: Outcome, extra: AgentState['trace']) {
    return {
      decision: outcome.decision,
      refundAmount: outcome.refundAmount,
      reasons: outcome.reasons,
      facts: outcome.facts,
      citations: outcome.citations,
      policyNotes: [], // the quoted rules explained the escalation, not this outcome
      trace: [
        ...extra,
        ...step(state, {
          step: STEP.APPLY_REVIEW,
          ok: true,
          detail: `${outcome.decision}: ${outcome.reasons.join(' ')}`,
        }),
      ],
    };
  }
}
