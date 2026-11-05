import type { OrdersMapper } from './orders.mapper.js';
import type { OrdersRepository } from './orders.repository.js';
import type { LookupResult, OrderTools, RefundResult } from '../domain/index.js';

/** Tools `lookupOrder` and `recordRefund`. */
export class OrdersService implements OrderTools {
  public constructor(
    private readonly repository: OrdersRepository,
    private readonly mapper: OrdersMapper,
  ) {}

  /** Ownership is enforced: an order is only returned to the email that placed it. */
  public async lookupOrder(orderId: string, customerEmail: string): Promise<LookupResult> {
    const row = await this.repository.findById(orderId);
    if (!row) return { found: false, reason: 'not_found' };
    if (row.customer_email.toLowerCase() !== customerEmail.toLowerCase()) {
      return { found: false, reason: 'email_mismatch' };
    }
    return { found: true, order: this.mapper.toOrder(row) };
  }

  public async recordRefund(orderId: string, ticketId: string, amount: number, now: Date): Promise<RefundResult> {
    return this.repository.markRefunded(orderId, ticketId, amount, now);
  }
}
