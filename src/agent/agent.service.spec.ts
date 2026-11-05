import { describe, expect, it } from 'vitest';

import { createTestContainer, ticket } from '../../test/support/helpers.js';

/** The part of a run after a reviewer is asked: which answer a resume used. */
async function paused() {
  const container = await createTestContainer();
  const raw = ticket({ ticketId: 'T-A1', orderId: 'ORD-1002', customerEmail: 'ben@example.com' }); // over the limit
  const pending = await container.agent.run(raw, { reviewId: 'T-A1:abc' });
  const record = (await container.reviews.find('T-A1:abc'))!;
  return { container, pending, record };
}
const approve = { action: 'approve' as const, reviewer: 'Maria' };
const deny = { action: 'deny' as const, reviewer: 'Boris' };

describe('AgentService review runs', () => {
  it('pauses a reviewable escalation and queues it, and leaves a run that is not reviewable alone', async () => {
    const { container, pending, record } = await paused();
    expect(pending).toMatchObject({ decision: 'escalate', review: { status: 'pending' } });
    expect(record).toMatchObject({ status: 'pending', ticketId: 'T-A1' });

    const done = await container.agent.run(ticket({ ticketId: 'T-A2' }), { reviewId: 'T-A2:abc' }); // approved outright
    expect(done.review).toBeUndefined();
    expect(await container.reviews.find('T-A2:abc')).toBeUndefined();
  });

  it('never pauses without a review id', async () => {
    const container = await createTestContainer();
    const result = await container.agent.run(
      ticket({ ticketId: 'T-A3', orderId: 'ORD-1002', customerEmail: 'ben@example.com' }),
    );
    expect(result).toMatchObject({ decision: 'escalate' });
    expect(result.review).toBeUndefined();
  });

  describe('resume says whether this call’s answer was the one used', () => {
    it('is consumed when the run was still waiting', async () => {
      const { container, record } = await paused();
      const resumed = await container.agent.resume(record, approve);
      expect(resumed.consumed).toBe(true);
      expect(resumed.result).toMatchObject({ decision: 'approve', refundAmount: 149, review: { reviewer: 'Maria' } });
    });

    it('is not consumed when the run had already finished: the earlier answer stands, whatever this one says', async () => {
      const { container, record } = await paused();
      await container.agent.resume(record, approve);

      const again = await container.agent.resume(record, deny); // the saved run is still there until it is discarded
      expect(again.consumed).toBe(false);
      expect(again.result).toMatchObject({ decision: 'approve', review: { status: 'approved', reviewer: 'Maria' } });
      expect(await container.database('refunds').count({ n: '*' }).first()).toEqual({ n: 1 });
    });

    describe('after an earlier attempt applied an answer and was cut short', () => {
      async function cutShort() {
        const { container, record } = await paused();
        let failures = 1;
        const real = container.orders.recordRefund.bind(container.orders);
        container.orders.recordRefund = async (...args) => {
          if (failures-- > 0) throw new Error('database unavailable'); // after Maria's answer was taken
          return real(...args);
        };
        await expect(container.agent.resume(record, approve)).rejects.toThrow('database unavailable');
        return { container, record };
      }

      it('is not consumed for someone else, even one who says the same: Maria’s answer stands', async () => {
        const { container, record } = await cutShort();
        for (const other of [deny, { action: 'approve' as const, reviewer: 'Boris' }]) {
          const retried = await container.agent.resume(record, other);
          expect(retried.consumed, JSON.stringify(other)).toBe(false);
          expect(retried.result).toMatchObject({ decision: 'approve', review: { reviewer: 'Maria' } });
        }
      });

      it('is consumed for the reviewer who gave that answer: it is theirs, retried', async () => {
        const { container, record } = await cutShort();
        const retried = await container.agent.resume(record, approve);
        expect(retried.consumed).toBe(true);
        expect(retried.result).toMatchObject({ decision: 'approve', review: { reviewer: 'Maria' } });
        expect(await container.database('refunds').count({ n: '*' }).first()).toEqual({ n: 1 });
      });

      it('is not consumed for the same reviewer changing their mind: the first answer stands', async () => {
        const { container, record } = await cutShort();
        const retried = await container.agent.resume(record, { action: 'deny', reviewer: 'Maria' });
        expect(retried.consumed).toBe(false);
        expect(retried.result).toMatchObject({ decision: 'approve' });
      });
    });
  });

  it('forgets a run on request', async () => {
    const { container, record } = await paused();
    await container.agent.discard(record);
    expect(await container.database('graph_checkpoints').count({ n: '*' }).first()).toEqual({ n: 0 });
  });

  describe('a denial after review', () => {
    it('is returned as it was given when the ticket comes again, without running anything', async () => {
      const { container, pending, record } = await paused();
      const { result } = await container.agent.resume(record, deny);
      await container.reviews.begin(record.reviewId); // the approvals service would have done this
      await container.reviews.resolve(record.reviewId, deny, result);

      const raw = ticket({ ticketId: 'T-A1', orderId: 'ORD-1002', customerEmail: 'ben@example.com' });
      const audited = await container.database('decisions').count({ n: '*' }).first();
      const again = await container.agent.run(raw, { reviewId: record.reviewId });

      expect(again).toEqual(result);
      expect(again).toMatchObject({ decision: 'deny', review: { status: 'denied' } });
      expect(pending.review?.status).toBe('pending');
      expect(await container.reviews.list()).toEqual([]);
      expect(await container.database('decisions').count({ n: '*' }).first()).toEqual(audited);
    });

    it('is not replayed for a review that was approved, or that is still waiting', async () => {
      const { container, record } = await paused();
      const raw = ticket({ ticketId: 'T-A1', orderId: 'ORD-1002', customerEmail: 'ben@example.com' });
      const waiting = await container.agent.run(raw, { reviewId: record.reviewId });
      expect(waiting.review?.status).toBe('pending'); // still waiting: run again, replacing its own review

      const { result } = await container.agent.resume((await container.reviews.find(record.reviewId))!, approve);
      await container.reviews.begin(record.reviewId);
      await container.reviews.resolve(record.reviewId, approve, result);
      const approved = await container.agent.run(raw, { reviewId: record.reviewId });
      expect(approved).toMatchObject({ decision: 'approve' }); // the refund it got, not a stored denial
    });
  });
});
