import { describe, expect, it } from 'vitest';

import { templateReply, type ReplyContext } from './index.js';
import { checkReply } from '../guardrails/output.util.js';

const base: ReplyContext = {
  ticket: { ticketId: 'T-1', customerEmail: 'a@b.com', subject: 'Refund', body: 'Please refund.' },
  decision: 'approve',
  facts: ['Order ORD-1001 (Wireless Headphones).', 'Within 30-day window.'],
  policyNotes: ['R1 Return window: Physical items may be refunded within 30 days.'],
  refundAmount: 59.9,
};

describe('templateReply', () => {
  it('states the outcome for each decision', () => {
    expect(templateReply({ ...base, decision: 'approve' })).toMatch(/refund of 59\.90 has been approved/);
    expect(templateReply({ ...base, decision: 'deny' })).toMatch(/cannot refund/);
    expect(templateReply({ ...base, decision: 'escalate' })).toMatch(/review by a team member/);
    expect(templateReply({ ...base, decision: 'refuse' })).toMatch(/could not verify/);
    expect(templateReply({ ...base, decision: 'info' })).toContain('Order ORD-1001');
  });

  it('quotes the cited policy only when explaining a denial', () => {
    expect(templateReply({ ...base, decision: 'deny' })).toContain('Relevant policy: R1 Return window');
    for (const decision of ['approve', 'escalate', 'refuse', 'info'] as const) {
      expect(templateReply({ ...base, decision })).not.toContain('Relevant policy');
    }
  });

  it('tells an unverified requester nothing about the order', () => {
    const reply = templateReply({ ...base, decision: 'refuse' });
    expect(reply).not.toMatch(/ORD-|Headphones|30/);
  });

  it('always passes the output guard, since it is the fallback when a model draft is rejected', () => {
    for (const decision of ['approve', 'deny', 'escalate', 'refuse', 'info'] as const) {
      const reply = templateReply({ ...base, decision });
      const guardContext = {
        decision,
        orderIds: ['ORD-1001'],
        refundAmount: base.refundAmount,
        allowedText: [...base.facts, ...base.policyNotes],
      };
      expect(checkReply(reply, guardContext), decision).toEqual([]);
    }
  });

  it('only promises a refund when the decision is approve', () => {
    for (const decision of ['deny', 'escalate', 'refuse', 'info'] as const) {
      expect(templateReply({ ...base, decision })).not.toMatch(/has been approved/i);
    }
  });
});
