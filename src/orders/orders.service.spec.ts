import { describe, expect, it } from 'vitest';

import { NOW, createTestContainer } from '../../test/support/helpers.js';
import type { Order } from '../domain/index.js';

const order = (over: Partial<Order> = {}): Order => ({
  orderId: 'ORD-1',
  customerEmail: 'a@b.com',
  item: 'x',
  category: 'physical',
  amount: 50,
  status: 'delivered',
  deliveredAt: '2026-10-20',
  refunded: false,
  ...over,
});

const ordersWith = async (...orders: Order[]) => (await createTestContainer({ orders })).orders;

describe('OrdersService', () => {
  it('enforces ownership and is case-insensitive on email', async () => {
    const orders = await ordersWith(order());
    expect((await orders.lookupOrder('ORD-1', 'A@B.com')).found).toBe(true);
    expect(await orders.lookupOrder('ORD-1', 'evil@x.com')).toEqual({ found: false, reason: 'email_mismatch' });
    expect(await orders.lookupOrder('ORD-2', 'a@b.com')).toEqual({ found: false, reason: 'not_found' });
  });

  it('maps a stored order back to the domain shape, including the optional tracking note', async () => {
    const orders = await ordersWith(order({ status: 'shipped', deliveredAt: null, trackingNote: 'In transit' }));
    expect(await orders.lookupOrder('ORD-1', 'a@b.com')).toEqual({
      found: true,
      order: order({ status: 'shipped', deliveredAt: null, trackingNote: 'In transit' }),
    });
  });

  it('refuses a double refund', async () => {
    const orders = await ordersWith(order());
    expect(await orders.recordRefund('ORD-1', 'T-1', 50, NOW)).toEqual({ ok: true });
    expect(await orders.recordRefund('ORD-1', 'T-2', 50, NOW)).toEqual({ ok: false, reason: 'already_refunded' });
  });

  it('reports unknown orders and persists the refund flag', async () => {
    const orders = await ordersWith(order());
    expect(await orders.recordRefund('ORD-404', 'T-1', 1, NOW)).toEqual({ ok: false, reason: 'not_found' });
    await orders.recordRefund('ORD-1', 'T-1', 50, NOW);
    expect(await orders.lookupOrder('ORD-1', 'a@b.com')).toMatchObject({ order: { refunded: true } });
  });

  describe('recordRefund and retries', () => {
    it('lets the same ticket ask again without refunding twice (a retry after a crash)', async () => {
      const container = await createTestContainer({ orders: [order()] });
      expect(await container.orders.recordRefund('ORD-1', 'T-1', 50, NOW)).toEqual({ ok: true });
      expect(await container.orders.recordRefund('ORD-1', 'T-1', 50, NOW)).toEqual({ ok: true });
      expect(await container.database('refunds').count({ n: '*' }).first()).toEqual({ n: 1 });
    });

    it('still refuses a different ticket for an order that was refunded', async () => {
      const container = await createTestContainer({ orders: [order()] });
      await container.orders.recordRefund('ORD-1', 'T-1', 50, NOW);
      expect(await container.orders.recordRefund('ORD-1', 'T-2', 50, NOW)).toEqual({
        ok: false,
        reason: 'already_refunded',
      });
      expect(await container.orders.recordRefund('ORD-404', 'T-1', 50, NOW)).toEqual({
        ok: false,
        reason: 'not_found',
      });
    });
  });

  it('rounds amounts to whole cents on the way out and on the way in', async () => {
    const container = await createTestContainer({ orders: [order({ amount: 59.9 })] });
    await container.database('orders').update({ amount: '59.900000000000006' }); // as some drivers return decimals
    const found = await container.orders.lookupOrder('ORD-1', 'a@b.com');
    expect(found.found && found.order.amount).toBe(59.9);

    await container.orders.recordRefund('ORD-1', 'T-1', 0.1 + 0.2, NOW);
    expect((await container.database('refunds').first('amount'))?.amount).toBe(0.3);
  });
});
