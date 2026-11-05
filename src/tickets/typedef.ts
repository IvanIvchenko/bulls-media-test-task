import type { ClaimToken, Result } from '../domain/index.js';

export type TicketOutcome =
  | { kind: 'ran'; result: Result }
  /** The same ticket was already processed (or another instance finished it while we waited): its decision is reused. */
  | { kind: 'replayed'; result: Result };

/** What the tickets service needs from the agent. */
export interface TicketRunner {
  run(raw: unknown): Promise<Result>;
}

export type Acquired = { kind: 'owned'; token: ClaimToken } | { kind: 'replayed'; result: Result };

export interface TicketsOptions {
  /** A claim not finished after this long is presumed dead and may be taken over. */
  staleAfterMs: number;
  /** How long a duplicate waits for the ticket's owner before asking the client to retry. */
  waitMs: number;
  pollMs: number;
  /** Milliseconds from a monotonic clock, for the wait deadline. Injectable so tests control the wait. */
  monotonicMs: () => number;
  /** Injectable so tests need not wait in real time. */
  sleep?: (ms: number) => Promise<void>;
}
