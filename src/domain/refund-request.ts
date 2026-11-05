import type { Ticket } from './ticket.js';

const MIN_QUOTE_CHARS = 6;
const WRAPPING = /^[\s"'“”‘’`.…,;:!?-]+|[\s"'“”‘’`.…,;:!?-]+$/g;

const normalise = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').replace(WRAPPING, '');

/**
 * Whether the words the model quoted as "the customer asks for a refund" really are in the ticket. Before a refund is
 * paid the model must point at the sentence; code checks the sentence exists. That is independent of language and
 * cannot be talked around by the ticket text, because the check is a substring match.
 *
 * It proves the model cited real text, not that the text means what the model says. The quote is kept in the trace
 * so a reviewer can read it.
 */
export function refundQuoteIsInTicket(ticket: Pick<Ticket, 'subject' | 'body'>, quote: string | null): boolean {
  if (quote === null) return false;
  const wanted = normalise(quote);
  if (wanted.length < MIN_QUOTE_CHARS) return false;
  return [ticket.subject, ticket.body].some((text) => normalise(text).includes(wanted));
}
