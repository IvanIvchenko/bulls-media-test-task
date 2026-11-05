import { createHash } from 'node:crypto';

import { TICKET_ID_PATTERN } from '../domain/index.js';
import { BusinessLogicError } from '../shared/errors/business-logic-error.js';
import { ErrorCodes } from '../shared/errors/error-codes.js';

/** A ticket is flat. A little slack covers odd values; anything deeper is not a ticket. */
const MAX_DEPTH = 8;

/** The fields that make up a ticket. Anything else a client sends is ignored by the agent, so it must not change the hash. */
const TICKET_FIELDS = ['ticketId', 'customerEmail', 'orderId', 'subject', 'body'] as const;

/** JSON with object keys sorted, so the same payload hashes the same regardless of key order. */
function canonicalJson(value: unknown, depth = 0): string {
  if (depth > MAX_DEPTH) throw new BusinessLogicError('Request is nested too deeply.', ErrorCodes.INVALID_REQUEST);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, depth + 1)).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v, depth + 1)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Identifies a ticket's content, for telling a resend (same hash) from a clash (same id, different hash). */
export function hashRequest(raw: unknown): string {
  const source = (raw ?? {}) as Record<string, unknown>;
  const ticketFields = Object.fromEntries(TICKET_FIELDS.map((field) => [field, source[field]]));
  // The same sender is the same sender, however the address is cased or padded.
  if (typeof ticketFields.customerEmail === 'string')
    ticketFields.customerEmail = ticketFields.customerEmail.trim().toLowerCase();
  return createHash('sha256').update(canonicalJson(ticketFields)).digest('hex');
}

export interface ClaimIdentity {
  ticketId: string;
  /** What the claim is keyed by: the ticket id AND a short digest of the sender's e-mail. */
  claimKey: string;
}

const EMAIL_DIGEST_CHARS = 16;

/**
 * Who a ticket belongs to, for idempotency. The key includes the sender, so one customer cannot use up another
 * customer's ticket id (ids like "T-1042" are easy to guess) and make their real ticket clash. Returns nothing if
 * the id or the e-mail is malformed: the agent refuses such a ticket and it claims nothing.
 */
export function claimIdentity(raw: unknown): ClaimIdentity | undefined {
  const { ticketId, customerEmail } = (raw ?? {}) as Record<string, unknown>;
  if (typeof ticketId !== 'string' || !TICKET_ID_PATTERN.test(ticketId)) return undefined;
  if (typeof customerEmail !== 'string' || customerEmail.length > 200 || !customerEmail.includes('@')) return undefined;
  const sender = createHash('sha256')
    .update(customerEmail.trim().toLowerCase())
    .digest('hex')
    .slice(0, EMAIL_DIGEST_CHARS);
  return { ticketId, claimKey: `${ticketId}:${sender}` };
}
