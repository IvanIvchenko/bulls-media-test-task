import { describe, expect, it, vi } from 'vitest';

import { answered } from '../../../test/support/llm.js';
import { fakeLlm, stateWith, ticket } from '../../../test/support/nodes.js';
import type { AgentState } from '../typedef.js';
import { DraftReplyNode } from './draft-reply.node.js';

describe('DraftReplyNode', () => {
  const replyState = (patch: Partial<AgentState> = {}) =>
    stateWith({
      ticket,
      orderId: 'ORD-1001',
      decision: 'deny',
      facts: ['Order ORD-1001 (Wireless Headphones).', 'Delivered 95 days ago; the return window is 30 days.'],
      reasons: ['Outside the window.'],
      ...patch,
    });

  it('uses the model draft when it passes the guard', async () => {
    const update = await new DraftReplyNode(fakeLlm()).execute(replyState());
    expect(update.reply).toBe('Hello, we cannot refund this order.');
    expect(update.flags).toBeUndefined();
  });

  it('falls back to the template, and says so, when the guard rejects the draft', async () => {
    const promising = fakeLlm({ draftReply: async () => answered('Good news, we will refund you in full!') });
    const update = await new DraftReplyNode(promising).execute(replyState());
    expect(update.flags).toEqual(['reply_rejected_by_guard']);
    expect(update.reply).toMatch(/unfortunately we cannot refund/i);
    expect(update.trace?.[0]).toMatchObject({ ok: false, detail: expect.stringContaining('promises money') });
  });

  it('lets the guard check numbers against the facts: an invented deadline is rejected, a real one is not', async () => {
    const invented = fakeLlm({
      draftReply: async () => answered('We cannot refund this, but a colleague will write within 2 days.'),
    });
    expect((await new DraftReplyNode(invented).execute(replyState())).flags).toEqual(['reply_rejected_by_guard']);

    const real = fakeLlm({
      draftReply: async () =>
        answered('We cannot refund this: it was delivered 95 days ago and the window is 30 days.'),
    });
    expect((await new DraftReplyNode(real).execute(replyState())).flags).toBeUndefined();
  });

  it('falls back to the template, and says so, when the model fails', async () => {
    const down = fakeLlm({
      draftReply: async () => {
        throw new Error('boom anna@example.com');
      },
    });
    const update = await new DraftReplyNode(down).execute(replyState());
    expect(update.flags).toEqual(['reply_llm_failed']);
    expect(update.reply).toBeTruthy();
    expect(JSON.stringify(update.trace)).not.toMatch(/boom|anna@/);
  });

  it('never calls the model for a request that did not validate', async () => {
    const draftReply = vi.fn(async () => answered('never used'));
    const update = await new DraftReplyNode(fakeLlm({ draftReply })).execute(
      stateWith({ decision: 'refuse', reasons: ['Invalid ticket input.'] }),
    );
    expect(draftReply).not.toHaveBeenCalled();
    expect(update.reply).toMatch(/could not verify/i);
  });

  it('never shows the model the internal reasons, even when there are no facts', async () => {
    const draftReply = vi.fn(async () => answered('Hello.'));
    await new DraftReplyNode(fakeLlm({ draftReply })).execute(replyState({ facts: [] }));
    expect(draftReply).toHaveBeenCalledWith(expect.objectContaining({ facts: [] }));
  });
});
