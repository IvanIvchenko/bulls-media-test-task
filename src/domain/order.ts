import { z } from 'zod';

import { ORDER_ID_IN_TEXT_SOURCE } from './constants.js';

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

/**
 * Not exported: a regular expression with the `g` flag remembers where it stopped, so `.test()` or `.exec()` on a
 * shared one gives wrong answers on alternate calls. Use the two functions below, which only call `.match` and `.replace`.
 */
const ORDER_ID_IN_TEXT = new RegExp(ORDER_ID_IN_TEXT_SOURCE, 'gi');

/** Order ids written anywhere in a piece of text, in any letter case, as upper case. */
export const orderIdsIn = (text: string): string[] =>
  (text.match(ORDER_ID_IN_TEXT) ?? []).map((id) => id.toUpperCase());

/** The text with every order id blanked out, e.g. so their digits are not read as amounts. */
export const withoutOrderIds = (text: string): string => text.replace(ORDER_ID_IN_TEXT, ' ');
