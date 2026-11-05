import type { Order } from './order.js';
import type { PolicyConfig, PolicyRule } from './policy.js';
import type { Result } from './result.js';
import type { ReviewAnswer } from './review.js';

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

/** A run paused for a human: what the reviewer sees, and the graph thread (saved in the database) to resume. */
export interface NewReview {
  reviewId: string;
  ticketId: string;
  orderId: string;
  threadId: string;
  /** The escalation as the customer received it, with `review.status` pending. */
  request: Result;
}

export interface ReviewRecord extends NewReview {
  status: 'pending' | 'deciding' | 'resolved';
  /** Once resolved: the answer that was applied, and the final result the customer got. */
  answer?: ReviewAnswer;
  finalResult?: Result;
}

export interface ReviewSummary {
  reviewId: string;
  ticketId: string;
  summary: string;
  createdAt: Date;
  /** How many earlier tickets about this order were denied by a reviewer. */
  priorDenials: number;
}

/** A reviewer's earlier no, on another ticket about the same order. */
export interface PriorDenial {
  ticketId: string;
  reviewer: string;
  note?: string;
  decidedAt: Date;
}

/**
 * Paused runs waiting for a person. Exactly one decision wins (a conditional update), even if two reviewers answer at
 * the same moment. The service is meant to run as a single instance: a review whose decider died is put back to
 * waiting when the service starts (`recover`), not taken over while it runs.
 */
export interface ReviewStore {
  /**
   * Record a paused run. Replaces an earlier waiting or answered review with the same id (the same ticket came back).
   * Returns the thread of the waiting run it replaced, if any, so the caller can delete that run's saved state.
   */
  open(review: NewReview): Promise<string | undefined>;
  list(): Promise<ReviewSummary[]>;
  find(reviewId: string): Promise<ReviewRecord | undefined>;
  /** Reviews that ended in a no for this order, newest first, leaving out the review `exceptReviewId`. */
  deniedFor(orderId: string, exceptReviewId: string): Promise<PriorDenial[]>;
  /** Atomically move a waiting review to "deciding". Returns it for exactly one caller; undefined for everyone else. */
  begin(reviewId: string): Promise<ReviewRecord | undefined>;
  /** Put a review back to waiting (the answer could not be applied or recorded). */
  release(reviewId: string): Promise<void>;
  /** Mark it decided, keeping the answer that was applied and the final result, so a denial can be replayed. */
  resolve(reviewId: string, answer: ReviewAnswer, result: Result): Promise<void>;
  /** At startup: reviews left "deciding" by a process that died go back to waiting. Returns how many. */
  recover(): Promise<number>;
}
