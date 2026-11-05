import { refundFailureOutcome, type OrderTools } from '../../domain/index.js';
import { STEP, TOOL } from '../constants.js';
import { needs } from '../needs.util.js';
import { step } from '../trace.util.js';
import type { AgentNode, AgentState, AgentStateUpdate } from '../typedef.js';

/**
 * The only side-effecting node. Reachable only on `approve`. If the store refuses (the order was refunded in the
 * meantime), the decision and its whole explanation are replaced by `refundFailureOutcome`.
 */
export class ExecuteRefundNode implements AgentNode {
  public constructor(
    private readonly orders: OrderTools,
    private readonly now: () => Date,
  ) {}

  public async execute(state: AgentState): Promise<AgentStateUpdate> {
    const { orderId, order, ticket } = needs(state, 'orderId', 'order', 'ticket');
    const refund = await this.orders.recordRefund(orderId, ticket.ticketId, state.refundAmount, this.now());
    if (refund.ok) {
      return {
        trace: step(state, {
          step: STEP.EXECUTE_REFUND,
          tool: TOOL.RECORD_REFUND,
          ok: true,
          detail: `${orderId} refunded ${state.refundAmount}`,
        }),
      };
    }
    const outcome = refundFailureOutcome(refund.reason, order);
    return {
      decision: outcome.decision,
      refundAmount: outcome.refundAmount,
      reasons: outcome.reasons,
      facts: outcome.facts,
      citations: outcome.citations,
      trace: step(state, { step: STEP.EXECUTE_REFUND, tool: TOOL.RECORD_REFUND, ok: false, detail: refund.reason }),
    };
  }
}
