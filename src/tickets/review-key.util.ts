import { createHash } from 'node:crypto';

import { TICKET_ID_PATTERN } from '../domain/index.js';

const EMAIL_DIGEST_CHARS = 16;

/**
 * What a ticket's human review is filed under: the ticket id AND a short digest of the sender's e-mail. Ids like
 * "T-1042" are easy to guess and clients may reuse them, so the sender is part of the key: one customer's review can
 * never replace another's. Returns nothing if the id or the e-mail is malformed: the agent refuses such a ticket,
 * and a refused ticket has nothing to review.
 */
export function reviewKeyOf(raw: unknown): string | undefined {
  const { ticketId, customerEmail } = (raw ?? {}) as Record<string, unknown>;
  if (typeof ticketId !== 'string' || !TICKET_ID_PATTERN.test(ticketId)) return undefined;
  if (typeof customerEmail !== 'string' || customerEmail.length > 200 || !customerEmail.includes('@')) return undefined;
  const sender = createHash('sha256')
    .update(customerEmail.trim().toLowerCase())
    .digest('hex')
    .slice(0, EMAIL_DIGEST_CHARS);
  return `${ticketId}:${sender}`;
}
