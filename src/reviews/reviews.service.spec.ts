import { describe, expect, it } from 'vitest';

import { createTestContainer } from '../../test/support/helpers.js';
import type { NewReview, Result } from '../domain/index.js';

const request: Result = {
  ticketId: 'T-1',
  decision: 'escalate',
  refundAmount: 0,
  intent: 'refund_request',
  reasons: [],
  policyCitations: [],
  handoff: null,
  flags: [],
  reply: 'ok',
  summary: 'Ticket T-1: ESCALATE.',
  trace: [],
  review: { status: 'pending' },
  usage: { llmCalls: 0, inputTokens: 0, outputTokens: 0, llmMs: 0 },
};
const review = (over: Partial<NewReview> = {}): NewReview => ({
  reviewId: 'T-1:abc',
  ticketId: 'T-1',
  orderId: 'ORD-1',
  threadId: 'thread-1',
  request,
  ...over,
});
const answer = { action: 'deny' as const, reviewer: 'Maria', note: 'no' };
const finalDenial: Result = { ...request, decision: 'deny', review: { status: 'denied', reviewer: 'Maria' } };

const reviews = async () => (await createTestContainer()).reviews;
const withDatabase = async () => {
  const container = await createTestContainer();
  return { store: container.reviews, database: container.database };
};

describe('ReviewsService', () => {
  it('lists waiting reviews, oldest first, with what a reviewer needs', async () => {
    const store = await reviews();
    await store.open(review());
    await store.open(review({ reviewId: 'T-2:abc', ticketId: 'T-2' }));
    const listed = await store.list();
    expect(listed.map((entry) => entry.reviewId)).toEqual(['T-1:abc', 'T-2:abc']);
    expect(listed[0]).toMatchObject({ ticketId: 'T-1', summary: 'Ticket T-1: ESCALATE.', createdAt: expect.any(Date) });
  });

  it('knows nothing about a review that was never opened', async () => {
    const store = await reviews();
    expect(await store.find('nope')).toBeUndefined();
    expect(await store.begin('nope')).toBeUndefined();
  });

  describe('opening', () => {
    it('replaces a waiting review when the ticket is sent again, and returns the run it replaced', async () => {
      const store = await reviews();
      expect(await store.open(review())).toBeUndefined(); // nothing was waiting
      expect(await store.open(review({ threadId: 'thread-2' }))).toBe('thread-1');
      expect(await store.find('T-1:abc')).toMatchObject({ threadId: 'thread-2' });
      expect(await store.list()).toHaveLength(1);
    });

    it('opens a new review when the same ticket escalates again after an old one was answered', async () => {
      const store = await reviews();
      await store.open(review());
      await store.begin('T-1:abc');
      await store.resolve('T-1:abc', { action: 'deny', reviewer: 'Ana' }, finalDenial);

      expect(await store.open(review({ threadId: 'thread-2' }))).toBeUndefined(); // an answered run needs no clean-up
      expect(await store.find('T-1:abc')).toMatchObject({ status: 'pending', threadId: 'thread-2' });
      expect(await store.list()).toHaveLength(1);
    });

    it('refuses, loudly, to replace a review someone is deciding right now', async () => {
      const store = await reviews();
      await store.open(review());
      await store.begin('T-1:abc');
      await expect(store.open(review({ threadId: 'thread-3' }))).rejects.toThrow();
      expect(await store.find('T-1:abc')).toMatchObject({ status: 'deciding', threadId: 'thread-1' });
    });
  });

  describe('deciding', () => {
    it('hands a review to exactly one of many callers', async () => {
      const store = await reviews();
      await store.open(review());
      const winners = await Promise.all(Array.from({ length: 10 }, () => store.begin('T-1:abc')));
      expect(winners.filter(Boolean)).toHaveLength(1);
      expect(winners.find(Boolean)).toMatchObject({ status: 'deciding', threadId: 'thread-1' });
      expect(await store.list()).toEqual([]); // being decided is no longer waiting
    });

    it('puts a review back, and closes it for good when it is resolved', async () => {
      const store = await reviews();
      await store.open(review());
      await store.begin('T-1:abc');
      await store.release('T-1:abc');
      expect((await store.find('T-1:abc'))?.status).toBe('pending');

      await store.begin('T-1:abc');
      await store.resolve('T-1:abc', answer, finalDenial);
      expect(await store.find('T-1:abc')).toMatchObject({ status: 'resolved' });
      expect(await store.begin('T-1:abc')).toBeUndefined();
    });

    it('keeps the answer that was applied and the final result, once resolved, and only then', async () => {
      const store = await reviews();
      await store.open(review());
      const waiting = await store.find('T-1:abc');
      expect([waiting?.status, waiting?.answer, waiting?.finalResult]).toEqual(['pending', undefined, undefined]);

      await store.begin('T-1:abc');
      await store.resolve('T-1:abc', answer, finalDenial);
      expect(await store.find('T-1:abc')).toMatchObject({
        status: 'resolved',
        answer: { action: 'deny', reviewer: 'Maria', note: 'no' },
        finalResult: { decision: 'deny', review: { status: 'denied' } },
      });
    });

    it('forgets the old answer when the same ticket comes back and a new review is opened', async () => {
      const store = await reviews();
      await store.open(review());
      await store.begin('T-1:abc');
      await store.resolve('T-1:abc', answer, finalDenial);
      await store.open(review({ threadId: 'thread-2' }));
      const reopened = await store.find('T-1:abc');
      expect([reopened?.status, reopened?.answer, reopened?.finalResult]).toEqual(['pending', undefined, undefined]);
    });

    it('does not release or resolve a review that nobody is deciding', async () => {
      const store = await reviews();
      await store.open(review());
      await store.release('T-1:abc');
      await store.resolve('T-1:abc', answer, finalDenial);
      expect((await store.find('T-1:abc'))?.status).toBe('pending');
    });
  });

  describe('recover (at startup, after a process died mid-answer)', () => {
    it('puts every review left "deciding" back to waiting, and counts them', async () => {
      const store = await reviews();
      await store.open(review());
      await store.open(review({ reviewId: 'T-2:abc', ticketId: 'T-2' }));
      await store.open(review({ reviewId: 'T-3:abc', ticketId: 'T-3' }));
      await store.begin('T-1:abc');
      await store.begin('T-2:abc');
      await store.resolve('T-2:abc', answer, finalDenial);

      expect(await store.recover()).toBe(1); // only T-1 was left mid-answer
      expect((await store.find('T-1:abc'))?.status).toBe('pending');
      expect((await store.find('T-2:abc'))?.status).toBe('resolved'); // answered ones stay answered
      expect((await store.begin('T-1:abc'))?.status).toBe('deciding'); // and it can be answered again
    });

    it('does nothing when nothing is stuck', async () => {
      const store = await reviews();
      await store.open(review());
      expect(await store.recover()).toBe(0);
    });
  });

  describe('deniedFor (what a reviewer should know before answering another ticket about the same order)', () => {
    type Handle = Awaited<ReturnType<typeof withDatabase>>;
    /** An answered review. `daysAgo` sets when, since the database stamps whole seconds. */
    async function answered(
      { store, database }: Handle,
      id: string,
      order: string,
      decision: 'deny' | 'approve',
      daysAgo = 0,
    ) {
      await store.open(review({ reviewId: `${id}:abc`, ticketId: id, orderId: order }));
      await store.begin(`${id}:abc`);
      await store.resolve(`${id}:abc`, { action: decision, reviewer: `rev-${id}`, note: `note ${id}` }, finalDenial);
      const at = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 19).replace('T', ' ');
      await database('pending_reviews')
        .where({ review_id: `${id}:abc` })
        .update({ resolved_at: at });
    }

    it('lists the earlier denials of that order, newest first, with who said it and why', async () => {
      const handle = await withDatabase();
      await answered(handle, 'T-1', 'ORD-1', 'deny', 5);
      await answered(handle, 'T-2', 'ORD-1', 'deny', 1);
      const denials = await handle.store.deniedFor('ORD-1', 'T-3:abc');
      expect(denials.map((denial) => denial.ticketId)).toEqual(['T-2', 'T-1']);
      expect(denials[0]).toMatchObject({ reviewer: 'rev-T-2', note: 'note T-2', decidedAt: expect.any(Date) });
    });

    it('leaves out approvals, other orders, reviews still waiting, and the review being opened', async () => {
      const handle = await withDatabase();
      await answered(handle, 'T-1', 'ORD-1', 'approve');
      await answered(handle, 'T-2', 'ORD-2', 'deny');
      await handle.store.open(review({ reviewId: 'T-3:abc', ticketId: 'T-3', orderId: 'ORD-1' })); // waiting
      await answered(handle, 'T-4', 'ORD-1', 'deny');
      expect((await handle.store.deniedFor('ORD-1', 'T-4:abc')).map((denial) => denial.ticketId)).toEqual([]);
      expect((await handle.store.deniedFor('ORD-1', 'T-9:abc')).map((denial) => denial.ticketId)).toEqual(['T-4']);
    });

    it('shows at most five', async () => {
      const handle = await withDatabase();
      for (const id of ['T-1', 'T-2', 'T-3', 'T-4', 'T-5', 'T-6', 'T-7']) await answered(handle, id, 'ORD-1', 'deny');
      expect(await handle.store.deniedFor('ORD-1', 'T-9:abc')).toHaveLength(5);
    });
  });
});
