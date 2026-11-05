import { describe, expect, it } from 'vitest';

import { decideOutcome, refundFailureOutcome } from './index.js';
import type { Classification, Order } from './index.js';

const cls = (o: Partial<Classification> = {}): Classification => ({
  intent: 'refund_request',
  refundReason: 'changed_mind',
  urgency: 'normal',
  orderIdMentioned: null,
  refundRequestQuote: 'I want my money back.',
  ...o,
});
const order: Order = {
  orderId: 'ORD-1',
  customerEmail: 'a@b.com',
  item: 'Lamp',
  category: 'physical',
  amount: 40,
  status: 'delivered',
  deliveredAt: '2026-10-30',
  refunded: false,
};
const base = {
  ticket: { ticketId: 'T-1', subject: 'Refund', body: 'I want my money back.' },
  flags: [] as string[],
  classification: cls(),
  lookup: 'found' as const,
  order,
  eligibility: { verdict: 'approve' as const, reasons: ['ok'], facts: ['fine'], citations: ['R1'] },
};

describe('decideOutcome (pure policy)', () => {
  it('approves with amount when eligible', () => {
    expect(decideOutcome(base)).toMatchObject({ decision: 'approve', refundAmount: 40 });
  });
  it("safety flags beat everything, even an 'approve' verdict", () => {
    for (const f of ['classifier_failed', 'prompt_injection_suspected', 'order_id_conflict']) {
      expect(decideOutcome({ ...base, flags: [f] }).decision).toBe('escalate');
    }
  });
  it('escalates out-of-scope intents', () => {
    expect(decideOutcome({ ...base, classification: cls({ intent: 'other' }) }).decision).toBe('escalate');
  });
  it("does not approve on the model's word alone: its quote of the request must be in the ticket", () => {
    const ticket = {
      ticketId: 'T-1',
      subject: 'My order',
      body: 'The headphones arrived yesterday. I want my money back.',
    };
    const withQuote = (refundRequestQuote: string | null) =>
      decideOutcome({ ...base, ticket, classification: cls({ refundRequestQuote }) });

    expect(withQuote('I want my money back.').decision).toBe('approve');
    for (const quote of [null, 'Please refund me in full', 'The headphones are lovely']) {
      expect(withQuote(quote), String(quote)).toMatchObject({ decision: 'escalate', refundAmount: 0, citations: [] });
    }
    expect(decideOutcome({ ...base, ticket: undefined }).decision).toBe('escalate'); // fails closed
  });
  it('tells the customer the same thing whichever way verification failed', () => {
    const facts = (lookup: 'not_found' | 'email_mismatch') =>
      decideOutcome({ ...base, lookup, order: undefined }).facts;
    expect(facts('not_found')).toEqual(facts('email_mismatch'));
  });
  it('keeps what the reviewer reads out of what the customer is told', () => {
    for (const verdict of ['approve', 'deny', 'escalate'] as const) {
      const outcome = decideOutcome({
        ...base,
        eligibility: { verdict, reasons: ['INTERNAL REASON'], facts: ['for the customer'], citations: ['R1'] },
      });
      expect(outcome.reasons, verdict).toEqual(['INTERNAL REASON']);
      expect(outcome.facts.join(' '), verdict).toContain('for the customer');
      expect(outcome.facts.join(' '), verdict).not.toContain('INTERNAL');
    }
  });
  it('says a team member will review it exactly once for an escalation', () => {
    const outcome = decideOutcome({
      ...base,
      eligibility: { verdict: 'escalate', reasons: ['big'], facts: ['large'], citations: ['R5'] },
    });
    expect(outcome.facts.filter((fact) => /team member/.test(fact))).toHaveLength(1);
  });
  describe('a ticket whose refund was already recorded', () => {
    const paid: Order = { ...order, refunded: true, refundedByTicket: 'T-1', refundedAmount: 35 };

    it('is answered with that refund again, for the amount that was paid, whatever else would be said', () => {
      const outcome = decideOutcome({ ...base, order: paid, eligibility: undefined });
      expect(outcome).toMatchObject({ decision: 'approve', refundAmount: 35, citations: [] });
      expect(outcome.reasons.join(' ')).toMatch(/already recorded/);
    });

    it('does not need the model to have quoted a request again', () => {
      const outcome = decideOutcome({ ...base, order: paid, classification: cls({ refundRequestQuote: null }) });
      expect(outcome.decision).toBe('approve');
    });

    it('is not done for a refund made by a different ticket: that is an ordinary already-refunded order', () => {
      const other = { ...paid, refundedByTicket: 'T-OTHER' };
      const eligibility = { verdict: 'deny' as const, reasons: ['r'], facts: ['f'], citations: ['R6'] };
      expect(decideOutcome({ ...base, order: other, eligibility })).toMatchObject({ decision: 'deny' });
    });

    it('falls back to the order amount if the refund record says nothing', () => {
      const outcome = decideOutcome({ ...base, order: { ...paid, refundedAmount: undefined } });
      expect(outcome.refundAmount).toBe(40);
    });

    it('still lets safety flags win', () => {
      expect(decideOutcome({ ...base, order: paid, flags: ['prompt_injection_suspected'] }).decision).toBe('escalate');
    });
  });

  it('refuses unverifiable orders with no refund amount and no details', () => {
    for (const lookup of ['not_found', 'email_mismatch'] as const) {
      const o = decideOutcome({ ...base, lookup, order: undefined });
      expect(o).toMatchObject({ decision: 'refuse', refundAmount: 0 });
      expect(o.facts.join(' ')).not.toMatch(/ORD-|Lamp|email_mismatch|not_found/); // nothing about the order
    }
  });
  it('fails closed when expected data is missing', () => {
    expect(decideOutcome({ ...base, eligibility: undefined }).decision).toBe('escalate');
    expect(decideOutcome({ ...base, order: undefined }).decision).toBe('escalate');
  });
  it('maps deny and escalate verdicts through with citations', () => {
    expect(
      decideOutcome({
        ...base,
        eligibility: { verdict: 'deny', reasons: ['no'], facts: ['sorry'], citations: ['R4'] },
      }),
    ).toMatchObject({ decision: 'deny', citations: ['R4'], refundAmount: 0 });
    expect(
      decideOutcome({
        ...base,
        eligibility: { verdict: 'escalate', reasons: ['big'], facts: ['large'], citations: ['R5'] },
      }).decision,
    ).toBe('escalate');
  });
});

describe('refundFailureOutcome', () => {
  it('denies under the already-refunded rule when the order was refunded in the meantime', () => {
    const outcome = refundFailureOutcome('already_refunded', order);
    expect(outcome).toMatchObject({ decision: 'deny', refundAmount: 0, citations: ['R6'] });
    expect(outcome.reasons).toEqual(['The order was already refunded.']);
  });

  it('sends anything else to a human', () => {
    const outcome = refundFailureOutcome('not_found', order);
    expect(outcome).toMatchObject({ decision: 'escalate', refundAmount: 0, citations: [] });
  });

  it('says nothing that belongs to the approval it replaces', () => {
    for (const reason of ['already_refunded', 'not_found'] as const) {
      const text = JSON.stringify(refundFailureOutcome(reason, order));
      expect(text).not.toMatch(/window|auto-approval|under/i);
    }
  });
});
