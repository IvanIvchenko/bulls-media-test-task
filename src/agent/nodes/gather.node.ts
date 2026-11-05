import { FLAG, rankRules, searchQuery, type OrderTools } from '../../domain/index.js';
import { STEP, TOOL } from '../constants.js';
import { needs } from '../needs.util.js';
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

    const lookedUp = (ok: boolean, detail: string) =>
      step(state, { step: STEP.LOOKUP_ORDER, tool: TOOL.LOOKUP_ORDER, ok, detail });
    const base = { orderId, relatedPolicies, flags };

    if (!orderId) {
      return { ...base, lookup: 'no_order_id', trace: [...searched, ...lookedUp(false, 'no order id')] };
    }
    const result = await this.orders.lookupOrder(orderId, ticket.customerEmail);
    if (!result.found) {
      return {
        ...base,
        lookup: result.reason,
        trace: [...searched, ...lookedUp(false, `${orderId} ${result.reason}`)],
      };
    }
    return {
      ...base,
      lookup: 'found',
      order: result.order,
      trace: [...searched, ...lookedUp(true, `${orderId} found`)],
    };
  }
}
