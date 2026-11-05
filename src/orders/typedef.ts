export interface OrderRow {
  order_id: string;
  customer_email: string;
  item: string;
  category: string;
  amount: number;
  status: string;
  delivered_at: string | null;
  /** SQLite returns 0/1; other databases return a boolean. */
  refunded: number | boolean;
  tracking_note: string | null;
  /** From the refunds table, when the order was refunded. */
  refunded_by_ticket?: string | null;
}
