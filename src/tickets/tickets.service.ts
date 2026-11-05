import { reviewKeyOf } from './review-key.util.js';
import type { TicketRunner, TicketsOptions } from './typedef.js';
import type { Result } from '../domain/index.js';

/**
 * Runs one ticket through the agent. There is no claim and no replay: a request sent twice is run twice. That is safe
 * for money (the refund is guarded in the database, and a ticket that already got its refund is answered with it
 * again) but it does cost another model call and another audit row, and the wording of a reply can differ.
 */
export class TicketsService {
  public constructor(
    private readonly agent: TicketRunner,
    private readonly options: TicketsOptions,
  ) {}

  public async process(raw: unknown): Promise<Result> {
    const reviewId = this.options.reviewsEnabled ? reviewKeyOf(raw) : undefined;
    return this.agent.run(raw, { reviewId });
  }
}
