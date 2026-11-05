import { describe, expect, it, vi } from 'vitest';

import { ApprovalsService } from './approvals.service.js';
import { backdateReview, createTestContainer } from '../../test/support/helpers.js';
import type { NewReview, Result, ResumedReview } from '../domain/index.js';

const pendingResult: Result = {
  ticketId: 'T-1',
  decision: 'escalate',
  refundAmount: 0,
  intent: 'refund_request',
  reasons: ['big'],
  policyCitations: [],
  handoff: null,
  flags: [],
  reply: 'ok',
  summary: 's',
  trace: [],
  review: { status: 'pending' },
  usage: { llmCalls: 0, inputTokens: 0, outputTokens: 0, llmMs: 0 },
};
const approvedBy = (reviewer: string, note?: string): Result => ({
  ...pendingResult,
  decision: 'approve',
  refundAmount: 149,
  review: { status: 'approved', reviewer, note },
});
const finalResult = approvedBy('Maria');
const review: NewReview = { reviewId: 'T-1:abc', ticketId: 'T-1', threadId: 'thread', request: pendingResult };
const approve = { action: 'approve', reviewer: 'Maria' };

const STALE = 60_000;

const resumed = (result: Result, consumed = true): ResumedReview => ({ result, consumed });

async function setup(resume = vi.fn(async (): Promise<ResumedReview> => resumed(finalResult))) {
  const container = await createTestContainer();
  const token = await container.claims.tryClaim('T-1:abc', 'hash');
  await container.claims.complete('T-1:abc', token!, pendingResult);
  await container.reviews.open(review);
  const discard = vi.fn(async () => undefined);
  return {
    container,
    resume,
    discard,
    service: new ApprovalsService(container.reviews, container.claims, { resume, discard }, STALE),
  };
}
const recorded = async (container: Awaited<ReturnType<typeof setup>>['container']) =>
  container.database('pending_reviews').where({ review_id: 'T-1:abc' }).first('status', 'decision', 'reviewer', 'note');

describe('ApprovalsService.decide', () => {
  it('resumes the run, replaces the ticket’s stored decision, closes the review and forgets the saved run', async () => {
    const { container, resume, discard, service } = await setup();
    expect(await service.decide('T-1:abc', approve)).toEqual(finalResult);

    expect(resume).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'thread' }), approve);
    expect((await container.claims.find('T-1:abc'))?.result?.decision).toBe('approve');
    expect(await container.reviews.list()).toEqual([]);
    expect(await recorded(container)).toMatchObject({ status: 'resolved', decision: 'approve', reviewer: 'Maria' });
    expect(discard).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'thread' }));
  });

  it('puts the review back to waiting if the run cannot be continued, keeping the saved run', async () => {
    const { container, discard, service } = await setup(vi.fn(async () => Promise.reject(new Error('model down'))));
    await expect(service.decide('T-1:abc', approve)).rejects.toThrow('model down');

    expect((await container.reviews.find('T-1:abc'))?.status).toBe('pending');
    expect((await container.claims.find('T-1:abc'))?.result?.decision).toBe('escalate'); // nothing was replaced
    expect(discard).not.toHaveBeenCalled();
  });

  it('puts the review back, with the saved run kept, if recording the answer fails after the run finished', async () => {
    const { container, discard, service } = await setup();
    vi.spyOn(container.claims, 'replaceResult').mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.decide('T-1:abc', approve)).rejects.toThrow('database unavailable');

    expect((await container.reviews.find('T-1:abc'))?.status).toBe('pending');
    expect(discard).not.toHaveBeenCalled();
  });

  describe('when an earlier answer was already applied (money may have moved on it)', () => {
    it('records the answer that was applied, not the one just given, and tells the caller theirs was not used', async () => {
      // Maria approved and the payment went through, but recording failed. Boris now says no; the run carries on
      // with Maria's approval and returns it.
      const { container, discard, service } = await setup(
        vi.fn(async () => resumed(approvedBy('Maria', 'phoned us'), false)),
      );
      await expect(service.decide('T-1:abc', { action: 'deny', reviewer: 'Boris' })).rejects.toMatchObject({
        code: 'REVIEW_ALREADY_ANSWERED',
        message: expect.stringContaining('Maria (approve)'),
      });

      expect(await recorded(container)).toEqual({
        status: 'resolved',
        decision: 'approve',
        reviewer: 'Maria',
        note: 'phoned us',
      });
      expect((await container.claims.find('T-1:abc'))?.result).toMatchObject({ decision: 'approve' }); // what happened
      expect(discard).toHaveBeenCalled();
    });

    it('still tells the caller when their answer says the same thing: it was not the one used', async () => {
      const { container, service } = await setup(vi.fn(async () => resumed(approvedBy('Maria'), false)));
      await expect(service.decide('T-1:abc', { action: 'approve', reviewer: 'Boris' })).rejects.toMatchObject({
        code: 'REVIEW_ALREADY_ANSWERED',
        message: expect.stringContaining('which says the same as yours'),
      });
      expect(await recorded(container)).toMatchObject({ decision: 'approve', reviewer: 'Maria' }); // who it really was
    });

    it('does not say so when the answer given was the one used', async () => {
      const { service } = await setup(vi.fn(async () => resumed(approvedBy('Maria'), true)));
      await expect(service.decide('T-1:abc', approve)).resolves.toMatchObject({ review: { reviewer: 'Maria' } });
    });
  });

  it('does not resume at all for a malformed answer, a missing review or one already answered', async () => {
    const { service, resume } = await setup();
    await expect(service.decide('T-1:abc', { action: 'maybe' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(service.decide('nope', approve)).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND' });
    await service.decide('T-1:abc', approve);
    await expect(service.decide('T-1:abc', approve)).rejects.toMatchObject({ code: 'REVIEW_NOT_PENDING' });
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('still records the answer when the ticket’s claim has already been pruned', async () => {
    const { container, service } = await setup();
    await container.database('ticket_claims').del();
    await expect(service.decide('T-1:abc', approve)).resolves.toEqual(finalResult);
    expect((await container.reviews.find('T-1:abc'))?.status).toBe('resolved');
  });

  it('does not fail an answered review because the saved run could not be deleted', async () => {
    const { container, discard, service } = await setup();
    discard.mockRejectedValueOnce(new Error('cleanup failed'));
    await expect(service.decide('T-1:abc', approve)).resolves.toEqual(finalResult);
    expect((await container.reviews.find('T-1:abc'))?.status).toBe('resolved');
  });

  describe('a review stuck in "deciding" because its decider died', () => {
    it('is taken over by the next answer once the decider has been at it too long, and answered once', async () => {
      const { container, resume, service } = await setup();
      await container.reviews.begin('T-1:abc', STALE); // a decider that then crashed, never recording
      await expect(service.decide('T-1:abc', approve)).rejects.toMatchObject({ code: 'REVIEW_NOT_PENDING' }); // too soon

      await backdateReview(container.database, 'T-1:abc', STALE + 20_000);
      await expect(service.decide('T-1:abc', approve)).resolves.toEqual(finalResult);
      expect(resume).toHaveBeenCalledTimes(1);
      expect(await recorded(container)).toMatchObject({ status: 'resolved', decision: 'approve', reviewer: 'Maria' });
    });

    it('does not let a decider that was taken over record its answer when it finally finishes', async () => {
      // The slow call is still running when its review is taken over and answered by someone else.
      const held: { database?: Awaited<ReturnType<typeof setup>>['container']['database'] } = {};
      const slow = vi.fn(async () => {
        const database = held.database!;
        await backdateReview(database, 'T-1:abc', STALE + 20_000);
        const successor = await prepared.container.reviews.begin('T-1:abc', STALE);
        await prepared.container.reviews.resolve('T-1:abc', successor!.token, { action: 'deny', reviewer: 'Boris' });
        return resumed(finalResult); // the slow decider carries on and finishes, too late
      });
      const prepared = await setup(slow);
      held.database = prepared.container.database;
      const container = prepared.container;

      await expect(prepared.service.decide('T-1:abc', approve)).rejects.toMatchObject({ code: 'REVIEW_NOT_PENDING' });
      expect(await recorded(container)).toMatchObject({ status: 'resolved', decision: 'deny', reviewer: 'Boris' });
      expect(prepared.discard).not.toHaveBeenCalled();
    });
  });
});
