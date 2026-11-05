import { FLAG, rankRules, type OrderTools } from '../../domain/index.js';
import { STEP, TOOL } from '../constants.js';
import { needs } from '../needs.util.js';
import { searchQuery } from '../search-query.util.js';
import { step } from '../trace.util.js';
import type { AgentNode, AgentState, AgentStateUpdate } from '../typedef.js';

/** Tool calls: searchPolicies (over the loaded snapshot) + lookupOrder (ownership-checked). */
export class GatherNode implements AgentNode {
  public constructor(private readonly orders: OrderTools) {}

  public async execute(state: AgentState): Promise<AgentStateUpdate> {
    const { ticket, classification, policies } = needs(state, 'ticket', 'classification', 'policies');
    const mentionedOrderId = classification.orderIdMentioned ?? undefined;
    const flags: string[] = [];
    if (ticket.orderId && mentionedOrderId && ticket.orderId !== mentionedOrderId) flags.push(FLAG.ORDER_ID_CONFLICT);
    const orderId = ticket.orderId ?? mentionedOrderId;

    const relatedPolicies = rankRules(
      policies.rules,
      searchQuery(ticket.subject, ticket.body, classification.refundReason),
    ).map((hit) => hit.rule);
    const searched = step(state, {
      step: STEP.SEARCH_POLICIES,
      tool: TOOL.SEARCH_POLICIES,
      ok: true,
      detail: `top: ${relatedPolicies.map((rule) => rule.id).join(',') || 'none'}`,
    });

    if (!orderId) {
      const missing = step(state, {
        step: STEP.LOOKUP_ORDER,
        tool: TOOL.LOOKUP_ORDER,
        ok: false,
        detail: 'no order id',
      });
      return { orderId, lookup: 'no_order_id', relatedPolicies, flags, trace: [...searched, ...missing] };
    }

    const lookupResult = await this.orders.lookupOrder(orderId, ticket.customerEmail);
    const looked = step(state, {
      step: STEP.LOOKUP_ORDER,
      tool: TOOL.LOOKUP_ORDER,
      ok: lookupResult.found,
      detail: lookupResult.found ? `${orderId} found` : `${orderId} ${lookupResult.reason}`,
    });
    if (!lookupResult.found) {
      return { orderId, lookup: lookupResult.reason, relatedPolicies, flags, trace: [...searched, ...looked] };
    }
    // This same ticket already refunded the order (a retry after a crash lost the decision): decide it again as
    // the first run did. recordRefund accepts the same ticket twice without paying twice.
    const { order } = lookupResult;
    const ownRefund = order.refunded && order.refundedByTicket === ticket.ticketId;
    return {
      orderId,
      order: ownRefund ? { ...order, refunded: false } : order,
      lookup: 'found',
      relatedPolicies,
      flags,
      trace: [...searched, ...looked],
    };
  }
}
