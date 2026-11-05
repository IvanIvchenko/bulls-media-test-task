import { z } from 'zod';

export const orderSchema = z.object({
  orderId: z.string(),
  customerEmail: z.string(),
  item: z.string(),
  category: z.enum(['physical', 'digital', 'final_sale']),
  amount: z.number().nonnegative(),
  status: z.enum(['processing', 'shipped', 'delivered', 'cancelled']),
  deliveredAt: z.string().nullable(),
  refunded: z.boolean(),
  trackingNote: z.string().optional(),
  /** The ticket whose approved refund marked this order refunded, if any. */
  refundedByTicket: z.string().optional(),
});
export type Order = z.infer<typeof orderSchema>;
