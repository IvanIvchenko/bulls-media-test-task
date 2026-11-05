import { z } from 'zod';

import { ORDER_ID_PATTERN, TICKET_ID_PATTERN } from './constants.js';

/** Control characters other than tab, newline and carriage return. They have no place in a support message. */
// eslint-disable-next-line no-control-regex -- matching control characters is the whole point of this pattern
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const withoutControlCharacters = (value: string) => !CONTROL_CHARACTERS.test(value);
const NO_CONTROL_CHARACTERS = 'must not contain control characters';

/** Raw inbound ticket. Everything here is UNTRUSTED input. */
export const ticketSchema = z.object({
  ticketId: z.string().regex(TICKET_ID_PATTERN, 'invalid ticketId'),
  customerEmail: z.string().email().max(200),
  orderId: z.string().regex(ORDER_ID_PATTERN).optional(),
  // Trimmed first, so a message of only whitespace is empty, not valid.
  subject: z.string().trim().min(1).max(200).refine(withoutControlCharacters, NO_CONTROL_CHARACTERS),
  body: z.string().trim().min(1).max(4000).refine(withoutControlCharacters, NO_CONTROL_CHARACTERS),
});
export type Ticket = z.infer<typeof ticketSchema>;

/** The LLM's structured reading of a ticket. */
export const classificationSchema = z.object({
  intent: z.enum(['refund_request', 'order_status', 'other']),
  refundReason: z.enum(['defective', 'not_as_described', 'changed_mind', 'late_delivery', 'other']).nullable(),
  urgency: z.enum(['low', 'normal', 'high']),
  orderIdMentioned: z.string().regex(ORDER_ID_PATTERN).nullable(),
  /** The customer's own words asking for money back, copied exactly from the ticket; null if they do not ask. */
  refundRequestQuote: z.string().max(500).nullable(),
});
export type Classification = z.infer<typeof classificationSchema>;
