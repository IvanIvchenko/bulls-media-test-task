import type { Order } from './order.js';
import type { PolicyConfig, PolicyRule } from './policy.js';
import type { Result } from './result.js';

/*
 * The agent's tools, as interfaces. They are defined here, on the inside, and implemented by the feature
 * repositories. The agent and the HTTP layer depend only on these, never on a database.
 *
 * Every method returns a Promise because storage is treated as slow, remote and shared by several processes:
 * nothing may assume a call is instant, or that it sees only this process's writes.
 */

export type LookupResult = { found: true; order: Order } | { found: false; reason: 'not_found' | 'email_mismatch' };
export type RefundResult = { ok: true } | { ok: false; reason: 'not_found' | 'already_refunded' };

/** Tools: `lookupOrder` and `recordRefund`. */
export interface OrderTools {
  /** Ownership is enforced: an order is only returned to the email that placed it. */
  lookupOrder(orderId: string, customerEmail: string): Promise<LookupResult>;
  /** Atomic, and refuses a second refund of the same order, even from another process. */
  recordRefund(orderId: string, ticketId: string, amount: number, now: Date): Promise<RefundResult>;
}

/** Everything about the policy that one ticket needs, read in a single round trip and used from memory. */
export interface PolicySnapshot {
  /** Windows, the approval limit and category rules, as they are right now. */
  config: PolicyConfig;
  /** Rule texts with their {{placeholders}} filled from the same settings. */
  rules: PolicyRule[];
}

/** Tools `searchPolicies` and `getPolicyRules` run over a snapshot; loading it is the only database call. */
export interface PolicyTools {
  loadSnapshot(): Promise<PolicySnapshot>;
}

/** Append-only record of every decision. */
export interface AuditTrail {
  record(result: Result, now: Date): Promise<void>;
}

/** Proof of ownership of a claim. Whoever holds the current token is the only one allowed to finish it. */
export type ClaimToken = string;

export interface ClaimRecord {
  ticketId: string;
  requestHash: string;
  status: 'in_progress' | 'done';
  ownerToken: ClaimToken;
  /** Present once the claim is done. */
  result?: Result;
  /** How long ago the claim was made or last renewed, by the database's clock, so instance clocks do not matter. */
  ageMs: number;
}

/**
 * Who is processing which ticket. The database is the referee, so the guarantee holds across processes:
 * for one ticket id, exactly one caller wins `tryClaim`.
 */
export interface TicketClaims {
  /** Atomically claim an unclaimed ticket. Returns the token if this caller won, undefined if it was taken. */
  tryClaim(ticketId: string, requestHash: string): Promise<ClaimToken | undefined>;
  find(ticketId: string): Promise<ClaimRecord | undefined>;
  /** Take over an `in_progress` claim whose owner is presumed dead. At most one caller succeeds. */
  takeOver(ticketId: string, expiredToken: ClaimToken): Promise<ClaimToken | undefined>;
  /** Store the decision. Returns false if the claim was taken over in the meantime. */
  complete(ticketId: string, token: ClaimToken, result: Result): Promise<boolean>;
  /** Give the ticket id back (the run failed, or the request was invalid) so a retry can run. */
  release(ticketId: string, token: ClaimToken): Promise<void>;
}
