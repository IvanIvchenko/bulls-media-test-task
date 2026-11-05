import type { OrderRow } from './typedef.js';
import { TABLE } from '../db/constants.js';
import type { Database } from '../db/typedef.js';
import { roundMoney, type RefundResult } from '../domain/index.js';

export class OrdersRepository {
  public constructor(private readonly database: Database) {}

  public async findById(orderId: string): Promise<OrderRow | undefined> {
    return this.database<OrderRow>(TABLE.ORDERS)
      .leftJoin(TABLE.REFUNDS, 'refunds.order_id', 'orders.order_id')
      .where('orders.order_id', orderId)
      .first('orders.*', 'refunds.ticket_id as refunded_by_ticket');
  }

  /**
   * Atomic: marks the order refunded and writes the refund row in one transaction.
   * Double refunds are blocked twice, whichever process asks: by the `refunded = false` guard here (a concurrent
   * UPDATE waits for the row lock, then sees `refunded = true` and changes nothing) and by UNIQUE (order_id).
   * Asking again with the same ticket id succeeds without refunding twice, so a retry after a crash gets the answer
   * the first run would have given. The UPDATE comes first, so the transaction takes its write lock immediately instead of upgrading a read lock.
   */
  public async markRefunded(orderId: string, ticketId: string, amount: number, now: Date): Promise<RefundResult> {
    return this.database.transaction(async (trx): Promise<RefundResult> => {
      const updated = await trx(TABLE.ORDERS).where({ order_id: orderId, refunded: false }).update({ refunded: true });
      if (updated === 0) {
        const exists = await trx(TABLE.ORDERS).where({ order_id: orderId }).first('order_id');
        if (!exists) return { ok: false, reason: 'not_found' };
        // The same ticket refunded this order before (its decision was lost to a crash): the refund stands.
        const own = await trx(TABLE.REFUNDS).where({ order_id: orderId, ticket_id: ticketId }).first('id');
        return own ? { ok: true } : { ok: false, reason: 'already_refunded' };
      }
      await trx(TABLE.REFUNDS).insert({
        order_id: orderId,
        ticket_id: ticketId,
        amount: roundMoney(amount),
        created_at: now.toISOString(),
      });
      return { ok: true };
    });
  }
}
