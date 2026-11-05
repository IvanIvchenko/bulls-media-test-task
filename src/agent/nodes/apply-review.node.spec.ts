import { describe, expect, it, vi } from 'vitest';

import { ApplyReviewNode } from './apply-review.node.js';
import { NOW } from '../../../test/support/helpers.js';
import { fakeOrders, order, stateWith, ticket } from '../../../test/support/nodes.js';
import { outOfOrder } from '../../../test/support/nodes.js';
import type { ReviewStatus } from '../../domain/index.js';

const big = { ...order, amount: 149 };
const reviewed = (review: ReviewStatus) =>
  stateWith({
    ticket,
    order: big,
    review,
    decision: 'escalate',
    citations: ['R5'],
    policyNotes: ['R5 Automatic approval limit: ...'],
  });
const approved: ReviewStatus = { status: 'approved', reviewer: 'Maria', note: 'phoned us' };
const denied: ReviewStatus = { status: 'denied', reviewer: 'Maria' };

describe('ApplyReviewNode', () => {
  it('approves the order’s own amount, through the same guarded refund as an automatic approval', async () => {
    const { orders, recordRefund } = fakeOrders({ found: true, order: big });
    const update = await new ApplyReviewNode(orders, () => NOW).execute(reviewed(approved));

    expect(recordRefund).toHaveBeenCalledWith('ORD-1001', 'T-1', 149, NOW);
    expect(update).toMatchObject({ decision: 'approve', refundAmount: 149, citations: ['R5'], policyNotes: [] });
    expect(update.reasons?.join(' ')).toContain('Maria: phoned us');
    expect(update.facts?.join(' ')).not.toMatch(/Maria|phoned/);
    expect(update.trace?.map((entry) => entry.step)).toEqual(['lookup_order', 'execute_refund', 'apply_review']);
  });

  it('denies without touching the store', async () => {
    const { orders, recordRefund } = fakeOrders({ found: true, order: big });
    const update = await new ApplyReviewNode(orders, () => NOW).execute(reviewed(denied));
    expect(recordRefund).not.toHaveBeenCalled();
    expect(update).toMatchObject({ decision: 'deny', refundAmount: 0, policyNotes: [] });
  });

  it('turns an approval into a denial, and says so, when the store refuses the refund', async () => {
    const { orders } = fakeOrders({ found: true, order: big }, { ok: false, reason: 'already_refunded' });
    const update = await new ApplyReviewNode(orders, () => NOW).execute(reviewed(approved));

    expect(update).toMatchObject({ decision: 'deny', refundAmount: 0, citations: ['R6'] });
    expect(update.review).toBeUndefined(); // `review` stays what the reviewer said; `decision` is the outcome
    expect(update.trace?.[1]).toMatchObject({ step: 'execute_refund', ok: false, detail: 'already_refunded' });
  });

  it('never refunds when run out of order', async () => {
    const recordRefund = vi.fn();
    await outOfOrder(new ApplyReviewNode({ lookupOrder: vi.fn(), recordRefund }, () => NOW), /order/);
    expect(recordRefund).not.toHaveBeenCalled();
  });

  describe('the order is read again before anything is paid', () => {
    const payWith = (current: Parameters<typeof fakeOrders>[0]) => {
      const fake = fakeOrders(current);
      return { ...fake, run: () => new ApplyReviewNode(fake.orders, () => NOW).execute(reviewed(approved)) };
    };

    it('looks the order up for the sender, before paying, and says so in the trace', async () => {
      const { lookupOrder, recordRefund, run } = payWith({ found: true, order: big });
      const update = await run();
      expect(lookupOrder).toHaveBeenCalledWith('ORD-1001', 'anna@example.com');
      expect(lookupOrder.mock.invocationCallOrder[0]).toBeLessThan(recordRefund.mock.invocationCallOrder[0]!);
      expect(update.trace?.map((entry) => entry.step)).toEqual(['lookup_order', 'execute_refund', 'apply_review']);
    });

    it('pays nothing, and sends it back to a person, when the amount was corrected', async () => {
      const { recordRefund, run } = payWith({ found: true, order: { ...big, amount: 20 } });
      const update = await run();
      expect(recordRefund).not.toHaveBeenCalled();
      expect(update).toMatchObject({ decision: 'escalate', refundAmount: 0 });
      expect(update.reasons?.join(' ')).toContain('from 149.00 to 20.00');
      expect(update.facts?.join(' ')).not.toMatch(/149|20\.00|Maria/);
    });

    it('pays nothing for an order that was cancelled, is no longer delivered, or changed category', async () => {
      for (const change of [
        { status: 'cancelled' as const },
        { status: 'shipped' as const },
        { category: 'digital' as const },
      ]) {
        const { recordRefund, run } = payWith({ found: true, order: { ...big, ...change } });
        expect(await run(), JSON.stringify(change)).toMatchObject({ decision: 'escalate', refundAmount: 0 });
        expect(recordRefund).not.toHaveBeenCalled();
      }
    });

    it('denies, as already refunded, an order another ticket has refunded since', async () => {
      const { recordRefund, run } = payWith({
        found: true,
        order: { ...big, refunded: true, refundedByTicket: 'T-OTHER' },
      });
      expect(await run()).toMatchObject({ decision: 'deny', refundAmount: 0, citations: ['R6'] });
      expect(recordRefund).not.toHaveBeenCalled();
    });

    it('carries on when the refund was this ticket’s own, from an earlier attempt that was cut short', async () => {
      const { recordRefund, run } = payWith({
        found: true,
        order: { ...big, refunded: true, refundedByTicket: 'T-1' },
      });
      expect(await run()).toMatchObject({ decision: 'approve', refundAmount: 149 });
      expect(recordRefund).toHaveBeenCalledTimes(1); // accepted again, not paid twice
    });

    it('sends it back to a person when the order can no longer be found for this sender', async () => {
      for (const reason of ['not_found', 'email_mismatch'] as const) {
        const { recordRefund, run } = payWith({ found: false, reason });
        expect(await run(), reason).toMatchObject({ decision: 'escalate', refundAmount: 0 });
        expect(recordRefund).not.toHaveBeenCalled();
      }
    });

    it('does not look anything up for a denial', async () => {
      const fake = fakeOrders({ found: true, order: big });
      await new ApplyReviewNode(fake.orders, () => NOW).execute(reviewed(denied));
      expect(fake.lookupOrder).not.toHaveBeenCalled();
    });
  });
});
