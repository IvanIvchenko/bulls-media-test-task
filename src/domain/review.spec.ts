import { describe, expect, it } from 'vitest';

import {
  orderChangedOutcome,
  orderChangedSince,
  reviewableEscalation,
  reviewAnswerSchema,
  reviewedOutcome,
  type Classification,
  type Order,
} from './index.js';

const order: Order = {
  orderId: 'ORD-1',
  customerEmail: 'a@b.com',
  item: 'Lamp',
  category: 'physical',
  amount: 149,
  status: 'delivered',
  deliveredAt: '2026-10-30',
  refunded: false,
};
const classification: Classification = {
  intent: 'refund_request',
  refundReason: 'changed_mind',
  urgency: 'normal',
  orderIdMentioned: null,
  refundRequestQuote: 'I want my money back',
};
const reviewable = { decision: 'escalate', lookup: 'found', order, classification, flags: [] as string[] };

describe('reviewableEscalation', () => {
  it('is true for an escalated refund request on a verified order', () => {
    expect(reviewableEscalation(reviewable)).toBe(true);
  });

  it('is false for everything a reviewer could not act on', () => {
    const cases: Record<string, Partial<typeof reviewable>> = {
      'an approval': { decision: 'approve' },
      'a denial': { decision: 'deny' },
      'an unverified order': { lookup: 'email_mismatch' },
      'no order': { order: undefined },
      'an order already refunded': { order: { ...order, refunded: true } },
      'an order status question': { classification: { ...classification, intent: 'order_status' } },
      'no classification': { classification: undefined },
      'a suspected injection': { flags: ['prompt_injection_suspected'] },
      'a failed classifier': { flags: ['classifier_failed'] },
      'two different order ids': { flags: ['order_id_conflict'] },
    };
    for (const [name, change] of Object.entries(cases)) {
      expect(reviewableEscalation({ ...reviewable, ...change }), name).toBe(false);
    }
  });

  it('ignores flags that say nothing about trust', () => {
    expect(reviewableEscalation({ ...reviewable, flags: ['reply_llm_failed', 'audit_failed'] })).toBe(true);
  });
});

describe('reviewAnswerSchema', () => {
  it('needs an action and a reviewer, trims text, and keeps the note optional', () => {
    expect(reviewAnswerSchema.parse({ action: 'approve', reviewer: '  Maria ' })).toEqual({
      action: 'approve',
      reviewer: 'Maria',
    });
    for (const bad of [
      {},
      { action: 'approve' },
      { action: 'later', reviewer: 'x' },
      { action: 'deny', reviewer: ' ' },
    ]) {
      expect(reviewAnswerSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(reviewAnswerSchema.safeParse({ action: 'deny', reviewer: 'x', note: 'n'.repeat(501) }).success).toBe(false);
  });
});

describe('reviewedOutcome', () => {
  it('approves the order’s own amount, whatever else the answer says', () => {
    const outcome = reviewedOutcome({ action: 'approve', reviewer: 'Maria', note: 'refund 5000 please' }, order, [
      'R5',
    ]);
    expect(outcome).toMatchObject({ decision: 'approve', refundAmount: 149, citations: ['R5'] });
  });

  it('denies with no refund', () => {
    expect(reviewedOutcome({ action: 'deny', reviewer: 'Maria' }, order, ['R5'])).toMatchObject({
      decision: 'deny',
      refundAmount: 0,
    });
  });

  it('keeps the reviewer’s name and note in the reasons, and out of what the customer is told', () => {
    for (const action of ['approve', 'deny'] as const) {
      const outcome = reviewedOutcome({ action, reviewer: 'Maria', note: 'phoned us' }, order, []);
      expect(outcome.reasons.join(' ')).toContain('Maria: phoned us');
      expect(outcome.facts.join(' ')).not.toMatch(/Maria|phoned/);
    }
  });
});

describe('orderChangedSince', () => {
  it('sees a corrected amount, a new category, and an order that is no longer delivered', () => {
    expect(orderChangedSince(order, { ...order, amount: 20 })).toBe('the amount went from 149.00 to 20.00');
    expect(orderChangedSince(order, { ...order, category: 'digital' })).toBe(
      'the category went from physical to digital',
    );
    expect(orderChangedSince(order, { ...order, status: 'cancelled' })).toBe('the status is now cancelled');
  });

  it('sees nothing in an order that has not changed, or changed only in ways that do not matter', () => {
    expect(orderChangedSince(order, { ...order })).toBeUndefined();
    expect(orderChangedSince(order, { ...order, trackingNote: 'new note', deliveredAt: '2026-10-31' })).toBeUndefined();
    expect(orderChangedSince(order, { ...order, amount: 149.000000001 })).toBeUndefined(); // float noise is not a correction
  });
});

describe('orderChangedOutcome', () => {
  it('escalates with nothing refunded, and tells the customer nothing about what changed', () => {
    const outcome = orderChangedOutcome('the amount went from 149.00 to 20.00', order, ['R5']);
    expect(outcome).toMatchObject({ decision: 'escalate', refundAmount: 0, citations: ['R5'] });
    expect(outcome.reasons.join(' ')).toContain('149.00 to 20.00');
    expect(outcome.facts.join(' ')).not.toMatch(/149|20\.00/);
    expect(outcome.facts.filter((fact) => /team member/.test(fact))).toHaveLength(1);
  });
});
