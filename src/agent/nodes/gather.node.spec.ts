import { describe, expect, it } from 'vitest';

import { classification, fakeOrders, order, snapshot, stateWith, ticket } from '../../../test/support/nodes.js';
import type { AgentState } from '../typedef.js';
import { GatherNode } from './gather.node.js';

describe('GatherNode', () => {
  const gatherState = (patch: Partial<AgentState> = {}) =>
    stateWith({ ticket, classification, policies: snapshot, ...patch });

  it('looks the order up for the sender and stores it', async () => {
    const { orders, lookupOrder } = fakeOrders({ found: true, order });
    const update = await new GatherNode(orders).execute(gatherState());
    expect(lookupOrder).toHaveBeenCalledWith('ORD-1001', 'anna@example.com');
    expect(update).toMatchObject({ lookup: 'found', orderId: 'ORD-1001', order });
  });

  it('decides again as the first run did when this same ticket already refunded the order', async () => {
    const refunded = { ...order, refunded: true, refundedByTicket: 'T-1' };
    const update = await new GatherNode(fakeOrders({ found: true, order: refunded }).orders).execute(gatherState());
    expect(update.order?.refunded).toBe(false);

    const other = await new GatherNode(
      fakeOrders({ found: true, order: { ...refunded, refundedByTicket: 'T-9' } }).orders,
    ).execute(gatherState());
    expect(other.order?.refunded).toBe(true); // another ticket's refund still blocks this one
  });

  it('records why an order could not be shown, without storing anything of it', async () => {
    for (const reason of ['not_found', 'email_mismatch'] as const) {
      const { orders } = fakeOrders({ found: false, reason });
      const update = await new GatherNode(orders).execute(gatherState());
      expect(update.lookup).toBe(reason);
      expect(update.order).toBeUndefined();
    }
  });

  it('does not look anything up when there is no order id anywhere', async () => {
    const { orders, lookupOrder } = fakeOrders({ found: true, order });
    const update = await new GatherNode(orders).execute(gatherState({ ticket: { ...ticket, orderId: undefined } }));
    expect(update.lookup).toBe('no_order_id');
    expect(lookupOrder).not.toHaveBeenCalled();
  });

  it('takes the order id from the message when the form has none', async () => {
    const { orders, lookupOrder } = fakeOrders({ found: true, order });
    await new GatherNode(orders).execute(
      gatherState({
        ticket: { ...ticket, orderId: undefined },
        classification: { ...classification, orderIdMentioned: 'ORD-1002' },
      }),
    );
    expect(lookupOrder).toHaveBeenCalledWith('ORD-1002', 'anna@example.com');
  });

  it('flags a form and a message that name different orders, and trusts the form', async () => {
    const { orders, lookupOrder } = fakeOrders({ found: true, order });
    const update = await new GatherNode(orders).execute(
      gatherState({ classification: { ...classification, orderIdMentioned: 'ORD-1002' } }),
    );
    expect(update.flags).toEqual(['order_id_conflict']);
    expect(lookupOrder).toHaveBeenCalledWith('ORD-1001', 'anna@example.com');
  });

  it('searches the loaded policy for the reviewer, using the customer words', async () => {
    const { orders } = fakeOrders({ found: true, order });
    const update = await new GatherNode(orders).execute(
      gatherState({ ticket: { ...ticket, body: 'I bought a software license by mistake' } }),
    );
    expect(update.relatedPolicies?.map((rule) => rule.id)).toContain('R3');
  });
});
