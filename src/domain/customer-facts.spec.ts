import { describe, expect, it } from 'vitest';

import {
  checkRefundEligibility,
  decideOutcome,
  orderChangedOutcome,
  refundAlreadyRecordedOutcome,
  refundFailureOutcome,
  reviewedOutcome,
  templateReply,
  type Classification,
  type Order,
  type Outcome,
} from './index.js';
import { NOW, createTestContainer } from '../../test/support/helpers.js';
import { checkReply } from '../guardrails/output.util.js';

/*
 * The customer-facing facts are the words a model is told to use, and the fallback template repeats them. The output
 * guard must accept a reply made of exactly those words, or a perfectly good draft is thrown away for repeating
 * what it was given (found with the real model: "before any money is returned" tripped the money-promise pattern).
 */
const { config: policy } = await (await createTestContainer()).policies.loadSnapshot();

const order: Order = {
  orderId: 'ORD-1',
  customerEmail: 'a@b.com',
  item: 'Desk Lamp',
  category: 'physical',
  amount: 40,
  status: 'delivered',
  deliveredAt: '2026-10-25',
  refunded: false,
};
const ticket = { ticketId: 'T-1', subject: 'Refund', body: 'I want my money back.' };
const classification: Classification = {
  intent: 'refund_request',
  refundReason: 'changed_mind',
  urgency: 'normal',
  orderIdMentioned: null,
  refundRequestQuote: 'I want my money back.',
};

const decided = (
  over: Partial<Order>,
  reason: Classification['refundReason'] = 'changed_mind',
  flags: string[] = [],
) => {
  const subject = { ...order, ...over };
  const eligibility = checkRefundEligibility(subject, reason, NOW, policy);
  return decideOutcome({
    flags,
    ticket,
    classification: { ...classification, refundReason: reason },
    lookup: 'found',
    order: subject,
    eligibility,
  });
};

const scenarios: Record<string, Outcome> = {
  'over the approval limit': decided({ amount: 149 }),
  'digital goods': decided({ category: 'digital' }),
  'final sale': decided({ category: 'final_sale' }),
  'outside the return window': decided({ deliveredAt: '2026-07-01' }),
  'a defect claim after the return window': decided({ deliveredAt: '2026-09-20' }, 'defective'),
  'already refunded': decided({ refunded: true }),
  'not delivered yet': decided({ status: 'shipped', deliveredAt: null }),
  'a delivery date in the future': decided({ deliveredAt: '2030-01-01' }),
  'a refund request the quote does not support': decideOutcome({
    flags: [],
    ticket,
    classification: { ...classification, refundRequestQuote: null },
    lookup: 'found',
    order,
    eligibility: checkRefundEligibility(order, 'changed_mind', NOW, policy),
  }),
  'a suspected injection': decideOutcome({ flags: ['prompt_injection_suspected'], lookup: 'skipped' }),
  'two different order ids': decideOutcome({ flags: ['order_id_conflict'], lookup: 'skipped' }),
  'no classification': decideOutcome({ flags: ['classifier_failed'], lookup: 'skipped' }),
  'an order that changed while a review waited': orderChangedOutcome('the amount went from 149.00 to 20.00', order, []),
  'an approval the store then refused': refundFailureOutcome('already_refunded', order),
  'a reviewer saying no': reviewedOutcome({ action: 'deny', reviewer: 'Maria', note: 'n' }, order, ['R5']),
};

describe('what the customer is told', () => {
  for (const [name, outcome] of Object.entries(scenarios)) {
    it(`passes the output guard when repeated back, for ${name}`, () => {
      const reply = templateReply({
        ticket: { ...ticket, customerEmail: 'a@b.com' },
        decision: outcome.decision,
        facts: outcome.facts,
        policyNotes: [],
        refundAmount: outcome.refundAmount,
      });
      const problems = checkReply(reply, {
        decision: outcome.decision,
        orderIds: [order.orderId],
        refundAmount: outcome.refundAmount,
        allowedText: outcome.facts,
      });
      expect(problems, reply).toEqual([]);
    });
  }

  it('is also true of the refund that was already recorded for the ticket', () => {
    const outcome = refundAlreadyRecordedOutcome({ ...order, refunded: true, refundedAmount: 40 });
    const reply = templateReply({
      ticket: { ...ticket, customerEmail: 'a@b.com' },
      decision: 'approve',
      facts: outcome.facts,
      policyNotes: [],
      refundAmount: 40,
    });
    expect(
      checkReply(reply, { decision: 'approve', orderIds: ['ORD-1'], refundAmount: 40, allowedText: outcome.facts }),
    ).toEqual([]);
  });

  it('is also true of every policy rule, which a reply may quote when a decision cites it', async () => {
    const { rules } = await (await createTestContainer()).policies.loadSnapshot();
    for (const rule of rules) {
      const note = `${rule.id} ${rule.title}: ${rule.text}`;
      for (const decision of ['deny', 'escalate'] as const) {
        const reply = templateReply({
          ticket: { ...ticket, customerEmail: 'a@b.com' },
          decision,
          facts: ['Regarding order ORD-1 (Desk Lamp).'],
          policyNotes: [note],
          refundAmount: 0,
        });
        const problems = checkReply(reply, {
          decision,
          orderIds: ['ORD-1'],
          refundAmount: 0,
          allowedText: ['Regarding order ORD-1 (Desk Lamp).', note],
        });
        expect(problems, `${rule.id} in a ${decision}: ${reply}`).toEqual([]);
      }
    }
  });
});
