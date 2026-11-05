import { describe, expect, it } from 'vitest';

import { ExecuteRefundNode } from './execute-refund.node.js';
import { NOW } from '../../../test/support/helpers.js';
import { fakeOrders, order, outOfOrder, stateWith, ticket } from '../../../test/support/nodes.js';

describe('ExecuteRefundNode', () => {
  const refundState = stateWith({
    ticket,
    order,
    orderId: 'ORD-1001',
    decision: 'approve',
    refundAmount: 59.9,
    reasons: ['ok'],
  });

  it('records the refund with the ticket, the amount and the clock', async () => {
    const { orders, recordRefund } = fakeOrders({ found: true, order });
    const update = await new ExecuteRefundNode(orders, () => NOW).execute(refundState);
    expect(recordRefund).toHaveBeenCalledWith('ORD-1001', 'T-1', 59.9, NOW);
    expect(update.decision).toBeUndefined(); // the approval stands
    expect(update.trace?.[0]).toMatchObject({ ok: true, tool: 'recordRefund' });
  });

  it('replaces the whole decision when the store refuses', async () => {
    const { orders } = fakeOrders({ found: true, order }, { ok: false, reason: 'already_refunded' });
    const update = await new ExecuteRefundNode(orders, () => NOW).execute(refundState);
    expect(update).toMatchObject({
      decision: 'deny',
      refundAmount: 0,
      citations: ['R6'],
      reasons: ['The order was already refunded.'],
    });
    expect(update.trace?.[0]).toMatchObject({ ok: false, detail: 'already_refunded' });
  });

  it('never refunds when run out of order', async () => {
    const { orders, recordRefund } = fakeOrders({ found: true, order });
    await outOfOrder(new ExecuteRefundNode(orders, () => NOW), /orderId/);
    expect(recordRefund).not.toHaveBeenCalled();
  });

  it('pays nothing again for a ticket whose refund is already recorded, and says so', async () => {
    const paid = { ...order, refunded: true, refundedByTicket: 'T-1' };
    const { orders, recordRefund } = fakeOrders({ found: true, order: paid });
    const update = await new ExecuteRefundNode(orders, () => NOW).execute({ ...refundState, order: paid });
    expect(recordRefund).not.toHaveBeenCalled();
    expect(update.decision).toBeUndefined();
    expect(update.trace?.[0]).toMatchObject({ ok: true, detail: expect.stringContaining('already recorded') });
  });
});
