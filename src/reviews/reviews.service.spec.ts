import { describe, expect, it } from 'vitest';

import { backdateReview, createTestContainer } from '../../test/support/helpers.js';
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
  threadId: 'thread-1',
  request,
  ...over,
});
const STALE = 60_000;
const answer = { action: 'deny' as const, reviewer: 'Maria', note: 'no' };

async function setup() {
  const container = await createTestContainer();
  return { store: container.reviews, database: container.database };
}

describe('ReviewsService', () => {
  it('lists waiting reviews, oldest first, with what a reviewer needs', async () => {
    const { store } = await setup();
    await store.open(review());
    await store.open(review({ reviewId: 'T-2:abc', ticketId: 'T-2' }));
    const listed = await store.list();
    expect(listed.map((entry) => entry.reviewId)).toEqual(['T-1:abc', 'T-2:abc']);
    expect(listed[0]).toMatchObject({ ticketId: 'T-1', summary: 'Ticket T-1: ESCALATE.', createdAt: expect.any(Date) });
  });

  it('knows nothing about a review that was never opened', async () => {
    const { store } = await setup();
    expect(await store.find('nope')).toBeUndefined();
    expect(await store.begin('nope', STALE)).toBeUndefined();
  });

  describe('opening', () => {
    it('replaces a waiting review when the run is repeated after a crash', async () => {
      const { store } = await setup();
      await store.open(review());
      await store.open(review({ threadId: 'thread-2' }));
      expect(await store.find('T-1:abc')).toMatchObject({ threadId: 'thread-2' });
      expect(await store.list()).toHaveLength(1);
    });

    it('opens a new review when the same ticket id escalates again after an old one was answered', async () => {
      // e.g. the old claim was pruned and the client reused the ticket id. The customer must not be left "pending"
      // with no review for anyone to see.
      const { store } = await setup();
      await store.open(review());
      const lease = (await store.begin('T-1:abc', STALE))!;
      await store.resolve('T-1:abc', lease.token, { action: 'deny', reviewer: 'Ana' });

      await store.open(review({ threadId: 'thread-2' }));
      expect(await store.find('T-1:abc')).toMatchObject({ status: 'pending', threadId: 'thread-2' });
      expect(await store.list()).toHaveLength(1);
    });

    it('refuses, loudly, to replace a review someone is deciding right now', async () => {
      const { store } = await setup();
      await store.open(review());
      await store.begin('T-1:abc', STALE);
      await expect(store.open(review({ threadId: 'thread-3' }))).rejects.toThrow();
      expect(await store.find('T-1:abc')).toMatchObject({ status: 'deciding', threadId: 'thread-1' });
    });
  });

  describe('deciding', () => {
    it('hands a review to exactly one of many callers, with a token', async () => {
      const { store } = await setup();
      await store.open(review());
      const leases = await Promise.all(Array.from({ length: 10 }, () => store.begin('T-1:abc', STALE)));
      expect(leases.filter(Boolean)).toHaveLength(1);
      expect(leases.find(Boolean)).toMatchObject({
        review: { status: 'deciding', threadId: 'thread-1' },
        token: expect.any(String),
      });
      expect(await store.list()).toEqual([]); // being decided is no longer waiting
    });

    it('puts a review back with the token, and closes it for good when it is resolved', async () => {
      const { store } = await setup();
      await store.open(review());
      const first = (await store.begin('T-1:abc', STALE))!;
      await store.release('T-1:abc', first.token);
      expect((await store.find('T-1:abc'))?.status).toBe('pending');

      const second = (await store.begin('T-1:abc', STALE))!;
      expect(await store.resolve('T-1:abc', second.token, answer)).toBe(true);
      expect(await store.find('T-1:abc')).toMatchObject({ status: 'resolved' });
      expect(await store.begin('T-1:abc', STALE)).toBeUndefined();
    });

    it('does not let a wrong token release or resolve it', async () => {
      const { store } = await setup();
      await store.open(review());
      await store.begin('T-1:abc', STALE);
      await store.release('T-1:abc', 'someone-else');
      expect(await store.resolve('T-1:abc', 'someone-else', answer)).toBe(false);
      expect((await store.find('T-1:abc'))?.status).toBe('deciding');
    });
  });

  describe('when the decider has died', () => {
    it('keeps a review that is merely slow: a decision younger than the limit is not taken over', async () => {
      const { store, database } = await setup();
      await store.open(review());
      await store.begin('T-1:abc', STALE);
      await backdateReview(database, 'T-1:abc', STALE - 20_000);
      expect(await store.begin('T-1:abc', STALE)).toBeUndefined();
    });

    it('hands it to one new decider once it is older than the limit', async () => {
      const { store, database } = await setup();
      await store.open(review());
      const dead = (await store.begin('T-1:abc', STALE))!;
      await backdateReview(database, 'T-1:abc', STALE + 20_000);

      const successor = (await store.begin('T-1:abc', STALE))!;
      expect(successor.token).not.toBe(dead.token);
      expect(successor.review.status).toBe('deciding');
      expect(await store.begin('T-1:abc', STALE)).toBeUndefined(); // the clock restarted for the new decider
    });

    it('locks the dead decider out: if it comes back it can neither record nor release anything', async () => {
      const { store, database } = await setup();
      await store.open(review());
      const dead = (await store.begin('T-1:abc', STALE))!;
      await backdateReview(database, 'T-1:abc', STALE + 20_000);
      const successor = (await store.begin('T-1:abc', STALE))!;

      expect(await store.resolve('T-1:abc', dead.token, answer)).toBe(false);
      await store.release('T-1:abc', dead.token); // does not put it back under the successor
      expect((await store.find('T-1:abc'))?.status).toBe('deciding');
      expect(await store.resolve('T-1:abc', successor.token, answer)).toBe(true);
    });

    it('lets exactly one of several callers take it over', async () => {
      const { store, database } = await setup();
      await store.open(review());
      await store.begin('T-1:abc', STALE);
      await backdateReview(database, 'T-1:abc', STALE + 20_000);
      const leases = await Promise.all(Array.from({ length: 10 }, () => store.begin('T-1:abc', STALE)));
      expect(leases.filter(Boolean)).toHaveLength(1);
    });

    it('never takes over a review that is waiting or already answered', async () => {
      const { store, database } = await setup();
      await store.open(review());
      await backdateReview(database, 'T-1:abc', STALE * 10); // no decider, so nothing to take over: it is just waiting
      expect((await store.begin('T-1:abc', STALE))?.review.status).toBe('deciding');

      const { store: other } = await setup();
      await other.open(review());
      const lease = (await other.begin('T-1:abc', STALE))!;
      await other.resolve('T-1:abc', lease.token, answer);
      expect(await other.begin('T-1:abc', 0)).toBeUndefined();
    });
  });
});
