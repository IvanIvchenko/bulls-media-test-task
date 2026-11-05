import type { Result } from '../domain/index.js';

/** What the tickets service needs from the agent. */
export interface TicketRunner {
  run(raw: unknown, options?: { reviewId?: string }): Promise<Result>;
}

export interface TicketsOptions {
  /** Let an escalation a reviewer can settle pause for a human instead of ending there. */
  reviewsEnabled: boolean;
}
