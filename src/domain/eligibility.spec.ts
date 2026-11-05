import { describe, expect, it } from 'vitest';

import { checkRefundEligibility } from './index.js';
import type { Order } from './index.js';
import { NOW, createTestContainer } from '../../test/support/helpers.js';

const { config: policy } = await (await createTestContainer()).policies.loadSnapshot();

const order = (o: Partial<Order> = {}): Order => ({
  orderId: 'ORD-1',
  customerEmail: 'a@b.com',
  item: 'x',
  category: 'physical',
  amount: 50,
  status: 'delivered',
  deliveredAt: '2026-10-20',
  refunded: false,
  ...o,
});

describe('checkRefundEligibility', () => {
  it('approves inside window under limit', () => {
    expect(checkRefundEligibility(order(), 'changed_mind', NOW, policy).verdict).toBe('approve');
  });
  it('escalates above the auto-approval limit', () => {
    expect(checkRefundEligibility(order({ amount: 100.01 }), 'changed_mind', NOW, policy).verdict).toBe('escalate');
  });
  it('approves exactly at the limit', () => {
    expect(checkRefundEligibility(order({ amount: 100 }), 'changed_mind', NOW, policy).verdict).toBe('approve');
  });
  it('denies after 30 days, but sends a defect claim up to 60 days to a human, whatever the amount', () => {
    const o = order({ deliveredAt: '2026-09-20' }); // 45 days
    expect(checkRefundEligibility(o, 'changed_mind', NOW, policy).verdict).toBe('deny');
    for (const reason of ['defective', 'not_as_described'] as const) {
      const claim = checkRefundEligibility(o, reason, NOW, policy);
      expect(claim.verdict, reason).toBe('escalate');
      expect(claim.citations).toEqual(['R2', 'R1']);
      expect(claim.reasons.join(' ')).toMatch(/45 days ago.*verify/);
    }
    expect(checkRefundEligibility(order({ ...o, amount: 5000 }), 'defective', NOW, policy).verdict).toBe('escalate');
  });

  it('never lets the customer-reported reason make the outcome more lenient', () => {
    // Every age from delivery day to well past the defect window, every reason the model can give.
    for (let age = 0; age <= 90; age++) {
      const deliveredAt = new Date(NOW.getTime() - age * 86_400_000).toISOString().slice(0, 10);
      const plain = checkRefundEligibility(order({ deliveredAt }), 'changed_mind', NOW, policy).verdict;
      for (const reason of ['defective', 'not_as_described', 'late_delivery', 'other', null] as const) {
        const claimed = checkRefundEligibility(order({ deliveredAt }), reason, NOW, policy).verdict;
        if (claimed === 'approve') expect(plain, `${reason} at ${age} days`).toBe('approve');
      }
    }
  });

  it('treats a defect claim inside the return window exactly like any other reason', () => {
    const o = order({ deliveredAt: '2026-10-20' }); // 15 days
    expect(checkRefundEligibility(o, 'defective', NOW, policy)).toEqual(
      checkRefundEligibility(o, 'changed_mind', NOW, policy),
    );
  });
  it('denies defects after 60 days', () => {
    expect(checkRefundEligibility(order({ deliveredAt: '2026-08-01' }), 'defective', NOW, policy).verdict).toBe('deny');
  });
  it('denies refunded, final sale and undelivered; escalates digital', () => {
    expect(checkRefundEligibility(order({ refunded: true }), null, NOW, policy).verdict).toBe('deny');
    expect(checkRefundEligibility(order({ category: 'final_sale' }), 'defective', NOW, policy).verdict).toBe('deny');
    expect(checkRefundEligibility(order({ status: 'shipped', deliveredAt: null }), null, NOW, policy).verdict).toBe(
      'deny',
    );
    expect(checkRefundEligibility(order({ category: 'digital' }), 'defective', NOW, policy).verdict).toBe('escalate');
  });

  it('sends an order with a delivery date in the future to a human instead of approving it', () => {
    const future = checkRefundEligibility(order({ deliveredAt: '2030-01-01' }), 'changed_mind', NOW, policy);
    expect(future.verdict).toBe('escalate');
    expect(future.reasons.join(' ')).toMatch(/future/i);
  });

  it('still treats delivery today as day zero, inside the window', () => {
    expect(checkRefundEligibility(order({ deliveredAt: '2026-11-04' }), 'changed_mind', NOW, policy).verdict).toBe(
      'approve',
    );
  });
});
