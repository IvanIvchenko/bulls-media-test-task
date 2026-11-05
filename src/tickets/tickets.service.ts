import { reviewKeyOf } from './review-key.util.js';
import type { TicketRunner, TicketsOptions } from './typedef.js';
import type { Result } from '../domain/index.js';

/** Runs one ticket through the agent. A request sent twice is run twice; the refund guard keeps the money safe. */
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
