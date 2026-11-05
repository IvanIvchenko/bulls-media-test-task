import type { OrderRow } from './typedef.js';
import { orderSchema, roundMoney, type Order } from '../domain/index.js';

export class OrdersMapper {
  public toOrder(row: OrderRow): Order {
    return orderSchema.parse({
      orderId: row.order_id,
      customerEmail: row.customer_email,
      item: row.item,
      category: row.category,
      amount: roundMoney(Number(row.amount)), // some drivers return decimals as strings
      status: row.status,
      deliveredAt: row.delivered_at,
      refunded: Boolean(row.refunded),
      trackingNote: row.tracking_note ?? undefined,
      refundedByTicket: row.refunded_by_ticket ?? undefined,
      refundedAmount: row.refunded_amount ? roundMoney(Number(row.refunded_amount)) : undefined,
    });
  }
}
